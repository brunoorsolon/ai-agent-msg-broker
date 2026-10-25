# Changelog

## 0.3.0

- Add opt-in scoped pairing: bounded single-use operator tickets, unique client
  credentials, finite expiry and revocation, without an unauthenticated issuer.
- Add the private-file `pair`/`revoke` operator CLI and crash-safe native connection
  helper. Existing unmarked connection bundles and bearer clients remain supported.
- Bound enrollment uploads and HTTPS retries, revalidate authorization after upload,
  and retain retry identity across lost responses and process crashes.
- Test actual operator-to-HTTPS enrollment for all four client types, durable
  round trips, scope isolation, migration, expiry and active-poll revocation.

### Upgrade from 0.2.0

The first automatic-receive test with existing Pi/Claude connection bundles does
**not** require upgrading the broker or enabling pairing. Native wake-up belongs to
connector releases, not this server release; live native acceptance remains a
separate test, and native acceptance is not proof that the model read a message.

Published server image: `ghcr.io/matuto-ai/psst:0.3.0` (Linux/amd64). Wait for the
release workflow to finish before pulling. Keep the existing Compose project,
volumes, private configuration mounts, TLS proxy and credentials: do not replace
an existing deployment with the stock connectivity-only Compose example.

Before upgrading, make and verify a private SQLite backup using the existing
[`scripts/backup.mjs`](docs/operations.md) tool (it includes WAL safely), and back up
private configuration, credentials and any pairing policy. Do not copy just a live
`.sqlite` file. In the existing Compose directory, if its image uses `BROKER_IMAGE`:

```sh
export BROKER_IMAGE=ghcr.io/matuto-ai/psst:0.3.0
docker compose pull broker
docker compose up -d --no-deps broker
curl --fail --show-error --max-time 5 https://YOUR_BROKER_HOST/readyz
```

Persist the new image selection in the existing deployment configuration so a
later invocation cannot silently revert it. If that Compose file hardcodes the
image, change only its image field instead; preserve all mounts and settings.
Never use `down -v`. No host Node upgrade or source checkout is needed to run the
image. The existing backend/proxy configuration remains operator-owned.

Pairing is **off unless explicitly enabled** with `enrollment_policy_file`; see
[the operator guide](docs/pairing-operator.md). This one-time enablement, a scoped
operator ticket and a private ticket-file handoff are still needed for new client
self-enrollment. Installing the image alone does not create credentials.

Enabling pairing migrates SQLite schema 2 to 3. Leaving it disabled preserves
schema 2. **Broker 0.2.0 rejects schema 3**: after migration, rollback requires a
verified pre-upgrade database backup plus consistent authorization/policy backups,
not merely switching the image tag. Restoring loses changes after the backup;
stale revocation state can restore access. Never run two brokers on one database.
Credentials expire and require explicit re-pairing; automatic renewal is not
implemented. See [the migration contract](docs/pairing-protocol.md).
