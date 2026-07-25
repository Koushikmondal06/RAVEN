# RAVEN

Rent someone else's machine. Pay by the second, in SOL.

A contributor shares a real machine; a buyer (a human in the web app, or an autonomous agent) rents
it, gets an `ssh` command into a hardened throwaway container, and is billed for the exact seconds
used. Solana devnet, custodial balances, no on-chain program required.

## Architecture

```mermaid
flowchart LR
    subgraph buyers [Buyers]
        web["web/ · Next.js static SPA<br/>wallet-standard + @solana/kit"]
        agent["example-buyer/ · headless agent<br/>(own key; same REST API + ssh2)"]
    end

    registry["backend/ · registry (Express :4000)<br/>nodes · leases — in memory · JWT sessions<br/>watchdog + billing"]

    subgraph contribs [Contributors]
        onboarding["Become a Contributor page<br/>wallet sign-in → RAVEN_KEY"]
        contributor["contributor/ · daemon<br/>RAVEN_KEY bearer · docker · bore tunnel"]
        sandbox["sandbox · throwaway root container<br/>capped CPU/RAM, no mounts, per-lease SSH pw"]
    end

    mongo[("MongoDB<br/>users · deposits · charges · payouts<br/>nonces · contributors")]
    solana["Solana devnet<br/>top-up confirm · contributor payout"]

    web -- "wallet sign-in, top-up, rent, release" --> registry
    onboarding -- "wallet sign-in (role=contributor)" --> registry
    agent -- "REST + ssh into the sandbox" --> registry
    registry -- "money state, nonces, keys" --> mongo
    registry -- "confirm deposit · send payout" --> solana
    registry -- "start/stop via heartbeat reply" --> contributor
    contributor -- "register · ready · heartbeat (RAVEN_KEY)" --> registry
    contributor -- "docker run / rm (host socket)" --> sandbox
    sandbox -- "bore outbound tunnel" --> contributor
    agent -. "ssh root@bore -p …" .-> sandbox
    web -. "copyable ssh command" .-> sandbox

    shared["shared/ · wire types imported by all"]
```

**Pieces** — each is a `cd`-able folder; `shared/` holds the types they all import.

| Folder | What it is |
|---|---|
| `backend/` | The registry: REST API, wallet sign-in + JWT sessions, deposit/payout on Solana, contributor-key onboarding, lease lifecycle + billing watchdog. Nodes and leases live in memory; MongoDB holds money state, nonces, and contributor keys. |
| `contributor/` | Runs on each shared machine. Authenticates with a `RAVEN_KEY` bearer only — no wallet, no keypair — and on command launches a sandbox as a sibling container on the host Docker daemon, over a bore tunnel. |
| `web/` | Next.js App Router static SPA. Both roles authenticate through a Solana wallet (wallet-standard: Phantom / Solflare / Backpack): a Buyer dashboard (`/`) and a "Become a Contributor" page (`/contributor`). |
| `example-buyer/` | The buyer flow with no human: an agent that holds its own key, signs in, tops up, rents the cheapest node, SSHes in to run a job, then releases. |

**Auth (both roles, same flow)**
1. Connect Wallet (wallet-standard: Phantom / Solflare / Backpack — Solana only).
2. `GET /auth/nonce?address=<pubkey>` → single-use nonce (stored in Mongo, 5-min TTL).
3. Sign `Sign in to RAVEN: <nonce>` with the wallet (`signMessage`).
4. `POST /auth/verify {address, signature, role}` → backend verifies with tweetnacl, mints a **JWT** (`SESSION_SECRET`, 24h). Role is which page you started from — no separate auth.
- **Buyer:** the JWT authorizes `/wallet/topup` (buyer signs a real SOL transfer to `PLATFORM_PAYTO` in their wallet; backend confirms on-chain and credits their balance) and `/leases` (spends balance, no further signing).
- **Contributor:** verify mints an opaque `rvn_ctb_…` key tied to the verified address in the `contributors` collection; the page shows it plus a one-line `docker run`. The daemon sends only that key as a bearer — the backend resolves it to the payout address server-side, used solely to send the on-chain payout at lease end via `PLATFORM_PRIVATE_KEY`.

**Lease flow**
- **Top up** — the wallet sends SOL to `PLATFORM_PAYTO`; registry confirms the tx on-chain (depositor signed, lamports landed) and credits MongoDB, idempotent by signature.
- **Rent** — `POST /leases` (with your SSH public key and an optional `minIsolation`) queues a `start` command; the contributor's next heartbeat picks it up, runs the sandbox + bore tunnel, posts `ready`; the lease goes `active` with an `ssh` command.
- **Release / exhaust** — registry bills the exact seconds used (charge in MongoDB), pays the contributor on-chain, and sends a `stop` command that destroys the sandbox.

## Isolation tiers

Isolation is a pluggable, advertised, buyer-selectable property of a node. A node reports the
strongest tier it can actually deliver (`SANDBOX_BACKEND` + a host capability probe at startup); a
buyer sets a minimum on the lease and the registry never places below it. A node never advertises a
tier it can't deliver — if the configured backend is unavailable at startup, the daemon refuses to
register rather than downgrading.

| Tier | `SANDBOX_BACKEND` | Boundary | Needs |
|---|---|---|---|
| `container` | `docker` | shared kernel, namespaces only | nothing (default) |
| `usermode-kernel` | `gvisor` | syscalls intercepted in userspace (runsc) | `runsc` installed |
| `microvm` | `kata-fc` / `firecracker` | separate guest kernel, KVM | `/dev/kvm`, nested virt |

The `microvm` tier needs `/dev/kvm` — **bare metal or a nested-virt-capable instance**. Standard
DigitalOcean droplets do not expose it (the registry + MongoDB can still live on DO). Run
`bash contributor/scripts/preflight-microvm.sh` on a host to check, and see
[contributor/docs/microvm-setup.md](contributor/docs/microvm-setup.md). Only `container` and
`gvisor` are runnable without KVM; the microVM backends are written but unverified in CI.

## Run it

Each app reads its own `.env` (no root `.env`) — copy the example next to the one you're running.

```bash
npm install

# 1. the registry                                              → :4000
cp backend/.env.example backend/.env   # MONGODB_URI, PLATFORM_PAYTO, PLATFORM_PRIVATE_KEY, SESSION_SECRET
npm run backend

# 2. web UI                                                    → http://localhost:3000
cp web/.env.example web/.env           # NEXT_PUBLIC_REGISTRY_URL (defaults to localhost:4000)
npm run web                            # Buyer at / · "Become a Contributor" at /contributor

# 3. share THIS machine's compute — get RAVEN_KEY from the /contributor page after signing in
cp contributor/.env.example contributor/.env   # set RAVEN_KEY
npm run contributor

# …or the autonomous buyer agent (its own funded key — signs in, tops up, rents)
cp example-buyer/.env.example example-buyer/.env   # set BUYER_PRIVATE_KEY
npm run client
```

Both roles authenticate the same way: **Connect Wallet → sign a nonce**. No key entry,
no `.env` wallet setup — the buyer additionally signs a real top-up transfer in-browser. The
contributor daemon never touches a wallet; it carries only the `RAVEN_KEY` bearer it was handed.

Each top-level folder is a self-contained piece you can `cd` into: `backend/`, `contributor/`,
`web/`, `example-buyer/`, with `shared/` holding the types they all import.

## Run with Docker

Each piece is its own Compose service, run independently. The backend usually lives on a server; a
contributor runs on each machine sharing compute and points at that backend via `REGISTRY_URL`.

```bash
# each service reads its own <app>/.env — copy the examples first
cp backend/.env.example backend/.env
cp contributor/.env.example contributor/.env
cp example-buyer/.env.example example-buyer/.env
docker compose up --build backend        # run the backend / registry  → :4000
docker compose up --build contributor    # share THIS machine's compute
docker compose --env-file web/.env up --build web   # static SPA behind nginx → :3000
docker compose run  --rm   buyer         # one-shot autonomous buyer
```

The `web` image bakes `NEXT_PUBLIC_*` in at build time (build args). Compose interpolates them from
`--env-file web/.env` (or the shell), so pass `--env-file web/.env` when building the web image.

The contributor doesn't run a Docker of its own: it mounts the host Docker socket and launches each
rented sandbox as a sibling container on the host daemon, so there's nothing extra to install.

`backend` keeps only money state in MongoDB (`MONGODB_URI`) — no local volume; set `PLATFORM_PAYTO` +
`PLATFORM_PRIVATE_KEY` too. `contributor` needs no inbound ports in the default `TUNNEL_MODE=bore` —
each SSH sandbox dials out over bore. `network_mode: host` is only needed for `TUNNEL_MODE=local`
(same-machine SSH), and on Docker Desktop host networking doesn't share the loopback, so for local
mode run the contributor natively (`npm run contributor`) instead.

## Web app (Next.js static export)

Next.js App Router with `output: 'export'` — the wallet stack is client-only, so there is no server
to run: `next build` emits a plain static bundle you can host anywhere (the `web` Docker image just
serves it behind nginx).

```bash
NEXT_PUBLIC_REGISTRY_URL=http://your-host:4000 npm run build -w web   # → web/out
```

Drop `web/out` on Vercel / Netlify / Cloudflare Pages / nginx.

## Configuration

There is no root `.env` — each app reads its own: `backend/.env`, `web/.env`, `contributor/.env`,
`example-buyer/.env`. Inline `FOO=bar npm run …` still overrides. The web app's `NEXT_PUBLIC_*` (plus
`MAINNET`) are baked in at build time. See each `<app>/.env.example` for its variables; flip
`MAINNET=true` (backend, web, buyer) to target mainnet-beta instead of devnet.

Isolation + egress are contributor knobs: **`SANDBOX_BACKEND`** picks the tier
(`docker`/`gvisor`/`kata-fc`/`firecracker`, default `docker`) and the daemon fails to start if that
backend's host requirements aren't met. **`EGRESS_MODE`** (`allowlist` default / `deny-all` / `open`)
is applied per lease and advertised on the node, so buyers see it before renting. SSH is key-only
unless the backend sets `ALLOW_PASSWORD_SSH=true` (off by default).

## Demo script (the money shot)

1. Start the registry and one or two contributors on different tiers (e.g. one `docker`, one
   `gvisor`).
2. Show the nodes appear in **Explore** at http://localhost:3000 with their isolation + egress
   badges. Set the minimum-isolation selector and watch weaker nodes disable their Rent button.
3. **Human path:** connect wallet (devnet) → Sign in → Top up (approve one SOL deposit) → paste your
   SSH public key → click **Rent** → a copyable `ssh root@… -p …` command appears with a
   balance-driven countdown. `ssh -i your-key` in. **Release** (or letting the balance hit zero) bills
   the exact time used and destroys the sandbox.
4. **Autonomous path:** run `npm run client` — the agent generates an ephemeral keypair, signs in,
   tops up if low, requests the `microvm` tier (logging an explicit fallback if none offers it), runs
   a tiny training loop over SSH key auth, prints the falling loss, then releases.
5. Show the boundary per tier: `docker ps` during a `container`/`gvisor` lease (a hardened, mount-less
   container; `gvisor` shows `--runtime=runsc`), and the Firecracker/Kata guest boot in `dmesg` during
   a `microvm` lease (a real VM, different kernel from the host).
6. Show egress enforcement: from inside a sandbox, `curl https://not-allowlisted.example` hangs/drops
   while an allowlisted host works; the drop shows up in the per-lease `nft` counter the daemon
   reports on heartbeat.
7. On a devnet explorer, confirm the top-up and the payout to the contributor; in MongoDB, the single
   `charges` doc (with the billed seconds) and the `payouts` doc.

## What's verified vs. what needs your machine

Compiles + builds clean (full `npm run typecheck`, `npm test`, web static export). Requires your
environment to run end-to-end: a MongoDB database (`MONGODB_URI`), a `SESSION_SECRET`, a Solana
wallet in the browser, a platform account (`PLATFORM_PAYTO` +
`PLATFORM_PRIVATE_KEY`), the Docker sandbox lifecycle (a running Docker daemon), outbound network for
the bore tunnel, an SSH client, and an RPC reachable to confirm top-ups + send payouts (funded devnet
accounts).

## Notes & limitations

- **Custodial model:** top-ups pool at one platform address and balances are an off-chain ledger in
  MongoDB. Top-ups are confirmed on-chain and recorded by signature (the `deposits._id` — idempotent,
  a deposit can't credit twice), and the depositor must have signed the transaction. Contributor earnings are settled
  on-chain on lease end (needs `PLATFORM_PRIVATE_KEY`); if it's unset, payouts are recorded as unpaid
  (`txid` null) instead.
- **Billing:** usage is calculated continuously but charged once, at lease end, prorated at the
  hourly rate (`elapsed/3600 × rate`) — no per-tick debits. A watchdog only checks every
  `METER_INTERVAL_MS` whether the balance is exhausted, so worst-case over-use is one tick.
- **Nodes + leases are in-memory:** a registry restart drops live sessions (the sockets die anyway).
  This is what keeps the DB quiet — heartbeats and the watchdog never write to MongoDB.
- **SSH auth is key-only** by default: the buyer supplies a public key (the web app takes a pasted
  key; the agent generates an ephemeral keypair), the sandbox runs `PasswordAuthentication no` /
  `PermitRootLogin prohibit-password`, and nothing guessable exists on the box. The old
  wallet-address password returns only behind `ALLOW_PASSWORD_SSH=true`, with a startup warning.
- **Isolation is tiered and enforced** (see the table above): `container` shares the host kernel,
  `gvisor` intercepts syscalls in userspace, `microvm` gives each lease its own guest kernel over KVM.
  A node advertises only what it can deliver and the registry never places a lease below the buyer's
  `minIsolation`. The `docker`-socket-mount setup gives the daemon **host root** — for real machines
  run the daemon natively (see [contributor/docs/daemon-isolation.md](contributor/docs/daemon-isolation.md)).
- **Egress is filtered per lease** (`EGRESS_MODE`, default `allowlist`): default-drop outbound, DNS to
  the resolver only, the buyer's allowlist, and drops of cloud metadata + RFC1918. A buyer whose lease
  slams the firewall past `EGRESS_DROP_LIMIT` is suspended; a local kill switch tears every sandbox
  down at once. Enforcement is wired for tap-based backends (firecracker); docker/gvisor egress is a
  documented follow-up.
- **Teardown is guaranteed:** the guest self-powers-off at a hard TTL, and a host reaper reconciles
  live sandboxes against known leases every `REAP_INTERVAL_MS` — so a VM never outlives the registry.
- **Auth:** both roles connect a Solana wallet and sign a single-use nonce (Mongo, 5-min TTL); verify
  mints a JWT (`SESSION_SECRET`). Spending a balance needs that JWT, so nobody can spend someone
  else's balance. The contributor daemon holds only its `rvn_ctb_…` bearer key — no wallet, no
  signing on the box. `PLATFORM_PRIVATE_KEY` is read only server-side, at payout time; it never
  reaches a response, a log, or the web bundle.
- `web/` is Next.js (App Router) exported as a static bundle (`output: 'export'`): the wallet stack
  is client-only, so every page is a client component and there is no SSR server to run.
