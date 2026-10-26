# Changelog

## 0.4.0 (source preparation; publish separately)

- Add native URL-only enrollment requests with administrator approve/deny/revoke
  in the broker's built-in form-login UI. No ticket or credential file transfer.
- Configure administrator password through PSST_ADMIN_PASSWORD; optionally fix
  HTTPS origin with PSST_PUBLIC_ORIGIN. No default password or HTTP Basic.
- Persist candidate request/key before network effects; resume the same pending
  request through GET-only status, including after restart. Startup never creates
  requests. Approved installations retain independent native-session identities.
- Protect UI sessions with Secure/HttpOnly/SameSite cookies, CSRF/origin checks,
  login rate/KDF bounds and restart logout. Render untrusted labels safely.
- Automatically snapshot the existing SQLite database privately before schema4;
  preserve legacy credentials, ticket enrollment, pending mail and retry records.
  Downgrade requires restoring that snapshot and loses subsequent writes.
- Keep old authorization active during replacement; revoke explicitly after the
  replacement works. Pending expiry24h, approved expiry90days, no silent renewal.
- Add real TLS/form/helper integration and CI gates for actual Compose, rootless
  Podman, Chromium form interaction, recreation and prior-image migration.
  User-specific authenticated native hosts remain separate acceptance evidence.
- Release image after publication: ghcr.io/matuto-ai/psst:0.4.0. This source
  preparation does not publish an image, deploy a server or provision credentials.

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

Release image (after publication): `ghcr.io/matuto-ai/psst:0.3.0` (Linux/amd64). Wait for the
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
