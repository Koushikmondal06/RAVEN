# Graph Report - .  (2026-07-25)

## Corpus Check
- Corpus is ~7,258 words - fits in a single context window. You may not need a graph.

## Summary
- 228 nodes · 284 edges · 13 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.88)
- Token cost: 3,800 input · 600 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Registry, Billing & Ledger|Registry, Billing & Ledger]]
- [[_COMMUNITY_Contributor, Compose & Shared Types|Contributor, Compose & Shared Types]]
- [[_COMMUNITY_Backend Dependencies|Backend Dependencies]]
- [[_COMMUNITY_Web UI & Rental Paths|Web UI & Rental Paths]]
- [[_COMMUNITY_Web Wallet Dependencies|Web Wallet Dependencies]]
- [[_COMMUNITY_Buyer Dependencies|Buyer Dependencies]]
- [[_COMMUNITY_Contributor Sandbox & Tunnel|Contributor Sandbox & Tunnel]]
- [[_COMMUNITY_Workspace Root Scripts|Workspace Root Scripts]]
- [[_COMMUNITY_Web TypeScript Config|Web TypeScript Config]]
- [[_COMMUNITY_Contributor Dependencies|Contributor Dependencies]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Buyer TypeScript Config|Buyer TypeScript Config]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 10 edges
2. `endLease()` - 9 edges
3. `compilerOptions` - 9 edges
4. `compilerOptions` - 9 edges
5. `scripts` - 7 edges
6. `start()` - 6 edges
7. `cost()` - 5 edges
8. `payoutSol()` - 5 edges
9. `run` - 5 edges
10. `scripts` - 4 edges

## Surprising Connections (you probably didn't know these)
- `bore outbound tunnel` --semantically_similar_to--> `lanIp()`  [INFERRED] [semantically similar]
  README.md → contributor/src/index.ts
- `Host Docker socket mount` --rationale_for--> `run`  [INFERRED]
  docker-compose.yml → contributor/src/index.ts
- `Balance-exhaustion watchdog` --conceptually_related_to--> `secondsRemaining()`  [INFERRED]
  README.md → backend/src/billing.ts
- `Prorated pay-per-second billing` --references--> `charge()`  [INFERRED]
  README.md → backend/src/db.ts
- `Balance-exhaustion watchdog` --rationale_for--> `endLease()`  [INFERRED]
  README.md → backend/src/index.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Money settlement flow (deposit, charge, payout)** — readme_custodial_model, src_solana_confirmdeposit, src_db_credit, src_index_endlease, src_db_charge, src_solana_payoutsol, src_db_recordpayout [EXTRACTED 0.95]
- **Sandbox lifecycle (start, tunnel, tear down)** — readme_sibling_container_sandbox, readme_bore_tunnel, src_index_box, src_index_tunnelbox, readme_per_lease_password, sandbox_start [EXTRACTED 0.95]
- **Trust-boundary checks before money moves** — readme_wallet_nonce_auth, src_solana_verifymessagesignature, src_index_auth, readme_deposit_idempotency, src_solana_confirmdeposit [INFERRED 0.85]

## Communities (13 total, 0 thin omitted)

### Community 0 - "Registry, Billing & Ledger"
Cohesion: 0.07
Nodes (39): Lease, nodes, example-buyer/README (duplicate of root), Custodial balance model, Deposit idempotency by signature, Nodes and leases kept in memory, Prorated pay-per-second billing, RAVEN — rent compute, pay in SOL (+31 more)

### Community 1 - "Contributor, Compose & Shared Types"
Cohesion: 0.09
Nodes (20): backend compose service, buyer compose service, example-buyer/docker-compose (duplicate of root), lease, nodes, Env precedence (inline > app .env > root .env), Per-lease SSH password, LeaseInfo (+12 more)

### Community 2 - "Backend Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, cors, dotenv, express, pg, @solana/kit, @solana-program/system, tweetnacl (+13 more)

### Community 3 - "Web UI & Rental Paths"
Cohesion: 0.14
Nodes (14): Autonomous agent rental path, Human rental path, Vite SPA instead of Next.js, api(), CHAIN, clock(), sol(), App() (+6 more)

### Community 4 - "Web Wallet Dependencies"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, @solana/kit, @solana-program/system, @solana/react, @wallet-standard/react, devDependencies (+11 more)

### Community 5 - "Buyer Dependencies"
Cohesion: 0.12
Nodes (15): dependencies, dotenv, @solana/kit, @solana-program/system, ssh2, tweetnacl, devDependencies, tsx (+7 more)

### Community 6 - "Contributor Sandbox & Tunnel"
Cohesion: 0.25
Nodes (14): contributor compose service, Host Docker socket mount, bore outbound tunnel, Sibling-container sandbox, boreTunnel(), box(), CPUS, lanIp() (+6 more)

### Community 7 - "Workspace Root Scripts"
Cohesion: 0.13
Nodes (14): devDependencies, tsx, typescript, name, private, scripts, backend, client (+6 more)

### Community 8 - "Web TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, jsx, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+3 more)

### Community 9 - "Contributor Dependencies"
Cohesion: 0.18
Nodes (10): dependencies, dotenv, devDependencies, tsx, @types/node, name, private, scripts (+2 more)

### Community 10 - "Node TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 11 - "Buyer TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

## Knowledge Gaps
- **119 isolated node(s):** `name`, `private`, `type`, `start`, `dev` (+114 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NodeInfo` connect `Contributor, Compose & Shared Types` to `Registry, Billing & Ledger`, `Web UI & Rental Paths`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `LeaseInfo` connect `Contributor, Compose & Shared Types` to `Registry, Billing & Ledger`, `Web UI & Rental Paths`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _119 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Registry, Billing & Ledger` be split into smaller, more focused modules?**
  _Cohesion score 0.0700354609929078 - nodes in this community are weakly interconnected._
- **Should `Contributor, Compose & Shared Types` be split into smaller, more focused modules?**
  _Cohesion score 0.08923076923076922 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Web UI & Rental Paths` be split into smaller, more focused modules?**
  _Cohesion score 0.1368421052631579 - nodes in this community are weakly interconnected._