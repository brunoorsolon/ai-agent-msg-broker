# Pair an installed connector

This is opt-in enrollment for a separately approved broker upgrade, not a deployment
script. Existing connection bundles remain usable. No live credential, server
configuration, container or database is changed until an operator explicitly runs
the commands below. The commands require a reviewed source checkout and Node 24
with built-in SQLite; do not upgrade a host runtime merely for this step.

## One-time broker enablement

Read [migration/rollback requirements](pairing-protocol.md) first and verify backups.
Keep the existing data volume, proxy, TLS and legacy credential file. Add only
`"enrollment_policy_file":"/run/broker/enrollment-policy.json"` to the existing
configuration at the approved upgrade, after creating the private policy via `pair`
below. The broker reads policy but never writes it. Mount the containing directory
read-only, not the individual policy file, so atomic replacements remain visible.
Operator pair/revoke commands then update that file without restarting the broker,
opening its live database, creating an admin HTTP service or editing config per agent.

An empty legacy credential file remains required and deny-all for legacy bearer
requests. While there are no active client credentials, readiness stays unavailable;
the pairing route accepts only valid operator-approved grants, never anonymous users.

## Approve one installation

Use a dedicated operator-owned 0700 directory. Existing broad permissions or symlinks
are rejected rather than silently repaired. Choose the real verified HTTPS origin,
principal, shared communication scope and exactly one of `pi`, `claude-code`,
`opencode`, `antigravity-cli`. Do not point this example at production without approval.

```sh
umask 077
mkdir -m 700 "$HOME/psst-private" # only if this dedicated directory does not exist
node scripts/manage-enrollment.mjs pair \
  --policy-file "$HOME/psst-private/enrollment-policy.json" \
  --output-file "$HOME/psst-private/pi-pairing-1.json" \
  --broker-url https://broker.example \
  --principal-id operator \
  --scope psst \
  --client-type pi \
  --approve
```

The ticket is valid for 10 minutes by default (`--ticket-seconds`, 60–3600). The
installation credential expires 90 days after issuance of the ticket by default
(`--credential-days`, 1–365). Those values are operator policy, not client requests.
A new output file is required; existing tickets are never overwritten. Only a safe
completion message is printed. No secret is put into command arguments or stdout.
A failure after creating the private output but before policy commit may leave an
unusable ticket; inspect the private files, then use a new output path deliberately.

Give only this matching 0600 pairing file to the intended native sandbox using a
private copy/mount owned by its runtime user. Do not expose the entire authority
directory or another client's ticket. In the already installed connector, run its
connect command with the **file path**, not the key contents. It creates and persists
its own unique connection token, contacts the broker, saves a private connection
bundle, and attaches using its native lifecycle. The per-connector README documents
the actual command name, installation and automatic-receive guarantees. No initial
process environment variable is required by this helper. Existing bundle-file and
`PSST_CONFIG_FILE` workflows are still compatibility options.

This minimal flow still requires one private pairing-file handoff where native
hosts lack hidden input. It does not claim clipboard-free/device authorization or
that a host can read an arbitrary path outside its sandbox. HTTPS must validate via
the runtime trust store; this helper does not implement custom CA-file overrides.
After confirmed enrollment, the temporary pairing file can be removed deliberately;
keep it for reconciliation while an operation is uncertain.

## Revoke or expire

The connector's safe status/receipt supplies its nonsecret `credential_id`:

```sh
node scripts/manage-enrollment.mjs revoke \
  --policy-file "$HOME/psst-private/enrollment-policy.json" \
  --credential-id enrolled-REPLACE-WITH-EXACT-UUID \
  --approve
```

Revocation is picked up on the next authorization check, including active long polls.
It does not erase private inbox history or retract already delivered messages.
Expired/revoked credentials require a newly approved ticket and explicit connect;
there is no automatic renewal. A new credential means a new installation/mailbox
partition even in the same native session; do not adopt the old mailbox identity.
Keep revocation records until their credentials expire. The CLI does not inspect the
live DB to infer when it is safe to remove a record.

## Helper and crash recovery contract

`connectPairingFile({pairingFile,directory,clientType,brokerUrl?})` returns only
`{connectionFile,credentialId,expiresAt}`. It persists a random token and enrollment
UUID before HTTP. Repeating the same ticket and directory retries the same attempt.
Per-grant subdirectories preserve old credentials instead of overwriting them.
Private SQLite owner locks serialize concurrent commands and release on process
exit/SIGKILL; do not delete owner databases to bypass another live caller. A 10-second
absolute deadline, 16 KiB response cap, verified TLS and no redirects bound requests.
Unknown effects retain retry state; never start a replacement attempt to “fix” a timeout.

The generated bundle keeps `broker-client-bundle-v1` fields and adds the explicit
optional marker `enrollment_receipt_file:"enrollment.json"`. New pairing-aware
connectors accept only this exact basename and must call
`readEnrollmentReceipt({connectionFile,clientType})`. That reader validates the
private sibling receipt against broker origin, native type and token SHA-256 and
rejects expired, missing or corrupt receipts. Never silently fall back to legacy
identity for a marked bundle. Older strict bundle readers may reject this new field:
update the connector before pairing; existing unmarked bundles are unchanged.

The receipt is written before publishing the bundle and has format
`psst-enrollment-receipt-v1`, broker URL, credential/adapter IDs, client type, scopes,
expiry, protocol version and token hash. It contains no plaintext secret. Token and
attempt files do contain secrets and must not be printed, uploaded or copied to
another installation. Up to 64 local attempts are retained; capacity exhaustion is
an explicit recovery task, not permission to silently delete history.
