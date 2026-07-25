# RAVEN

Rent someone else's machine. Pay by the second, in SOL.

A contributor shares a real machine; a buyer (a human in the web app, or an autonomous agent) rents
it, gets an `ssh` command into a hardened throwaway container, and is billed for the exact seconds
used. Solana devnet, custodial balances, no on-chain program required.

## Run it

```bash
cp .env.example .env               # DATABASE_URL, PLATFORM_PAYTO, PLATFORM_PRIVATE_KEY, PAYOUT_ADDRESS
npm install

npm run backend                    # 1. the registry            → :4000
npm run contributor                # 2. share THIS machine's compute

# 3a. web UI                                                    → http://localhost:5173
cp web/.env.example web/.env       # set VITE_REGISTRY_URL (defaults to localhost:4000)
npm run web                        # connect wallet → Sign in → Top up → Rent → copy the ssh command

# 3b. …or the autonomous agent (its own funded key — signs in, tops up, rents)
BUYER_PRIVATE_KEY=<buyer-key> npm run client
```

Each top-level folder is a self-contained piece you can `cd` into: `backend/`, `contributor/`,
`web/`, `example-buyer/`, with `shared/` holding the types they all import.

## Run with Docker

Each piece is its own Compose service, run independently. The backend usually lives on a server; a
contributor runs on each machine sharing compute and points at that backend via `REGISTRY_URL`.

```bash
cp .env.example .env                     # then set REGISTRY_URL to your backend
docker compose up --build backend        # run the backend / registry  → :4000
docker compose up --build contributor    # share THIS machine's compute
docker compose run  --rm   buyer         # one-shot autonomous buyer
```

The contributor doesn't run a Docker of its own: it mounts the host Docker socket and launches each
rented sandbox as a sibling container on the host daemon, so there's nothing extra to install.

`backend` keeps only money state in Neon (`DATABASE_URL`) — no local volume; set `PLATFORM_PAYTO` +
`PLATFORM_PRIVATE_KEY` too. `contributor` needs no inbound ports in the default `TUNNEL_MODE=bore` —
each SSH sandbox dials out over bore. `network_mode: host` is only needed for `TUNNEL_MODE=local`
(same-machine SSH), and on Docker Desktop host networking doesn't share the loopback, so for local
mode run the contributor natively (`npm run contributor`) instead.

## Web app (static SPA)

The web app isn't a container — it's a static build you host anywhere:

```bash
VITE_REGISTRY_URL=http://your-host:4000 npm run build -w web   # → web/dist
```

Drop `web/dist` on Vercel / Netlify / Cloudflare Pages / nginx.

## Configuration

All Node services read the repo-root `.env` (and each app's own `.env`, which overrides it); inline
`FOO=bar npm run …` overrides both. The web app reads `web/.env` (`VITE_*` only, baked in at build
time). See `.env.example` and `web/.env.example` for every variable.

## Demo script (the money shot)

1. Start the registry and one contributor (a real machine sharing CPU/RAM).
2. Show the node appear in **Explore** at http://localhost:5173.
3. **Human path:** connect wallet (devnet) → Sign in → Top up (approve one SOL deposit) → watch the
   balance appear → click **Rent** → a copyable `ssh root@… -p …` command appears (password = your
   wallet address) with a balance-driven countdown. `ssh` in. **Release** (or letting the balance hit
   zero) bills the exact time used and destroys the sandbox.
4. **Autonomous path:** run `npm run client` and narrate the logs — the agent signs in, tops up if
   low, rents the cheapest node, runs a tiny training loop on someone else's machine, prints the
   falling loss, then releases and reports how much balance it drew down. No human clicked anything.
5. Show `docker ps` during the lease (a hardened, mount-less container) and that it's gone after
   release. On a devnet explorer, confirm the top-up and the payout to the contributor; in Neon, the
   single `charges` row (with the billed seconds) and the `payouts` row.

## What's verified vs. what needs your machine

Compiles + builds clean (full `npm run typecheck`, `npm test`, web production build). Requires your
environment to run end-to-end: a Neon database (`DATABASE_URL`), a platform account
(`PLATFORM_PAYTO` + `PLATFORM_PRIVATE_KEY`), the Docker sandbox lifecycle (a running Docker daemon),
outbound network for the bore tunnel, an SSH client, and an RPC reachable to confirm top-ups + send
payouts (funded devnet accounts).

## Notes & limitations

- **Custodial model:** top-ups pool at one platform address and balances are an off-chain ledger in
  Neon. Top-ups are confirmed on-chain and recorded by signature (idempotent — a deposit can't credit
  twice), and the depositor must have signed the transaction. Contributor earnings are settled
  on-chain on lease end (needs `PLATFORM_PRIVATE_KEY`); if it's unset, payouts are recorded as unpaid
  (`txid` null) instead.
- **Billing:** usage is calculated continuously but charged once, at lease end, prorated at the
  hourly rate (`elapsed/3600 × rate`) — no per-tick debits. A watchdog only checks every
  `METER_INTERVAL_MS` whether the balance is exhausted, so worst-case over-use is one tick.
- **Nodes + leases are in-memory:** a registry restart drops live sessions (the sockets die anyway).
  This is what keeps the DB quiet — heartbeats and the watchdog never write to Postgres.
- **SSH auth is a per-lease password** (your wallet address) over a throwaway root container; fine
  for ephemeral compute, but it's a password, not a key — use a real key flow for anything sensitive.
- **Auth:** spending the balance (rent, top-up, wallet read) requires a wallet session token, minted
  only after the user signs a single-use login nonce — so nobody can spend someone else's balance.
- `web/` uses Vite (not Next.js) deliberately: the wallet stack is client-only, so an SPA avoids
  SSR/hydration friction.
