// Explicit operator-run local experiment, never production enrollment or deployment.
import { randomBytes, createHash } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { BrokerStore } from '../src/store.mjs';
import { CredentialStore } from '../src/auth.mjs';
import { createBrokerServer } from '../src/server.mjs';

export const LAB_CLAUDE_VERSION = '2.1.309';
const DURATION_MS = 2 * 60 * 60 * 1000;
const referenceRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const fail = () => { throw new Error('local_lab_configuration_invalid'); };
function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\u0000-\u001f\u007f-\u009f]/u.test(value) || value.length > 4096) fail();
  return resolve(value);
}
function privateDirectory(path) {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path
    || info.uid !== process.getuid() || (info.mode & 0o077)) fail();
}
function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

/** Starts the real HTTP/store implementation on numeric loopback and a free port.
 * Nothing is generated until the operator invokes this function/CLI explicitly.
 * The caller owns the fresh private directory; it is never reused or overwritten.
 */
export async function startLocalClaudeLab({ directory, adapterDirectory, claudeBinary }) {
  if (process.platform !== 'linux' || !process.getuid?.() || process.versions.node !== '24.19.0') fail();
  const sqlite = new DatabaseSync(':memory:');
  try { if (sqlite.prepare('SELECT sqlite_version() AS version').get().version !== '3.53.3') fail(); }
  finally { sqlite.close(); }
  directory = absolute(directory); adapterDirectory = absolute(adapterDirectory); claudeBinary = realpathSync(absolute(claudeBinary));
  privateDirectory(dirname(directory));
  try { lstatSync(directory); fail(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const path of [join(adapterDirectory, 'bin/launch.mjs'), join(adapterDirectory, 'src/reference-pin.mjs'), claudeBinary]) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) fail();
  }
  // The explicitly selected, pinned adapter checkout is trusted local operator code.
  const { verifyReference } = await import(pathToFileURL(join(adapterDirectory, 'src/reference-pin.mjs')).href);
  verifyReference(referenceRoot);
  const version = spawnSync(claudeBinary, ['--version'], { encoding: 'utf8', timeout: 10000,
    maxBuffer: 4096, stdio: ['ignore', 'pipe', 'pipe'] });
  if (version.status !== 0 || version.stdout.trim().match(/^(\d+\.\d+\.\d+)(?:\s|$)/)?.[1] !== LAB_CLAUDE_VERSION) fail();

  // mkdir without recursive/overwrite is intentional. Existing state must survive.
  mkdirSync(directory, { mode: 0o700 });
  let store, app, timer, stopping;
  const expiresAt = new Date(Date.now() + DURATION_MS).toISOString();
  try {
    const credentials = [];
    const clients = [];
    for (const suffix of ['a', 'b']) {
      const name = `broker-test-${suffix}`;
      const token = randomBytes(32).toString('base64url');
      const tokenFile = join(directory, `${name}.token`);
      writeFileSync(tokenFile, token, { mode: 0o600, flag: 'wx' });
      credentials.push({ credential_id: name, principal_id: name, adapter_id: name,
        client_types: ['claude-code'], scopes: ['local-test'], expires_at: expiresAt,
        token_sha256: createHash('sha256').update(token).digest('hex') });
      const stateRoot = join(directory, `${name}-state`), project = join(directory, `${name}-project`);
      mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(project, { mode: 0o700 });
      clients.push({ name, tokenFile, stateRoot, project, configFile: join(directory, `${name}.json`) });
    }
    const verifierFile = join(directory, 'credentials.json');
    writeJson(verifierFile, { credentials });
    store = new BrokerStore({ path: join(directory, 'broker', 'broker.sqlite') });
    const auth = new CredentialStore({ path: verifierFile, onRevoke: ids => store.revoke(ids),
      onPolicyChange: entries => store.applyAuthorizationPolicies(entries) });
    app = createBrokerServer({ store, auth, host: '127.0.0.1', port: 0, insecureDevelopment: true });
    const address = await app.listen();
    const origin = `http://127.0.0.1:${address.port}`;
    for (const client of clients) writeJson(client.configFile, {
      referenceRoot, stateRoot: client.stateRoot, brokerUrl: origin, tokenFile: client.tokenFile,
      insecureDevelopment: true, name: client.name, project: client.name,
      claudeBinary, expectedCliVersion: LAB_CLAUDE_VERSION,
    });
    writeJson(join(directory, 'LOCAL-TEST.json'), { format: 1, purpose: 'disposable-loopback-claude-test',
      origin, expiresAt, pid: process.pid, referenceRoot, adapterDirectory, nativeCertified: false });
    const stop = () => stopping ??= (async () => {
      clearTimeout(timer);
      try { await app.close(); } finally { store.close(); }
    })();
    // Even an unattended lab stops after its two-hour credential window.
    timer = setTimeout(() => { void stop().catch(() => { process.exitCode = 1; }); }, DURATION_MS);
    timer.unref();
    return { origin, expiresAt, directory, clients, stop,
      commands: clients.map(client => `cd ${quote(client.project)} && ${quote(process.execPath)} ${quote(join(adapterDirectory, 'bin/launch.mjs'))} ${quote(client.configFile)}`) };
  } catch (error) {
    clearTimeout(timer);
    try { await app?.close(); } finally { try { store?.close(); } finally { rmSync(directory, { recursive: true, force: true }); } }
    throw error;
  }
}

function argumentsOf(argv) {
  const options = {};
  const names = { '--directory': 'directory', '--adapter': 'adapterDirectory', '--claude': 'claudeBinary' };
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]], value = argv[index + 1];
    if (!name || !value || options[name] !== undefined) fail();
    options[name] = value;
  }
  if (Object.keys(options).length !== 3) fail();
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.umask(0o077);
    const lab = await startLocalClaudeLab(argumentsOf(process.argv.slice(2)));
    console.log(`Local test broker ready: ${lab.origin}`);
    console.log(`Separate temporary credentials expire at ${lab.expiresAt}; no token is printed.`);
    console.log('Open TWO other terminals and run one command in each:');
    lab.commands.forEach((command, index) => console.log(`${index ? 'B' : 'A'}: ${command}`));
    console.log('Use normal Claude project/MCP approvals. No permission bypass is configured.');
    console.log('Receive is a non-consuming peek, not native acceptance. This is a candidate native test.');
    console.log('Exit both Claude sessions normally, then Ctrl+C here. Private test files remain for explicit cleanup.');
    const stop = () => { void lab.stop().then(() => console.log('Local test broker stopped.')).catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch {
    console.error('Local lab unavailable. Use Linux, isolated Node 24.19.0, Claude Code 2.1.309, the reviewed adapter, and a new directory under a private owner-only parent. Existing state was not overwritten.');
    process.exitCode = 1;
  }
}
