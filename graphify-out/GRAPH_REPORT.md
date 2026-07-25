# Graph Report - .  (2026-07-25)

## Corpus Check
- 45 files · ~16,840 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 389 nodes · 641 edges · 32 communities (22 shown, 10 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.85)
- Token cost: 9,200 input · 2,600 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Sandbox Backends (dockergvisormicroVM)|Sandbox Backends (docker/gvisor/microVM)]]
- [[_COMMUNITY_Per-lease Egress Firewall|Per-lease Egress Firewall]]
- [[_COMMUNITY_Web UI (buyercontributor pages)|Web UI (buyer/contributor pages)]]
- [[_COMMUNITY_Backend Dependencies|Backend Dependencies]]
- [[_COMMUNITY_Web Dependencies|Web Dependencies]]
- [[_COMMUNITY_MongoDB Money Ledger|MongoDB Money Ledger]]
- [[_COMMUNITY_Buyer Agent & Isolation Tiers|Buyer Agent & Isolation Tiers]]
- [[_COMMUNITY_Registry Nodes, Leases & Watchdog|Registry: Nodes, Leases & Watchdog]]
- [[_COMMUNITY_Web TypeScript Config|Web TypeScript Config]]
- [[_COMMUNITY_Buyer Dependencies|Buyer Dependencies]]
- [[_COMMUNITY_Workspace Root Scripts|Workspace Root Scripts]]
- [[_COMMUNITY_Wallet Auth Nonce, JWT, Keys|Wallet Auth: Nonce, JWT, Keys]]
- [[_COMMUNITY_Contributor Dependencies|Contributor Dependencies]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Capability Probe & Backend Select|Capability Probe & Backend Select]]
- [[_COMMUNITY_Buyer TypeScript Config|Buyer TypeScript Config]]
- [[_COMMUNITY_Solana Deposits & Payouts|Solana Deposits & Payouts]]
- [[_COMMUNITY_Billing Ledger Writes|Billing Ledger Writes]]
- [[_COMMUNITY_Web App Shell & Providers|Web App Shell & Providers]]
- [[_COMMUNITY_Daemon Placement & Socket Danger|Daemon Placement & Socket Danger]]
- [[_COMMUNITY_microVM Preflight|microVM Preflight]]
- [[_COMMUNITY_Billing Math|Billing Math]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]

## God Nodes (most connected - your core abstractions)
1. `SandboxHandle` - 24 edges
2. `SandboxBackend` - 16 edges
3. `IsolationTier` - 16 edges
4. `compilerOptions` - 15 edges
5. `SandboxSpec` - 13 edges
6. `runContainer()` - 12 edges
7. `ProbeResult` - 12 edges
8. `KataFirecrackerBackend` - 11 edges
9. `DockerBackend` - 10 edges
10. `FirecrackerBackend` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Egress-abuse suspension + kill switch` --rationale_for--> `readDropCounter()`  [INFERRED]
  README.md → contributor/src/net/nft.ts
- `Never advertise a tier you can't deliver` --conceptually_related_to--> `probeBackends()`  [INFERRED]
  README.md → contributor/src/sandbox/probe.ts
- `Per-lease egress firewall` --rationale_for--> `buildNftRuleset()`  [EXTRACTED]
  README.md → contributor/src/net/nft.ts
- `Per-lease egress firewall` --references--> `applyEgress()`  [EXTRACTED]
  README.md → contributor/src/net/nft.ts
- `Never advertise a tier you can't deliver` --rationale_for--> `selectBackend()`  [EXTRACTED]
  README.md → contributor/src/sandbox/index.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **The three isolation backends** — sandbox_docker_dockerbackend, sandbox_gvisor_gvisorbackend, sandbox_kata_fc_katafirecrackerbackend, sandbox_firecracker_firecrackerbackend [EXTRACTED 0.95]
- **Egress abuse defense (rules, counter, suspend, kill)** — readme_egress_firewall, net_nft_buildnftruleset, net_nft_readdropcounter, readme_abuse_suspend [INFERRED 0.85]

## Communities (32 total, 10 thin omitted)

### Community 0 - "Sandbox Backends (docker/gvisor/microVM)"
Cohesion: 0.09
Nodes (33): Ephemeral rootfs, no shared writable mounts, microVM tier needs /dev/kvm, Pluggable SandboxBackend, DockerBackend, DockerConfig, FirecrackerBackend, run, safeRead() (+25 more)

### Community 1 - "Per-lease Egress Firewall"
Cohesion: 0.10
Nodes (27): applyEgress(), buildNftRuleset(), readDropCounter(), removeEgress(), run, table(), allow, deny (+19 more)

### Community 2 - "Web UI (buyer/contributor pages)"
Cohesion: 0.12
Nodes (17): BuyerDashboard(), chain, Lease(), rpc, TIER_LABEL, api(), CHAIN, clearToken() (+9 more)

### Community 3 - "Backend Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, cors, dotenv, express, jsonwebtoken, mongodb, @solana/kit, @solana-program/system (+14 more)

### Community 4 - "Web Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, dotenv, next, react, react-dom, @solana/kit, @solana-program/system, @solana/react (+13 more)

### Community 5 - "MongoDB Money Ledger"
Cohesion: 0.10
Nodes (20): ChargeDoc, charges, client, ContributorDoc, contributors, db, DepositDoc, deposits (+12 more)

### Community 6 - "Buyer Agent & Isolation Tiers"
Cohesion: 0.11
Nodes (14): example-buyer/docker-compose (duplicate of root), lease, Tiered isolation (container/gVisor/microVM), satisfiesTier(), candidates, free, keyPair, myAddress (+6 more)

### Community 7 - "Registry: Nodes, Leases & Watchdog"
Cohesion: 0.12
Nodes (14): Lease, contributorPayout(), app, EGRESS_DROP_LIMIT, leases, MAX_LEASE_TTL_S, METER_INTERVAL_MS, Node (+6 more)

### Community 8 - "Web TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+9 more)

### Community 9 - "Buyer Dependencies"
Cohesion: 0.12
Nodes (15): dependencies, dotenv, @solana/kit, @solana-program/system, ssh2, tweetnacl, devDependencies, tsx (+7 more)

### Community 10 - "Workspace Root Scripts"
Cohesion: 0.13
Nodes (14): devDependencies, tsx, typescript, name, private, scripts, backend, client (+6 more)

### Community 11 - "Wallet Auth: Nonce, JWT, Keys"
Cohesion: 0.16
Nodes (13): Authed, newContributorKey(), newNonce(), requireContributorKey(), requireSession(), Role, sessionAddress(), SessionClaims (+5 more)

### Community 12 - "Contributor Dependencies"
Cohesion: 0.17
Nodes (11): dependencies, dotenv, devDependencies, tsx, @types/node, name, private, scripts (+3 more)

### Community 13 - "Node TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 14 - "Capability Probe & Backend Select"
Cohesion: 0.27
Nodes (10): Never advertise a tier you can't deliver, build(), selectBackend(), BackendProbe, kvmUsable(), logCapabilities(), onPath(), probeBackends() (+2 more)

### Community 15 - "Buyer TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 16 - "Solana Deposits & Payouts"
Cohesion: 0.33
Nodes (5): b58, confirmDeposit(), payer(), payoutSol(), rpc

### Community 17 - "Billing Ledger Writes"
Cohesion: 0.29
Nodes (7): charge(), credit(), getBalance(), recordPayout(), endLease(), push(), toLeaseInfo()

### Community 19 - "Daemon Placement & Socket Danger"
Cohesion: 0.40
Nodes (5): Fixed-schema host helper (option 2), Docker socket mount = host root, Native systemd daemon (hardened), Key-only SSH by default, isSshPublicKey()

### Community 20 - "microVM Preflight"
Cohesion: 0.83
Nodes (3): bad(), ok(), preflight-microvm.sh script

### Community 21 - "Billing Math"
Cohesion: 0.67
Nodes (3): billable(), cost(), secondsRemaining()

## Knowledge Gaps
- **176 isolated node(s):** `name`, `private`, `type`, `start`, `@solana-program/system` (+171 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `IsolationTier` connect `Sandbox Backends (docker/gvisor/microVM)` to `Per-lease Egress Firewall`, `Web UI (buyer/contributor pages)`, `Buyer Agent & Isolation Tiers`, `Registry: Nodes, Leases & Watchdog`, `Capability Probe & Backend Select`?**
  _High betweenness centrality (0.097) - this node is a cross-community bridge._
- **Why does `SandboxHandle` connect `Sandbox Backends (docker/gvisor/microVM)` to `Per-lease Egress Firewall`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _176 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Sandbox Backends (docker/gvisor/microVM)` be split into smaller, more focused modules?**
  _Cohesion score 0.09306409130816505 - nodes in this community are weakly interconnected._
- **Should `Per-lease Egress Firewall` be split into smaller, more focused modules?**
  _Cohesion score 0.10483870967741936 - nodes in this community are weakly interconnected._
- **Should `Web UI (buyer/contributor pages)` be split into smaller, more focused modules?**
  _Cohesion score 0.11904761904761904 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._