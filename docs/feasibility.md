# Compatibility evidence and release gates

## What this repository can establish

The shared `/v1` contract, broker persistence/HTTP tests, reference durable inbox, and fake-harness conformance can establish generic authenticated transport behavior. They **cannot certify a real CLI's native input boundary**. Broker `delivered` always stops at the exact recipient's durable adapter inbox.

The executable contract fixtures and pinned research links are documented in [contract.md](contract.md#real-harness-release-gates). The detailed safety requirements are in [spec-v1.md](spec-v1.md#9-adapter-contract-safe-conversational-delivery). Runtime/container verification limits are in [operations.md](operations.md).

## Real CLI status

| CLI | Installed/tested native CLI version in this repository | Automatic final-hop certification | Required evidence before claiming support |
| --- | --- | --- | --- |
| Pi | Not installed/tested here. Research source revision `36be9c612e64082a4f0d4d0a94706c38ecbc20a1` only. | Unverified | Exact-session extension ownership; native follow-up behavior; active generation, approval/input/draft and abort guards; provider-visible provenance; native acceptance/ambiguity recovery. |
| Antigravity CLI | No tested CLI version. | Unverified | Distinguish exclusive managed stream-JSON from pre-existing interactive CLI. Prove safe result boundaries and prompt/permission behavior; otherwise cooperative-only or unsupported. |
| Claude Code | No tested CLI version. | Unverified | Explicit compatible Channel/managed/cooperative opt-in; notification receipt is not native acceptance; no permission relay; prompt/abort race and provenance tests. |
| OpenCode | No tested CLI version. | Unverified | Connect to the exact intended server/session; prove exclusive input arbitration or native queue; approval/draft races; native receipt/idempotency reconciliation. |

A separate adapter implementation, documentation probe, or unit-test fake does not change these cells until its real pinned-CLI evidence is linked. A locally unsupported/cooperative-only adapter may still durably receive/ACK and retain messages without touching a TUI. Do not downgrade by terminal typing or silently infer transport from model names.

## Simulated transport matrix

`npm run demo` tests all 16 type-family routes over the real HTTP service into durable reference inboxes, using eight distinct identities (two per family). All inputs remain locally pending; there is no native CLI execution or LLM call. This verifies type-neutral exact-address transport, not any cell of the real-harness matrix below.

## Directed real-harness matrix

All entries below are **not certified** by this broker-core implementation. Diagonal cells mean two distinct same-family session incarnations, not self-messaging or shared IDs.

| Sender → receiver | Pi | Antigravity CLI | Claude Code | OpenCode |
| --- | --- | --- | --- | --- |
| Pi | Not certified | Not certified | Not certified | Not certified |
| Antigravity CLI | Not certified | Not certified | Not certified | Not certified |
| Claude Code | Not certified | Not certified | Not certified | Not certified |
| OpenCode | Not certified | Not certified | Not certified | Not certified |

The release record for each supported cell must name both pinned CLI versions, adapter revisions, mode (`native_followup`, `managed_serial`, or `cooperative_pull`), exact-session topology, observed model-visible provenance, prompt/draft/abort/race tests, and native acceptance/crash-window behavior. Cooperative mode must explicitly disclose that it has no unsolicited wakeup guarantee. Local injection uncertainty pauses that FIFO head until supported reconciliation/operator resolution; it never produces a fake broker task state.

## Environment evidence boundary

- **Locally executable:** Node 24.19.0 / SQLite 3.53.3 contract, store, HTTP/TLS, restart/backup, and reference/fake-harness suites available in this repository. Use the exact commit's test output, not this list, as pass evidence.
- **Container build/runtime:** not locally run in the implementation executor because Podman/Docker were unavailable. Docker build/test and nonroot isolated entrypoint smoke passed in the linked [verification record](verification.md#recorded-ci-evidence). Local Podman remains unrun; check a new exact commit's workflow conclusion before carrying that evidence forward.
- **Rootless Podman, Fedora Quadlet/SELinux, separate same-host agent containers, and two-host LAN:** templates/gates only; not established by local HTTP or Docker CI.
- **Human's installed CLIs and workstation:** not accessed, installed, configured, or used for these tests.

A broker-core draft is useful before all native adapter gates pass, but it is not a universal four-CLI release. Keep the remaining issues open until their own acceptance evidence exists.
