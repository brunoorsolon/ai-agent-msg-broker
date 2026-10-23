# Development-preview verification

This record distinguishes executable broker/reference evidence from real-harness and deployment gates. All tests use isolated temporary data and disposable test-only credentials/certificates; they do not provision ongoing access.

## Local checkpoint — 2026-10-23

Runtime queried from the actual binary: Node.js **24.19.0**, bundled SQLite **3.53.3**.

| Check | Result |
| --- | --- |
| `npm test` | **117 tests passed**, no skips/failures at this checkpoint |
| `npm run check` | Passed; JavaScript syntax checks, not a TypeScript type-check |
| `npm run smoke` | Passed; actual service entrypoint, nonroot, readiness/auth, graceful shutdown |
| `npm run demo` | Included in aggregate; all 16 simulated family routes across eight distinct reference-session identities |
| Local container build/run | Not run: neither Docker nor Podman was available |
| CI container build/run | **Passed** at code checkpoint `e015a6f5d7cc32d0c0a90bd633fab8d94195417a`; linked evidence below |
| Rootless Podman 4.9.3 on Ubuntu 24.04 CI | **Passed** at `afbda8424ec82f468a6b34f929b36c9a8f060680`; keep-id, private bind volumes, no network and restart smoke |
| Fedora Quadlet/SELinux and two-host LAN | Not run; templates and manual gates only |
| Real Pi/Antigravity CLI/Claude Code/OpenCode final hop | Not certified; [isolated Pi 1.4 probe](probes/pi-1.4/README.md) records narrower actual-Pi observations only |

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
- Stop during initial attachment, reconnect or lifecycle preflight drains bounded in-flight transitions, prevents late loops, and closes the final known epoch. Concurrent shutdown waits for the same close; unknown remote effects still fall back to lease expiry.

## Independent review

The implementation received a separate read-only security/protocol review. Identified defects were fixed with regression tests before the corresponding checkpoint was described as passing. This is not a third-party security certification. Draft PR review and native/deployment acceptance gates remain distinct.

`delivered` always means durable adapter-inbox receipt, never native harness acceptance, model processing, conversation completion, or human authorization. See [feasibility.md](feasibility.md) for the deliberately uncertified real-harness matrix.

## Recorded CI evidence

Code checkpoint `e015a6f5d7cc32d0c0a90bd633fab8d94195417a` passed both [push run 39972853462](https://github.com/brunoorsolon/ai-agent-msg-broker/actions/runs/39972853462) and [PR run 39972854253](https://github.com/brunoorsolon/ai-agent-msg-broker/actions/runs/39972854253). Job logs confirm 109/109 core tests, 109/109 in the Docker build test stage, six nonroot HTTP tests with `--network none`, a slim nonroot runtime build, and the actual entrypoint smoke with a read-only root filesystem and disposable tmpfs data. No image was pushed to a registry.

The Containerfile pins the two official image digests resolved in that run. Both Docker and Podman ignore files exclude private build-context material. These packaging-only changes receive a new exact-commit CI run; they do not change the shared adapter API/code checkpoint. Native CLI certification, Fedora Quadlet/SELinux and two-host LAN gates remain distinct.

### Rootless Podman CI

Checkpoint `afbda8424ec82f468a6b34f929b36c9a8f060680` passed [push run 39975019482](https://github.com/brunoorsolon/ai-agent-msg-broker/actions/runs/39975019482) and [PR run 39975028574](https://github.com/brunoorsolon/ai-agent-msg-broker/actions/runs/39975028574), including all core, Docker and rootless-Podman jobs. The existing Ubuntu 24.04 runner (`20261012.334.1`) supplied Podman **4.9.3**; the job required a nonroot host UID and rootless mode rather than installing software or changing host security.

The digest-pinned runtime built under rootless Podman. `scripts/podman-smoke.mjs` verified `--userns=keep-id`, private host-owned writable data, read-only configuration and root filesystem, dropped capabilities and `no-new-privileges`, with `--network=none` and no published ports. Its actual broker process survived a SIGKILL/restart with durable send replay, invalidated old epochs, redelivery and the delivered-completion API; SIGTERM exited cleanly. Tokens and state were disposable fixture files and removed afterwards. Logs confirm both before/after-restart probes and the final smoke succeeded. No registry image or production credential was created.

This establishes the bounded **Ubuntu rootless container** scenario only. It does not establish Fedora SELinux relabeling (`:Z`), Quadlet/systemd installation/autostart, the user's filesystem/runtime, separate agent-container networking, real TLS/LAN ingress, or two-host connectivity. Those remain operator/native acceptance gates.

## Archived Pi runtime probe

The [Pi 1.4 probe](probes/pi-1.4/README.md) preserves an actual official Pi runtime run with the pinned historical broker `e015a6f5d7cc32d0c0a90bd633fab8d94195417a`, a deterministic local provider, injected Terminal and synthetic managed Antigravity child. It observed held-tool/human-Enter ordering before native follow-up, provider-visible untrusted provenance, heartbeat independence, and old-session shutdown. The Pi item deliberately remains pending because the native void API is not an acceptance receipt. This separate manually run probe is **not part of `npm test`**, a production Pi adapter, a physical PTY test, or a four-CLI compatibility certification. Its source manifest refuses different named bytes; use its exact snapshots rather than silently running against a later shared-runtime revision.
