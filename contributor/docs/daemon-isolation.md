# Where the contributor daemon runs (and what that costs you)

Two different boundaries get confused easily, so state them separately:

- **What contains the buyer:** one Docker container per lease — no host filesystem mounted,
  `--cap-drop=ALL`, `--read-only` root with `noexec,nosuid` scratch tmpfs, `no-new-privileges`, capped
  CPU/RAM/PIDs, key-only SSH, hard self-destruct TTL. It **shares your kernel**. Container escapes via
  kernel bugs are a real, recurring class; this boundary is the ceiling of what a shared-kernel
  sandbox can offer.
- **What contains the daemon:** the host, and not much else. Whether it runs natively or as the
  `contributor` Compose service, it needs the Docker API to start each lease — and **Docker socket
  access is host root**: the API is not namespaced, so anything that can talk to it can start a
  container that bind-mounts `/` and writes to it as root. Packaging the daemon in a container hides
  that, it doesn't fix it.

The practical consequence is the same either way: **treat a contributor box as dedicated and
disposable.** Don't co-locate the daemon with anything whose compromise would matter to you, and don't
run it on a laptop that holds your keys.

## The two ways to run it

**Compose (what the dashboard tells contributors to use):**

```bash
docker compose up -d --build contributor
```

Mounts `/var/run/docker.sock` so each lease starts as a *sibling* container on the host daemon rather
than nested inside this one. `restart: unless-stopped` survives reboots.

**Natively, under systemd** — [`systemd/raven-contributor.service`](../systemd/raven-contributor.service).
It keeps `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome` and `RestrictSUIDSGID` around the
process. No socket mount is needed since it's already talking to the local daemon, and the unit can run
as a user in the `docker` group rather than root — marginally better, and worth it for a long-lived
node. Setup steps are in that file's header.

## If you want a real boundary

A shared kernel is the honest limit of this design. Stronger options exist and were prototyped here
before being removed for setup cost:

- **gVisor (`runsc`)** — a userspace kernel; every guest syscall is served by the sentry instead of
  your kernel. Installs with one script, needs no KVM, and works as a Docker runtime (`--runtime=runsc`).
- **Firecracker microVMs** — each lease gets its own guest kernel under KVM, launched via `jailer`.
  Strongest of the three, but needs `/dev/kvm`, root, and per-lease tap networking.

Both live in this repo's git history if the marketplace ever wants to advertise a real isolation
boundary again.
