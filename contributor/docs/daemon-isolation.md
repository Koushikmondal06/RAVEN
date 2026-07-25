# Where the contributor daemon runs (and why the socket mount is dangerous)

The demo runs the daemon in a container with `-v /var/run/docker.sock:/var/run/docker.sock`. **That
mount gives the container host root.** The Docker API is not namespaced — anything that can talk to
the socket can start a container that bind-mounts `/` and writes to it as root. So a bug in the
daemon, or a malicious dependency, owns the contributor's machine with no container escape required.
The sandbox hardening is irrelevant while that hole is open.

Pick one of these for anything beyond a local demo.

## Option 1 (recommended): run natively under systemd

Run the daemon as a normal host process, not inside a container. It still uses Docker, but there is
no socket-mounted container to compromise, and systemd confines the daemon itself.

Ship: [`systemd/raven-contributor.service`](../systemd/raven-contributor.service) with
`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, and a `ReadWritePaths` allowlist. Setup is in
the header of that unit file.

Caveat, stated plainly: membership in the `docker` group is equivalent to root on the host — that is
inherent to driving Docker, native or not. This option removes the *socket-in-a-container* hole and
limits the daemon; it does not make a Docker-driving process unprivileged. The thing that actually
contains the **buyer** is the isolation tier (gvisor/microvm), not this.

## Option 2: containerized daemon + a fixed-schema host helper

If you must keep the daemon in a container, do **not** mount the socket. Instead run a tiny helper on
the host that listens on a unix socket and accepts only three verbs — `create`, `destroy`, `list` —
each with a fixed argument schema (lease id, cpu, mem, image, ssh key). The daemon can no longer ask
the host to do arbitrary Docker things; it can only request the three shapes the helper allows. The
helper validates every field and never passes buyer-controlled strings to a shell.

This is more moving parts than Option 1 and is only worth it when the daemon genuinely cannot run on
the host. Option 1 is the default recommendation.
