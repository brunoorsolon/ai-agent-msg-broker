# Scoped pairing protocol (additive v1)

Pairing does not remove authentication, issue anonymous credentials, or grant admin
rights to ordinary clients. Existing 0.2.0 bundles and session/discovery/message APIs
remain valid. No deployed configuration is changed by this source feature.

## Identity and consent

An installation has a unique credential ID and adapter ID. Its random 32-byte token
is generated and durably saved by the connector; only its SHA-256 verifier reaches
the broker. Operator consent fixes principal, one client type, scopes and expiry.
Each native session still has separate session/client UUIDs, inbox and lease epochs.
A new native session never adopts an old session identity. Re-pairing creates a new
installation: partition state by verified credential ID plus native session ID,
never attach a replacement principal to an old mailbox. Agent messages are not
operator approval. Transport delivery never proves native acceptance/model reading.

## Wire contract

`POST /v1/enrollments` over verified HTTPS, JSON, with no query or Origin:
`Authorization: Pairing <43-character base64url one-use secret>`.

Exactly three request fields: `enrollment_id` (UUID), `client_type` (existing v1 enum),
`token_sha256` (64 lower-case hex). Persist UUID and token before requesting issuance.
Do not send plaintext bearer token or caller-selected scopes/principal/expiry.

201 first issuance / 200 identical reconciliation:
`{credential_id, adapter_id, client_type, scopes, expires_at, protocol_version:"1"}`.
No secret is returned. Repeating the same grant and request returns the same result,
even after grant expiry/removal, **only while the issued credential is still valid**.
No retry extends expiry. Different body for consumed active grant: 409
`idempotency_conflict`; unusable/unknown/expired/revoked grant: 401 `unauthenticated`;
wrong client type: 403 `forbidden`; malformed/extra fields: 400 `invalid_request`;
oversize: 413; rate/capacity: 429 `rate_limited`; storage: 503 `storage_unavailable`.
Errors use the existing safe v1 envelope and `effect` semantics.

For an uncertain result retry the original durable attempt, never generate another
UUID/token. A saved token can also validate authenticated recipient discovery.
Expired/revoked credentials need explicit re-pairing. Automatic renewal is not
implemented. Never put pairing secrets in command arguments, model messages,
URLs or logs. Use hidden input or a private pairing file, passing only its path.
Configure reverse proxies not to log Authorization or request bodies.

## Authority and bounded storage

Optional broker config `enrollment_policy_file` enables enrollment. Absent means
disabled. Invalid configured authority fails closed, including readiness. It is a
private 0600 operator-owned regular file, not an admin HTTP API. Format:
`{format:"psst-enrollment-policy-v1",grants:[],revoked_credentials:[]}`.
Each grant has `grant_id`, `secret_sha256`, `principal_id`, `client_type`, `scopes`,
`expires_at`, `credential_expires_at`. Expiries are mandatory; credential expiry
cannot precede grant expiry. Removing an unconsumed grant cancels it. Removing a
consumed grant does not revoke the issued credential: revoke by credential ID and
retain that revoked ID until expiry.

Issuance/replay metadata is one transaction in the existing SQLite DB. Legacy and
dynamic credentials are combined before policy reconciliation. Expiry/revocation
stops existing long polls at their next auth check and invalidates leases/discovery,
without retracting already stored messages. Broker only reads policy; an operator
command can replace policy without opening the broker's exclusively owned DB.

Limits: 1000 outstanding grants, 1000 unexpired issued records (revoked records also
count), 10000 revoked IDs, 1 MiB policy, existing 96 KiB request limit, 20 enrollment
attempts/minute/network peer plus existing peer limit. A reverse proxy shares its
peer budget. This is small-team bootstrap, not public Internet self-service.
Expired issued rows are pruned during new issuance.

## Migration, recovery and deployment gate

Deployment remains a separate approval. Preserve the existing data volume, TLS/
proxy setup and legacy credential file. Before upgrading, take and verify a DB
backup plus private credential/policy backups. Mount the policy **directory**
read-only into broker so atomic replacements remain visible; operator writes it
outside the container. Keep `credential_file` configured even if empty. A one-time
configuration addition enables pairing; per-client approval updates policy only.

Enabling enrollment performs additive schema 2 -> 3, creating its table. Feature
disabled leaves schema 2 unchanged; opening schema 3 never downgrades it. **0.2.0
rejects schema 3.** Rollback requires deliberately restoring a pre-upgrade backup,
not running the old binary on migrated data; post-backup changes would be lost.
Restore authorization/revocations consistently: stale policy can resurrect access.
Never run two broker owners against one DB or delete its volume as recovery.

Synthetic tests cover unique issuance, competing requests, replay after expiry and
restart, scope/type isolation, uncertain commits, rollback, malformed private policy,
active-poll revocation, HTTP rate bound, legacy bearer compatibility, migration and
backup replay. Exact-runtime CI, Docker/Podman packaging, native wake-up and live
production acceptance remain separate gates; broker tests do not certify them.
