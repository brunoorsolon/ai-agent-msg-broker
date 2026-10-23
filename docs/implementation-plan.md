# Implementation plan

The backlog is intentionally split into **11 implementable slices**, not a one-day rewrite. Stable planning keys below map to the linked GitHub issues. Each issue contains its implementation scope, acceptance criteria, and actual dependency links.

The [v1 specification](spec-v1.md) is the source of truth. The broker owns recipient identity/metadata/presence and opaque-message delivery only. Harness scheduling, human-prompt safety, and native injection recovery remain local adapter responsibilities. `delivered` means a durable inbox tied to the exact recipient session has accepted the message, never that an LLM read, answered, or completed it.

## Dependency map

```text
B01 contract + feasibility
 └─ B02 secure broker/storage foundation
     └─ B03 registry + leases
         └─ B04 durable acceptance + receipts
             └─ B05 delivery claims + ACKs
                 └─ B06 reference adapter runtime + local facade
                     ├─ B07 Pi integration
                     ├─ B08 Antigravity CLI adapter
                     ├─ B09 Claude Code adapter
                     └─ B10 OpenCode adapter
                         └─ B11 packaging + recovery + full conformance
```

The diagram shows the critical path, not a prohibition on parallel work. Contract fixtures and feasibility probes start first; packaging/security tests can start after B02; adapters can prototype against B01 fixtures but cannot declare compatibility until B06 and their real-harness gates pass. The full B11 milestone depends on all four adapters. A clearly labeled broker-core or partial-adapter release need not wait for an unsupported CLI mode.

## Slices

| Key | Issue title | Main outcome | Depends on |
| --- | --- | --- | --- |
| B01 / [#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1) | [Define versioned API contract and adapter feasibility gates](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1) | Canonical schema/fixtures and honest feasibility matrix | — |
| B02 / [#2](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/2) | [Build secure broker foundation with local SQLite and health checks](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/2) | Secure startup, auth/TLS, local SQLite, health/readiness | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1) |
| B03 / [#3](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/3) | [Implement immutable session registry, metadata, and heartbeat leases](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/3) | Owned immutable identities, metadata, reconnect fencing, zero-token presence | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B02/#2](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/2) |
| B04 / [#4](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/4) | [Persist idempotent message acceptance, receipts, quotas, and retention](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/4) | Transactional send/idempotency, exact routing, quotas, receipts/retention | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B02/#2](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/2), [B03/#3](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/3) |
| B05 / [#5](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/5) | [Implement fenced long-poll delivery and durable inbox acknowledgments](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/5) | FIFO long-poll claims and durable-inbox ACK/recovery | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B02/#2](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/2), [B03/#3](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/3), [B04/#4](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/4) |
| B06 / [#6](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6) | [Build reference adapter runtime, durable inbox, and local tool facade](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6) | Reusable client/supervisor, durable inbox/dedupe, local tool facade | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B03/#3](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/3), [B04/#4](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/4), [B05/#5](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/5) |
| B07 / [#7](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/7) | [Integrate Pi review-pair through a verified non-interrupting adapter](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/7) | Pi integration with verified follow-up/provenance/prompt guards | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B06/#6](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6) |
| B08 / [#8](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/8) | [Implement Antigravity CLI adapter with managed and cooperative gates](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/8) | Antigravity managed/cooperative modes without fake TUI wakeups | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B06/#6](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6) |
| B09 / [#9](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/9) | [Implement Claude Code adapter with channel safety and receipt gates](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/9) | Claude channel/managed gates without permission relay | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B06/#6](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6) |
| B10 / [#10](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/10) | [Implement OpenCode adapter with session-exact input arbitration](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/10) | OpenCode session-exact and race-safe local scheduling | [B01/#1](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/1), [B06/#6](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6) |
| B11 / [#11](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/11) | [Package LAN deployment and prove recovery plus any-to-any conformance](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/11) | Podman/LAN operations, restore tests, published directed matrix | [B02/#2](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/2), [B03/#3](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/3), [B04/#4](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/4), [B05/#5](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/5), [B06/#6](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/6), [B07/#7](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/7), [B08/#8](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/8), [B09/#9](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/9), [B10/#10](https://github.com/brunoorsolon/ai-agent-msg-broker/issues/10) |

## Milestones and gates

### M1 — Contract and core
B01–B05. Real durable storage, authenticated registry, exact routing, stable receipts, deterministic failure tests, and no application/task semantics. No claim of real-harness support yet.

### M2 — Reusable adapter and first safe integration
B06 plus B07 or whichever harness first proves the required native/managed/cooperative path. Durable local inbox ACK is separate from native input acceptance. Missing final-hop capability must be documented, never hidden with terminal automation.

### M3 — Four-harness compatibility
B07–B10, each with pinned versions, explicit modes, human-input and non-interruption tests, model-visible provenance, and crash-window evidence. Separate adapter repositories own their implementation; broker issues track dependencies and cross-repository links. Merely opening these issues does not create those repositories or authorize their implementation/deployment.

### M4 — Operable LAN release
B11. Same-host Podman and two-host LAN topologies, auth/TLS, storage/migration/backup/restore, resource bounds, and all 16 directed family routes (12 cross-family plus four same-family with distinct sessions). Publish a partial matrix if a mode remains blocked; do not call it universal support.

## Definition of done for each issue

- Implementation matches the canonical contract; deviations are explicit reviewed spec changes.
- Focused tests and the relevant aggregate suite run, with passed/failed/not-run clearly distinguished.
- Security-sensitive failure paths, retries, and uncertain outcomes are tested, not just the happy path.
- Documentation and technical errors are concise English, point to the exact contract/field, explain a safe action, and contain no secrets or private host data.
- Adapter claims include actual CLI version/mode/evidence; a fake harness is not a real-harness certification.
- No deployment, credential provisioning, unrelated repository mutation, or broad permission changes are implied by finishing a planning/documentation task.
