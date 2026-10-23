# v1 wire contract and interoperability

`openapi.json` is the OpenAPI 3.1 contract. `src/protocol.mjs` is the dependency-free executable request/envelope validation and canonicalization implementation. The [specification](spec-v1.md) remains the semantic source of truth. Unknown mutation fields are rejected: this protocol has no task, progress, conversation, human-approval, or model-processing state.

## Durable boundaries

- A send `202` follows a durable broker acceptance transaction. It is not delivery.
- A claim grants one recipient a fenced, expiring transport attempt. It is not delivery.
- A `delivered` receipt means the exact recipient adapter committed the immutable envelope and deduplication record to its session-bound durable inbox before ACK. It is not native harness input acceptance, model processing, or task completion.
- `expired`/`failed` with `delivery_uncertain: true` cannot prove the inbox never received an earlier unacknowledged claim. Nothing retracts already-accepted input.
- Local native-input intent, acceptance, and ambiguity belong only to the adapter journal. A missing native receipt cannot be repaired by inventing a broker state.

## Serialization and digest: `sha256-canonical-json-v1`

The digest input is **only the immutable `Envelope` object**, validated before use. Never hash the enclosing claim response or add claim ID, attempt count, lease epoch, claim expiry, request headers, or local injection data.

1. Reject malformed Unicode (unpaired UTF-16 surrogates), undefined/non-JSON values, cycles, nonfinite numbers, unsafe integral numbers, sparse arrays, and nesting deeper than 32 levels.
2. Sort each object's property names lexicographically by UTF-16 code units. Preserve array order.
3. Serialize names and primitive values with ECMAScript `JSON.stringify` semantics; use no whitespace. Negative zero serializes as `0`. No Unicode normalization is performed: composed and decomposed spellings remain distinct data.
4. Encode the resulting string in UTF-8 and compute SHA-256. Represent the digest as 64 lowercase hexadecimal characters.

This is a deliberately named v1 algorithm, not a claim that every arbitrary JSON value is accepted under RFC 8785. Envelope fields restrict numbers to positive safe integers. Cross-language implementations must reproduce the fixtures exactly rather than substituting locale sorting, code-point sorting, ASCII escaping, or whitespace formatting.

`fixtures/envelope.json` and `fixtures/canonical.json` provide a complete canonical byte string/digest and a non-ASCII key-ordering vector. A duplicate message ID is legal only when the immutable envelope digest and recipient/session binding match. A changed envelope is a protocol violation, not an overwrite.

## Requests, normalization, and retries

All requests and responses are UTF-8 JSON. Total request bytes are limited to 96 KiB; message text is limited to 64 KiB **UTF-8 bytes**, not string code units. Name/project limits are 128/256 Unicode scalar values and 512/1,024 bytes. Display labels reject C0/C1 controls; opaque message text may contain controls and must remain escaped in every display/log boundary. Invalid UTF-8 is rejected by the HTTP layer; unpaired JSON string escapes are rejected by protocol validators.

IDs use the UUID schema and are normalized to lowercase by request validators. Consumers must treat returned IDs as opaque exact addresses. Names, model IDs, projects, PIDs, native conversation IDs, and URLs are not recipient addresses or authority.

- Registration includes the full metadata snapshot and operative capability declaration. `client_type` in capabilities must equal the immutable registered type. A new connection attempt has a new UUID; retry the same connection ID and identical payload after uncertain registration. Retrying does not extend its recorded lease.
- Metadata mutations are compare-and-swap: a nonempty `metadata_patch` plus `expected_metadata_revision` (starting at 1). Omitted fields remain unchanged; `project: null` clears the optional project. A model change replaces the complete `{provider,id,source}` object. `source: unknown` requires null provider and ID rather than guessing a model from a harness name.
- A minimal send includes only `recipient_id` and `{type:"text/plain",text}`. Omitted TTL normalizes to 86,400 seconds; omitted correlation/reply fields normalize to null. These omitted and explicit defaults hash identically. Metadata patch/revision must appear together and remain part of the idempotent request.
- Send/claim `Idempotency-Key` values are 1–128 ASCII characters from `A-Z a-z 0-9 . _ ~ : + / -`. Persist the exact key and request before the first call. After authentication, owned current epoch and request-shape checks, an authorized matching send replay is resolved before mutable recipient/revision/quota/rate/capability checks. Changing the request under the same key conflicts. A replay returns the original stored acceptance result; read its `status_url` for current delivery state.
- Claim bodies use `{wait_seconds: 0..30}`; omission means zero. Claim replay is scoped to recipient and epoch. Only one current long-poll consumer/claim is permitted. A completed empty poll returns `204` with no JSON body.
- Completion includes `claim_id`, one of `delivered`, `retryable_not_stored`, `permanent_not_stored`, and an optional bounded reason (`none`, `inbox_full`, `storage_unavailable`, `unsupported_envelope`). Delivered may use only `none`. An inbox must never report not-stored after it committed that envelope.
- Every `/v1` request authenticates, including loopback. Session mutation/claim operations additionally use `X-Client-ID` and `X-Lease-Epoch`. Receipt reads use `X-Client-ID` but need no live epoch; registration and owned registration-state reads need no prior lease. Credentials never appear in query strings or model tools.

Discovery defaults to `connected=true`. `connected=false` explicitly includes authorized offline/tombstoned identities. Filters `client_type`, `name`, and `project` are exact descriptive filters, not sender authorization or implicit send targeting. `limit` is 1–100 (default 50); an opaque `next_cursor` may be supplied as the next request's `cursor`.

Deployment configuration may narrow request/message size, TTL range, and long-poll bounds, but cannot enlarge v1 wire maxima (64 KiB text, 7-day TTL, 30-second wait) or permit TTL below 60 seconds. A custom default TTL must remain in the effective range. The OpenAPI documents wire limits/defaults; a deployment may reject a stricter configured limit. Configured effective heartbeat, lease, claim, retention and supported retry windows are returned in registration `policy`. The lease must cover at least three heartbeat intervals. Stop automatic retries before the advertised send retry deadline; reconcile known message IDs instead of assuming a key lives forever. Retention is never earlier than both the terminal retention boundary and TTL plus supported retry window.

Errors have a bounded English message/action, a field where useful, an `openapi.json` reference, retryability and an effect. `not_applied` means the attempted operation did not commit; `unknown` requires reconciliation. A network disconnect itself is always an unknown outcome. A stale epoch is not permission to loop or steal an attachment. Honor `Retry-After` when present.

## Fixtures and checks

Run:

```sh
node --check src/protocol.mjs
node --test test/protocol.test.mjs
```

`fixtures/requests.json` covers each mutation validator, reconnect, unknown models, exact routing, metadata CAS shape, malformed authority/type fields, and bounded completion reasons. `fixtures/responses.json` distinguishes original acceptance replay from current delivery receipts, uncertain expiry, and claim metadata. Runtime/store tests establish stateful stale-epoch/idempotency/authorization behavior; shape fixtures alone do not establish transactional correctness.

## Real-harness release gates

No real CLI version or final-hop mode is certified by these protocol fixtures. These entries are deliberately **unverified** until their adapter's pinned-version evidence is published. Research links identify candidate mechanisms, not installed/tested runtime versions:

| Family | Research baseline | Candidate mechanism | Current claim and release gate |
| --- | --- | --- | --- |
| Pi | Source revision [`36be9c6`](https://github.com/earendil-works/pi/blob/36be9c612e64082a4f0d4d0a94706c38ecbc20a1/packages/coding-agent/src/core/extensions/types.ts) | Native extension/follow-up queue and custom-message provider conversion | Unverified. Pin installed CLI; prove active-turn non-interruption, human prompt/draft/abort guards, exact lifetime, and model-visible provenance. |
| Antigravity CLI | [Headless stream-JSON documentation](https://antigravity.google/docs/cli/headless/), researched 2026-10-23; no tested CLI version | Managed persistent serial input; separate cooperative existing-TUI path | Unverified. Prove result-boundary input serialization and permission behavior. Managed headless support never implies unsolicited existing-TUI wakeup. |
| Claude Code | [Channels reference](https://code.claude.com/docs/en/channels-reference), researched 2026-10-23; no tested CLI version | Explicit opt-in stdio Channel or verified managed/cooperative input | Unverified. Prove safe queueing and native acceptance/reconciliation. Do not enable permission relay or equate notification emission with accepted input. |
| OpenCode | [Server documentation](https://opencode.ai/docs/server/), researched 2026-10-23; no tested CLI version | Exact existing server/session API plus single-owner input arbitration | Unverified. Prove prompt/approval races and native receipt handling; `prompt_async`/HTTP success alone is insufficient. |

If a gate cannot be established, publish cooperative-only/unsupported status and retain inbox items without terminal typing, simulated Enter, abort/steer, permission toggles, or fabricated receipt claims. Simulated any-to-any fixtures certify wire routing only, never the four real CLIs.
