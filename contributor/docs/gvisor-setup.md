# Easy contributor: gVisor (virtual kernel, no KVM)

The `usermode-kernel` tier runs each sandbox under **gVisor (runsc)** — a real virtualized kernel
implemented in userspace. Every syscall the buyer makes is intercepted by gVisor's sentry instead of
hitting your host kernel, so a kernel-privilege-escalation inside the sandbox has nothing to escalate
against. Unlike the microVM tier it needs **no `/dev/kvm`**, so it runs on ordinary cloud VMs.

This is the recommended contributor tier when you don't have a bare-metal / nested-virt host.

## One-time host setup

```bash
sudo bash contributor/scripts/setup-gvisor.sh
```

It downloads `runsc` + the containerd shim, registers `runsc` as a Docker runtime, and restarts
Docker. Idempotent — safe to re-run. Verify:

```bash
docker info --format '{{json .Runtimes}}' | grep runsc
```

## Run the contributor

Native:

```bash
cp contributor/.env.example contributor/.env      # set RAVEN_KEY + REGISTRY_URL
SANDBOX_BACKEND=gvisor npm run contributor
```

Or with Docker Compose (the daemon uses the host Docker via the socket, so it launches
`--runtime=runsc` sandboxes on the host that has runsc):

```bash
# in contributor/.env:  SANDBOX_BACKEND=gvisor
docker-compose up --build -d contributor
```

The daemon probes the Docker daemon for the `runsc` runtime and, if present, registers as the
**usermode-kernel** tier. The web marketplace's minimum is gVisor, so the node is rentable. If runsc
isn't registered the daemon fails fast (it never advertises a tier it can't deliver) — run the setup
script.

## Verifying isolation

`ssh` into a lease and check the kernel is gVisor's, not the host's:

```bash
dmesg | head        # shows the gVisor sentry, not your host kernel
uname -a            # gVisor reports its own kernel identity
```
