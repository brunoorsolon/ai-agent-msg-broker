# AI Agent Message Broker

A generic, authenticated LAN message broker for independent AI CLI sessions. It owns the recipient registry, background presence, and durable **message delivery**—not conversations, tasks, model progress, or agent orchestration.

**Status: development preview.** The broker core and reference adapter are under implementation in a draft PR. Real Pi, Antigravity CLI, Claude Code, and OpenCode receiving modes are separately gated; protocol fixtures are not evidence of real CLI compatibility.

## Contract

- [v1 specification](docs/spec-v1.md)
- [OpenAPI 3.1 contract](openapi.json) and [canonical serialization](docs/contract.md)
- [Implementation issues and milestones](docs/implementation-plan.md)

`202 Accepted` means stored by the broker. `delivered` means committed to the exact recipient's durable adapter inbox, **not** read, injected into a harness, processed, or answered by a model. Plain text remains untrusted agent input.

## Development

Use **Node.js 24.19.0** (the tested runtime; bundled SQLite 3.53.3). No npm packages are required.

```sh
npm test
npm run check
```

The tests use isolated temporary databases and disposable test-only credentials/certificates. TLS tests require the `openssl` command. They do not configure a host, provision ongoing access, or call an LLM.

The service starts with `BROKER_CONFIG_FILE=/path/to/private/config.json npm start`. Startup fails closed without an operator-owned verifier file and explicit TLS or loopback-only development/proxy configuration. Every `/v1` request authenticates, even on loopback. Tokens are never tool arguments or CLI flags.

One broker process owns local SQLite, using WAL and FULL durability. A separate SQLite exclusive owner lock prevents duplicate writers without relying on process IDs. Shared/network SQLite files and public Internet ingress are unsupported.

No release, deployment, host configuration change, or production credential is included in this repository's test runs.
