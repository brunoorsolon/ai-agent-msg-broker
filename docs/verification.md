# Development-preview verification

This record distinguishes executable broker/reference evidence from real-harness and deployment gates. All tests use isolated temporary data and disposable test-only credentials/certificates; they do not provision ongoing access.

## Local checkpoint — 2026-10-23

Runtime queried from the actual binary: Node.js **24.19.0**, bundled SQLite **3.53.3**.

| Check | Result |
| --- | --- |
| `npm test` | **109 tests passed**, no skips/failures at this checkpoint |
| `npm run check` | Passed; JavaScript syntax checks, not a TypeScript type-check |
| `npm run smoke` | Passed; actual service entrypoint, nonroot, readiness/auth, graceful shutdown |
| `npm run demo` | Included in aggregate; all 16 simulated family routes across eight distinct reference-session identities |
| Local container build/run | Not run: neither Docker nor Podman was available |
| CI container build/run | Workflow provided; verify the exact commit's Actions conclusion before treating as passed |
| Rootless Podman/Quadlet/SELinux and two-host LAN | Not run; templates and manual gates only |
| Real Pi/Antigravity CLI/Claude Code/OpenCode final hop | Not certified by this repository's tests |

The exact command output for a later commit supersedes the checkpoint count above.

## Covered boundaries

- Strict request/response fixtures, canonical immutable-envelope serialization/digest, bounded Unicode/UTF-8 fields, and safe error references.
- Exact owned identities, duplicate names/types/models, metadata CAS/snapshots, reconnect idempotency, lease expiry and old-epoch fencing.
- Per-token type/scope restrictions, operator policy shrink, token rotation/revocation during a long poll, no unauthenticated `/v1` exception, no CORS/browser authority.
- Trusted TLS succeeds; untrusted certificates and hostname mismatches fail for both the service and reference client.
- Atomic acceptance before receipts, concurrent recipient sequence allocation, replay precedence over mutable metadata/recipient/quota/rate checks, FIFO claims and duplicate completion.
- Before/after-commit faults, conservative unknown effects, failed-rollback writer poisoning, exact TTL beyond a cleanup batch, uncertain prior claims, quotas/rate/storage pressure, bounded retention.
- Actual broker **SIGKILL/restart** preserves WAL messages/send dedupe while invalidating old leases/claims; schema v1→v2 migration and online SQLite backup/restore preserve durable records.
- Reference inbox commits before ACK, survives crashes, deduplicates immutable envelopes, enforces count/byte/ledger/disk limits and process-exclusive ownership. Uncertain local commits never send a negative ACK.
- Independent heartbeat transport across 12 simulated minutes of busy/approval/input/draft/abort/unknown local harness conditions makes no model calls.
- Local injection intent/receipt separation, fail-closed arbitration, ambiguity pause, escaped model-visible agent provenance, and non-consuming cooperative peek.
- Minimal local stdio MCP handshake/tools, bounded frames/concurrency/output, redacted failures, no channels, permission relay, HTTP listener or model sampling.
- Absolute client deadlines, Retry-After and persisted keys; stale registration responses are reconciled against current owned state rather than treated as fresh leases or clocks.

## Independent review

The implementation received a separate read-only security/protocol review. Identified defects were fixed with regression tests before the corresponding checkpoint was described as passing. This is not a third-party security certification. Draft PR review and native/deployment acceptance gates remain distinct.

`delivered` always means durable adapter-inbox receipt, never native harness acceptance, model processing, conversation completion, or human authorization. See [feasibility.md](feasibility.md) for the deliberately uncertified real-harness matrix.
