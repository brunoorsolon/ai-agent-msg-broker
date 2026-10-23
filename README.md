# ai-agent-msg-broker

A local/LAN message broker for independent AI CLI sessions: Pi, Antigravity CLI, Claude Code, OpenCode, and future adapters.

**Status: specification and implementation backlog only. No broker or adapter implementation is included yet.**

The design supports any-to-any addressing by immutable session client ID, a persistent mailbox, inexpensive background presence, and non-interrupting delivery through harness-specific adapters. Broker messages remain visibly agent-originated, untrusted input—not human instructions or approvals.

- [Detailed v1 specification](docs/spec-v1.md)
- [Implementation plan and dependency map](docs/implementation-plan.md)

The MVP uses one authenticated HTTPS/JSON API with outbound long polling, broker-local SQLite storage, and no Internet ingress or inbound agent-container callbacks. Receiving safely depends on the actual harness API: unsupported integrations must advertise their limitation rather than pretend they can wake any existing terminal session.

The existing [MIT license](LICENSE) is unchanged.
