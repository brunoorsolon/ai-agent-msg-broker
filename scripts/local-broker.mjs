// Explicit operator-run broker only. No harness discovery, launch, attachment or configuration.
import { randomBytes, createHash } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { BrokerStore } from '../src/store.mjs';
import { CredentialStore } from '../src/auth.mjs';
import { createBrokerServer } from '../src/server.mjs';
import { TYPES } from '../src/protocol.mjs';

const DURATION_MS = 2 * 60 * 60 * 1000;
const fail = code => { throw new Error(code); };
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

/** Creates only a fresh private broker and connection descriptions. No native API is assumed. */
export async function startLocalBroker({ directory }) {
  if (process.platform !== 'linux' || !process.getuid?.() || process.versions.node !== '24.19.0') fail('runtime_required');
  const sqlite = new DatabaseSync(':memory:');
  try { if (sqlite.prepare('SELECT sqlite_version() AS version').get().version !== '3.53.3') fail('runtime_required'); }
  finally { sqlite.close(); }
  if (typeof directory !== 'string' || !isAbsolute(directory) || /[\u0000-\u001f\u007f-\u009f]/u.test(directory) || directory.length > 4096) fail('private_directory_required');
  directory = resolve(directory);
  const parent = dirname(directory), info = lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent) !== parent || info.uid !== process.getuid() || (info.mode & 0o077)) fail('private_directory_required');
  try { lstatSync(directory); fail('directory_already_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  mkdirSync(directory, { mode: 0o700 });
  let store, app, timer, stopping;
  const expiresAt = new Date(Date.now() + DURATION_MS).toISOString();
  try {
    const credentials = [], clients = [];
    for (const suffix of ['a', 'b']) {
      const label = `client-${suffix}`, token = randomBytes(32).toString('base64url');
      const tokenFile = join(directory, `${label}.token`);
      writeFileSync(tokenFile, token, { mode: 0o600, flag: 'wx' });
      credentials.push({ credential_id: label, principal_id: label, adapter_id: label,
        client_types: [...TYPES], scopes: ['local-test'], expires_at: expiresAt,
        token_sha256: createHash('sha256').update(token).digest('hex') });
      clients.push({ label, tokenFile, connectionFile: join(directory, `${label}.connection.json`) });
    }
    const verifierFile = join(directory, 'credentials.json'); json(verifierFile, { credentials });
    store = new BrokerStore({ path: join(directory, 'broker', 'broker.sqlite') });
    const auth = new CredentialStore({ path: verifierFile, onRevoke: ids => store.revoke(ids),
      onPolicyChange: entries => store.applyAuthorizationPolicies(entries) });
    app = createBrokerServer({ store, auth, host: '127.0.0.1', port: 0, insecureDevelopment: true });
    const address = await app.listen(), origin = `http://127.0.0.1:${address.port}`;
    for (const client of clients) json(client.connectionFile, {
      format: 'broker-local-connection-v1', protocol_version: '1', broker_url: origin,
      token_file: client.tokenFile, authorization_header: 'Authorization', authorization_scheme: 'Bearer',
      insecure_development: true, expires_at: expiresAt, allowed_client_types: [...TYPES],
      scope: 'local-test', reference_client_options: { url: origin, tokenFile: client.tokenFile, insecureDevelopment: true },
    });
    json(join(directory, 'LOCAL-BROKER.json'), { format: 1, purpose: 'disposable-loopback-broker', origin, expiresAt, pid: process.pid });
    const stop = () => stopping ??= (async () => {
      clearTimeout(timer); try { await app.close(); } finally { store.close(); }
    })();
    timer = setTimeout(() => { void stop().catch(() => { process.exitCode = 1; }); }, DURATION_MS); timer.unref();
    return { origin, expiresAt, directory, clients, stop };
  } catch (error) {
    clearTimeout(timer);
    try { await app?.close(); } finally { try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Starting broker only; no CLI, plugin, project or session will be inspected or changed.');
  try {
    process.umask(0o077);
    if (process.argv.length !== 4 || process.argv[2] !== '--directory') fail('arguments_invalid');
    const broker = await startLocalBroker({ directory: process.argv[3] });
    console.log(`BROKER_URL=${broker.origin}`);
    console.log(`Credentials expire at ${broker.expiresAt}. Token values are never printed.`);
    for (const client of broker.clients) {
      console.log(`${client.label.toUpperCase()} connection file: ${client.connectionFile}`);
      console.log(`${client.label.toUpperCase()} token file: ${client.tokenFile}`);
    }
    console.log('Use one credential per client. Connection files describe the broker protocol, not your plugin configuration API.');
    console.log('Clients must implement authenticated /v1 registration/heartbeat/durable inbox transport; existing sessions are not attached automatically.');
    console.log('127.0.0.1 requires the same network namespace. No LAN listener or security setting was changed.');
    console.log('Leave this terminal open. Ctrl+C stops only this broker; private files remain for explicit cleanup.');
    const stop = () => { void broker.stop().then(() => console.log('Local broker stopped.')).catch(() => { console.error('Local broker shutdown failed.'); process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) {
    const messages = {
      runtime_required: 'Use the isolated Node 24.19.0 / SQLite 3.53.3 runtime as an ordinary Linux user.',
      private_directory_required: 'Choose a new absolute directory under your own canonical private parent.',
      directory_already_exists: 'The requested directory already exists; it was not adopted or overwritten.',
      arguments_invalid: 'Usage: node scripts/local-broker.mjs --directory NEW_PRIVATE_STATE_DIRECTORY',
    };
    console.error(`Broker startup failed: ${messages[error.message] ?? 'Storage or listener initialization failed; no existing state was overwritten.'}`);
    process.exitCode = 1;
  }
}
