# Graph Report - .  (2026-07-26)

## Corpus Check
- Corpus is ~15,838 words - fits in a single context window. You may not need a graph.

## Summary
- 355 nodes · 502 edges · 24 communities (19 shown, 5 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.9)
- Token cost: 50,453 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Web App & Dashboards|Web App & Dashboards]]
- [[_COMMUNITY_Contributor Daemon & Sandbox|Contributor Daemon & Sandbox]]
- [[_COMMUNITY_Contributor Setup & Safety|Contributor Setup & Safety]]
- [[_COMMUNITY_MongoDB Money Ledger|MongoDB Money Ledger]]
- [[_COMMUNITY_Backend Dependencies|Backend Dependencies]]
- [[_COMMUNITY_Web Dependencies|Web Dependencies]]
- [[_COMMUNITY_Web TypeScript Config|Web TypeScript Config]]
- [[_COMMUNITY_Registry Nodes, Leases, Watchdog|Registry: Nodes, Leases, Watchdog]]
- [[_COMMUNITY_Buyer Agent Dependencies|Buyer Agent Dependencies]]
- [[_COMMUNITY_Autonomous Buyer Agent|Autonomous Buyer Agent]]
- [[_COMMUNITY_Workspace Root Scripts|Workspace Root Scripts]]
- [[_COMMUNITY_Wallet Auth Nonce, JWT, Keys|Wallet Auth: Nonce, JWT, Keys]]
- [[_COMMUNITY_Contributor Dependencies|Contributor Dependencies]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Billing Math & Ledger Writes|Billing Math & Ledger Writes]]
- [[_COMMUNITY_Buyer TypeScript Config|Buyer TypeScript Config]]
- [[_COMMUNITY_Marketplace Architecture Concepts|Marketplace Architecture Concepts]]
- [[_COMMUNITY_Solana Deposits & Payouts|Solana Deposits & Payouts]]
- [[_COMMUNITY_Web App Shell & Providers|Web App Shell & Providers]]
- [[_COMMUNITY_Reaper Teardown Test|Reaper Teardown Test]]
- [[_COMMUNITY_Sandbox Entrypoint Script|Sandbox Entrypoint Script]]
- [[_COMMUNITY_Next.js Static Export Config|Next.js Static Export Config]]
- [[_COMMUNITY_GHCR Image Release|GHCR Image Release]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 15 edges
2. `runContainer()` - 11 edges
3. `compilerOptions` - 9 edges
4. `compilerOptions` - 9 edges
5. `destroyContainer()` - 8 edges
6. `Contributor Daemon` - 8 edges
7. `Lease Sandbox Container` - 8 edges
8. `endLease()` - 7 edges
9. `scripts` - 7 edges
10. `RAVEN Compute Marketplace` - 7 edges

## Surprising Connections (you probably didn't know these)
- `systemd Unit raven-contributor.service` --semantically_similar_to--> `Docker Socket Mount (sibling containers)`  [INFERRED] [semantically similar]
  contributor/docs/daemon-isolation.md → README.md
- `example-buyer/README (duplicate of root)` --semantically_similar_to--> `RAVEN Compute Marketplace`  [EXTRACTED] [semantically similar]
  example-buyer/README.md → README.md
- `example-buyer/docker-compose (duplicate of root)` --semantically_similar_to--> `Compose service: backend`  [EXTRACTED] [semantically similar]
  example-buyer/docker-compose.yml → docker-compose.yml
- `Compose service: backend` --implements--> `Backend Registry (Express :4000)`  [INFERRED]
  docker-compose.yml → README.md
- `Compose service: contributor` --implements--> `Contributor Daemon`  [INFERRED]
  docker-compose.yml → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Guaranteed Lease Teardown** — readme_sandbox_container, readme_orphan_reaper, readme_kill_switch, readme_lease_flow [EXTRACTED 1.00]
- **Custodial Top-Up, Billing and Payout Path** — readme_custodial_ledger, readme_mongodb, readme_solana_devnet, readme_billing_watchdog, readme_raven_key [EXTRACTED 1.00]
- **Shared-Kernel Isolation Ceiling and Its Alternatives** — docs_daemon_isolation_buyer_boundary, docs_daemon_isolation_daemon_boundary, docs_daemon_isolation_gvisor, docs_daemon_isolation_firecracker, docs_daemon_isolation_dedicated_disposable_host [EXTRACTED 1.00]

## Communities (24 total, 5 thin omitted)

### Community 0 - "Web App & Dashboards"
Cohesion: 0.09
Nodes (30): api(), BASE, CHAIN, clearToken(), clock(), getToken(), Role, setToken() (+22 more)

### Community 1 - "Contributor Daemon & Sandbox"
Cohesion: 0.12
Nodes (27): boreTunnel(), box(), built, destroyContainer(), ensureImage(), lanIp(), listContainers(), OciConfig (+19 more)

### Community 2 - "Contributor Setup & Safety"
Cohesion: 0.10
Nodes (32): Step 1 — Create rvn_ctb Key in Web App, Contributor Env Knobs, Contributor Host Requirements, Contributor Safety Model, Contributor Setup Flow (clone, .env, compose up), TUNNEL_MODE (bore vs local), Compose service: backend, Compose service: contributor (+24 more)

### Community 3 - "MongoDB Money Ledger"
Cohesion: 0.08
Nodes (24): buyerTotals(), ChargeDoc, charges, client, ContributorDoc, ContributorKey, contributors, contributorTotals() (+16 more)

### Community 4 - "Backend Dependencies"
Cohesion: 0.09
Nodes (22): dependencies, cors, dotenv, express, jsonwebtoken, mongodb, @solana/kit, @solana-program/system (+14 more)

### Community 5 - "Web Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, dotenv, next, react, react-dom, @solana/kit, @solana-program/system, @solana/react (+13 more)

### Community 6 - "Web TypeScript Config"
Cohesion: 0.11
Nodes (17): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+9 more)

### Community 7 - "Registry: Nodes, Leases, Watchdog"
Cohesion: 0.12
Nodes (13): Lease, contributorPayout(), initSchema(), app, leases, MAX_LEASE_TTL_S, METER_INTERVAL_MS, Node (+5 more)

### Community 8 - "Buyer Agent Dependencies"
Cohesion: 0.12
Nodes (15): dependencies, dotenv, @solana/kit, @solana-program/system, ssh2, tweetnacl, devDependencies, tsx (+7 more)

### Community 9 - "Autonomous Buyer Agent"
Cohesion: 0.13
Nodes (10): lease, free, keyPair, myAddress, secretKey, sol(), sshKeys, topUp() (+2 more)

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

### Community 14 - "Billing Math & Ledger Writes"
Cohesion: 0.24
Nodes (10): billable(), cost(), secondsRemaining(), charge(), credit(), getBalance(), recordPayout(), endLease() (+2 more)

### Community 15 - "Buyer TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 16 - "Marketplace Architecture Concepts"
Cohesion: 0.20
Nodes (10): Compose service: buyer, Billing Watchdog (charge once at lease end), Custodial Off-Chain Balance Ledger, Example Autonomous Buyer Agent, In-Memory Nodes and Leases, JWT Session (SESSION_SECRET, 24h), Lease Lifecycle (rent, ready, release), MongoDB Money State (+2 more)

### Community 17 - "Solana Deposits & Payouts"
Cohesion: 0.33
Nodes (5): b58, confirmDeposit(), payer(), payoutSol(), rpc

## Knowledge Gaps
- **164 isolated node(s):** `name`, `private`, `type`, `start`, `dev` (+159 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `example-buyer/docker-compose (duplicate of root)` connect `Contributor Setup & Safety` to `Autonomous Buyer Agent`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _166 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Web App & Dashboards` be split into smaller, more focused modules?**
  _Cohesion score 0.08879492600422834 - nodes in this community are weakly interconnected._
- **Should `Contributor Daemon & Sandbox` be split into smaller, more focused modules?**
  _Cohesion score 0.12436974789915967 - nodes in this community are weakly interconnected._
- **Should `Contributor Setup & Safety` be split into smaller, more focused modules?**
  _Cohesion score 0.1028225806451613 - nodes in this community are weakly interconnected._
- **Should `MongoDB Money Ledger` be split into smaller, more focused modules?**
  _Cohesion score 0.08 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._