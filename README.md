# AI Agent Message Broker

A generic, authenticated LAN message broker for independent AI CLI sessions. It owns the recipient registry, background presence, and durable **message delivery**—not conversations, tasks, model progress, or agent orchestration.

**Status: development preview.** The broker core, reference adapter and local stdio facade are available for review in a draft PR. Real Pi, Antigravity CLI, Claude Code, and OpenCode receiving modes are separately gated; protocol fixtures are not evidence of real CLI compatibility.

## Contract

- [v1 specification](docs/spec-v1.md)
- [OpenAPI 3.1 contract](openapi.json) and [canonical serialization](docs/contract.md)
- [Reference adapter/runtime](docs/reference.md), [operations and containers](docs/operations.md)
- [Verification record](docs/verification.md) and [real-CLI compatibility gates](docs/feasibility.md)
- [Implementation issues and milestones](docs/implementation-plan.md)

`202 Accepted` means stored by the broker. `delivered` means committed to the exact recipient's durable adapter inbox, **not** read, injected into a harness, processed, or answered by a model. Plain text remains untrusted agent input.

## Try the preview branch

`main` still holds the specification until this draft is reviewed. Clone the implementation branch explicitly:

```sh
git clone --branch feat/durable-broker-v1 --single-branch https://github.com/brunoorsolon/ai-agent-msg-broker.git
cd ai-agent-msg-broker
```

Use an isolated pinned runtime/container rather than upgrading a workstation's global Node. See [container instructions](docs/operations.md#container-review-and-rootless-podman-example).

Already built the reviewed test image and have Claude Code 2.1.309? Follow the [controlled two-Claude local test](docs/local-claude-test.md). It uses a temporary authenticated loopback broker and an isolated copied runtime, not a global upgrade or a certified native integration.

## Development

Use **Node.js 24.19.0** (the tested runtime; bundled SQLite 3.53.3). No npm packages are required.

```sh
npm test
npm run check
npm run smoke  # actual nonroot service entrypoint, disposable fixtures
npm run demo   # all 16 simulated family routes into durable reference inboxes
```

The tests use isolated temporary databases and disposable test-only credentials/certificates. TLS tests require the `openssl` command. They do not configure a host, provision ongoing access, or call an LLM.

The service starts with `BROKER_CONFIG_FILE=/path/to/private/config.json npm start`. Startup fails closed without an operator-owned verifier file and explicit TLS or loopback-only development/proxy configuration. Every `/v1` request authenticates, even on loopback. Tokens are never tool arguments or CLI flags.

One broker process owns local SQLite, using WAL and FULL durability. A separate SQLite exclusive owner lock prevents duplicate writers without relying on process IDs. Shared/network SQLite files and public Internet ingress are unsupported.

No release, deployment, host configuration change, or production credential is included in this repository's test runs.

The demo uses eight distinct session identities, real HTTP, and local durable reference journals; it performs no native CLI input or LLM calls. The optional MCP facade is local stdio/tools-only, with no Channel push, remote MCP listener, permission relay, or claimed native-host certification.
