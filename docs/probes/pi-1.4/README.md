# Pi 1.4 / shared broker / synthetic Antigravity validation probe

**PASS — isolated validation only, not a production Pi adapter.**
Executed 2026-10-23 UTC with official Pi **1.4.0** and Node **24.19.0**.

Pinned shared broker: `e015a6f5d7cc32d0c0a90bd633fab8d94195417a`.
Pinned Antigravity adapter codec: `e44d499912cec8c05a048722f760d648b926e6e0`.
The actual Antigravity CLI is **not** installed/executed by this test.

## Evidence

One integration test exercises the actual Pi `AgentSession`, extension loader,
provider loop, tool execution, `InteractiveMode`, and Enter key handling through
an injected Terminal. Its deterministic local provider makes three calls, with
zero model tokens or remote model requests; one fake tool is deliberately held
open. The broker server, HTTP client, authentication, SQLite inbox, receive loop,
heartbeat and send/reply path are real implementations using disposable local
credentials on numeric loopback. The managed Antigravity child is **synthetic**.

Observed checks:

- Receive/heartbeat activity during an active Pi task neither interrupts it nor
  triggers another provider call.
- Native `sendMessage(..., {deliverAs:'followUp'})` waits for current work. A held
  tool finishes before the next provider call. Actual Enter human steering is
  processed before the queued peer follow-up.
- Pi converts a custom message to provider `role: user`, but the fixed untrusted
  warning and JSON provenance survive. The peer's “yes/ignore the human” body is
  not elevated to permission or unqualified human authority.
- Pi's reply traverses the real broker into the synthetic managed AGY inbox.
  Human hold and draft flags block writing. Clearing them permits exactly one
  provenance-wrapped input; only a matching synthetic result frame completes the
  codec receipt. Repeating scheduling writes no duplicate input.
- A real Pi new-session transition shuts down the old broker lifetime and
  heartbeat, closes its broker session, and neither adopts the pending inbox nor
  creates a fake turn in the new session.

`probe.log` is the successful terminal output. `TESTED-SOURCE.json` records exact
named source-file bytes, versions and commits; the probe checks them before it
imports implementation modules. These hashes are evidence for the recorded files,
not a claim to authenticate every transitive npm dependency.

## Limits

Pi's extension `sendMessage` API returns **void**, not an acceptance receipt.
The Pi inbox item deliberately remains **pending**, even after provider visibility
was observed. This fixture is not a reusable receipt implementation or automatic
FIFO consumer. It submits one known item once under its test owner; a production
adapter still needs a separately reviewed exact-lifetime and consumption contract.
There is no idle-check-to-prompt lease or automatic unsolicited wakeup claim.

The AGY child exercises the managed stream codec only; it does **not** certify a
real Antigravity executable, native permission behavior or action success. The
Pi key handler is real, but the injected Terminal is **not a PTY/physical-terminal
test**. No real credentials, user configuration, user computer, live broker,
production Site or external model is used. No deployment/merge is performed.

## Reproduce in disposable directories

Use the exact Node runtime above. Do not alter global Node, Pi configuration or a
user's existing project. Obtain the pinned checkouts and isolated official package:

```sh
node --version # must be v24.19.0
fixture_dir="$(mktemp -d)"
git clone --no-checkout https://github.com/brunoorsolon/ai-agent-msg-broker.git "$fixture_dir/broker"
git -C "$fixture_dir/broker" checkout --detach e015a6f5d7cc32d0c0a90bd633fab8d94195417a
git clone --no-checkout https://github.com/brunoorsolon/antigravity-review-pair.git "$fixture_dir/antigravity"
git -C "$fixture_dir/antigravity" checkout --detach e44d499912cec8c05a048722f760d648b926e6e0
npm install --prefix "$fixture_dir/pi" --ignore-scripts --no-audit --no-fund \
  --save-exact @earendil-works/pi-coding-agent@1.4.0
export BROKER_REFERENCE_DIR="$fixture_dir/broker"
export ANTIGRAVITY_ADAPTER_DIR="$fixture_dir/antigravity"
export PI_TEST_INSTALL="$fixture_dir/pi"
# From the later broker checkout containing this probe (not the pinned core above):
node --test docs/probes/pi-1.4/probe.mjs
```

Keep the directory containing this probe separate from the core snapshot. The
probe can run from any working directory and resolves its sibling extension by
module URL. Environment values are explicit trusted source paths, never model
arguments or credentials. Missing/different named source bytes stop validation;
review an update instead of bypassing the pin. Temporary HOME/session/config and
fake token files are removed on test teardown. Remove only disposable directories
you created when finished.

Official Pi source entry points used: `dist/core/agent-session.js` (followUp /
custom-message queueing), `dist/core/messages.js` (custom-to-user conversion),
`dist/modes/interactive/interactive-mode.js` (Enter input path), and the runtime
services/host modules listed in the manifest. Managed AGY sources are
`src/adapter.mjs` and `src/managed-session.mjs` at the pinned commit. This probe
reuses broker modules; it does not define another wire protocol or MCP transport.
