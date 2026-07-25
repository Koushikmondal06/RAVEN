# Where the contributor daemon runs (and why you don't containerize it)

Two different boundaries get confused easily, so state them separately:

- **What contains the buyer:** the Firecracker microVM — its own guest kernel under KVM, launched
  through `jailer` (chroot, uid/gid 30000, cgroup v2 slice), with no host filesystem passed in. This is
  the boundary the product sells, and it does not depend on how the daemon is packaged.
- **What contains the daemon:** the host, and not much else. The daemon runs as **root** — it creates a
  tap device per lease (`CAP_NET_ADMIN`) and loop-mounts each lease's rootfs (`CAP_SYS_ADMIN`) — so a
  bug in the daemon or a malicious dependency owns the machine. Moving it into a container hides that,
  it doesn't fix it.

## Run it natively, under systemd

Ship: [`systemd/raven-contributor.service`](../systemd/raven-contributor.service). It keeps
`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `RestrictSUIDSGID` and a `ReadWritePaths`
allowlist (`/opt/raven`, `/var/lib/raven`, `/srv/jailer`) around a root process that needs KVM and the
network stack. `NoNewPrivileges` is safe here because `jailer` only ever *drops* privileges. Setup steps
are in that file's header.

Treat a contributor box as **dedicated to this job** — don't co-locate the daemon with anything whose
compromise would matter to you.

## Why there is no `docker compose up contributor`

The old demo ran the daemon in a container with `-v /var/run/docker.sock:/var/run/docker.sock`. **That
mount gives the container host root**: the Docker API is not namespaced, so anything that can talk to
the socket can start a container that bind-mounts `/` and writes to it as root.

For Firecracker it would be worse — the container would additionally need `--privileged`, `/dev/kvm`,
`CAP_NET_ADMIN`, and host mounts for `/var/lib/raven` and `/srv/jailer`. At that point it's a root shell
on the host wearing a costume, and it buys nothing over running natively. So the `contributor` service
was removed from `docker-compose.yml` rather than made to work.

`contributor/Dockerfile` still exists for the local-dev `container` tier (`SANDBOX_BACKEND=docker`),
which cannot be rented.

## If you genuinely cannot run it on the host

Run a small helper on the host that listens on a unix socket and accepts only three verbs — `create`,
`destroy`, `list` — each with a fixed argument schema (lease id, cpu, mem, image, ssh key), and keep the
daemon in an unprivileged container that can only ask for those three shapes. The helper validates
every field and never passes buyer-controlled strings to a shell.

That is more moving parts than the systemd unit and is only worth it when the daemon truly cannot run
on the host. Native is the default recommendation.
