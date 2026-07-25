# Graph Report - .  (2026-07-24)

## Corpus Check
- Corpus is ~6,263 words - fits in a single context window. You may not need a graph.

## Summary
- 215 nodes · 271 edges · 13 communities
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.88)
- Token cost: 21,500 input · 4,200 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Registry, Billing & Ledger|Registry, Billing & Ledger]]
- [[_COMMUNITY_Backend Dependencies|Backend Dependencies]]
- [[_COMMUNITY_Autonomous Buyer Agent|Autonomous Buyer Agent]]
- [[_COMMUNITY_Web Wallet Dependencies|Web Wallet Dependencies]]
- [[_COMMUNITY_Contributor Sandbox & Tunnel|Contributor Sandbox & Tunnel]]
- [[_COMMUNITY_Buyer Dependencies|Buyer Dependencies]]
- [[_COMMUNITY_Workspace Root Scripts|Workspace Root Scripts]]
- [[_COMMUNITY_Web UI Components|Web UI Components]]
- [[_COMMUNITY_Web TypeScript Config|Web TypeScript Config]]
- [[_COMMUNITY_Contributor Dependencies|Contributor Dependencies]]
- [[_COMMUNITY_Node TypeScript Config|Node TypeScript Config]]
- [[_COMMUNITY_Rental Paths & SPA Shell|Rental Paths & SPA Shell]]

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 10 edges
2. `endLease()` - 9 edges
3. `compilerOptions` - 9 edges
4. `scripts` - 7 edges
5. `start()` - 6 edges
6. `cost()` - 5 edges
7. `payoutSol()` - 5 edges
8. `run` - 5 edges
9. `scripts` - 4 edges
10. `billable()` - 4 edges

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
Nodes (40): Lease, nodes, backend compose service, Custodial balance model, Deposit idempotency by signature, Env precedence (inline > app .env > root .env), Nodes and leases kept in memory, Prorated pay-per-second billing (+32 more)

### Community 1 - "Backend Dependencies"
Cohesion: 0.09
Nodes (21): dependencies, cors, dotenv, express, pg, @solana/kit, @solana-program/system, tweetnacl (+13 more)

### Community 2 - "Autonomous Buyer Agent"
Cohesion: 0.11
Nodes (16): buyer compose service, lease, nodes, Per-lease SSH password, LeaseInfo, LeaseStatus, NodeInfo, keyPair (+8 more)

### Community 3 - "Web Wallet Dependencies"
Cohesion: 0.10
Nodes (19): dependencies, react, react-dom, @solana/kit, @solana-program/system, @solana/react, @wallet-standard/react, devDependencies (+11 more)

### Community 4 - "Contributor Sandbox & Tunnel"
Cohesion: 0.23
Nodes (15): contributor compose service, Host Docker socket mount, bore outbound tunnel, Sibling-container sandbox, NodeCommand, boreTunnel(), box(), CPUS (+7 more)

### Community 5 - "Buyer Dependencies"
Cohesion: 0.12
Nodes (15): dependencies, dotenv, @solana/kit, @solana-program/system, ssh2, tweetnacl, devDependencies, tsx (+7 more)

### Community 6 - "Workspace Root Scripts"
Cohesion: 0.13
Nodes (14): devDependencies, tsx, typescript, name, private, scripts, backend, client (+6 more)

### Community 7 - "Web UI Components"
Cohesion: 0.24
Nodes (8): api(), CHAIN, clock(), sol(), chain, Lease(), rpc, Wallet()

### Community 8 - "Web TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, jsx, lib, module, moduleResolution, noEmit, skipLibCheck, strict (+3 more)

### Community 9 - "Contributor Dependencies"
Cohesion: 0.18
Nodes (10): dependencies, dotenv, devDependencies, tsx, @types/node, name, private, scripts (+2 more)

### Community 10 - "Node TypeScript Config"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, module, moduleResolution, noEmit, skipLibCheck, strict, target (+2 more)

### Community 11 - "Rental Paths & SPA Shell"
Cohesion: 0.29
Nodes (6): Autonomous agent rental path, Human rental path, Vite SPA instead of Next.js, App(), Inline dark terminal theme, Web SPA shell

## Knowledge Gaps
- **109 isolated node(s):** `name`, `private`, `type`, `start`, `dev` (+104 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NodeInfo` connect `Autonomous Buyer Agent` to `Registry, Billing & Ledger`, `Web UI Components`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `LeaseInfo` connect `Autonomous Buyer Agent` to `Registry, Billing & Ledger`, `Web UI Components`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `App()` connect `Rental Paths & SPA Shell` to `Web UI Components`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `name`, `private`, `type` to the rest of the system?**
  _109 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Registry, Billing & Ledger` be split into smaller, more focused modules?**
  _Cohesion score 0.06693877551020408 - nodes in this community are weakly interconnected._
- **Should `Backend Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Autonomous Buyer Agent` be split into smaller, more focused modules?**
  _Cohesion score 0.10952380952380952 - nodes in this community are weakly interconnected._