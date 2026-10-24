// Operator-run offline initial enrollment. Never opens the database or deploys configuration.
import { randomBytes, createHash } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLIENT_TYPES = Object.freeze(['pi', 'claude-code', 'opencode', 'antigravity-cli']);
const fail = code => { throw new Error(code); };
const privateJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

export function validateEnrollment({ directory, brokerUrl, scope = 'psst', createCredentials = false } = {}) {
  if (createCredentials !== true) fail('explicit_create_credentials_required');
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') fail('linux_required');
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.length > 4096 || /[\u0000-\u001f\u007f-\u009f]/u.test(directory)) fail('absolute_private_directory_required');
  if (typeof scope !== 'string' || !/^[-a-zA-Z0-9_.]{1,128}$/.test(scope)) fail('scope_invalid');
  if (typeof brokerUrl !== 'string' || /[\u0000-\u0020\u007f-\u009f]/u.test(brokerUrl)) fail('https_origin_required');
  let url;
  try { url = new URL(brokerUrl); } catch { fail('https_origin_required'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) fail('https_origin_required');
  directory = resolve(directory);
  const parent = dirname(directory);
  let info;
  try { info = lstatSync(parent); } catch { fail('private_parent_required'); }
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(parent) !== parent || info.uid !== process.getuid() || (info.mode & 0o077)) fail('private_parent_required');
  try { lstatSync(directory); fail('destination_already_exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { directory, brokerUrl: url.origin, scope };
}

export function enrollClients(options) {
  const { directory, brokerUrl, scope } = validateEnrollment(options);
  // Exclusive creation prevents overwriting a previous enrollment or any live configuration.
  mkdirSync(directory, { mode: 0o700 });
  const server = join(directory, 'broker');
  const clients = join(directory, 'clients');
  mkdirSync(server, { mode: 0o700 });
  mkdirSync(clients, { mode: 0o700 });
  const credentials = [];
  for (const type of CLIENT_TYPES) {
    const client = join(clients, type);
    mkdirSync(client, { mode: 0o700 });
    const token = randomBytes(32).toString('base64url');
    writeFileSync(join(client, 'token'), token + '\n', { mode: 0o600, flag: 'wx' });
    credentials.push({ credential_id: `psst-${type}`, principal_id: `psst-${type}`, adapter_id: `psst-${type}`,
      token_sha256: createHash('sha256').update(token).digest('hex'), client_types: [type], scopes: [scope], revoked: false });
    privateJson(join(client, 'connection.json'), {
      format: 'broker-client-bundle-v1', protocol_version: '1', broker_url: brokerUrl,
      token_file: 'token', file_paths_relative_to: 'connection_file_directory',
      authorization_header: 'Authorization', authorization_scheme: 'Bearer',
      insecure_development: false, allowed_client_types: [type], scope,
    });
  }
  privateJson(join(server, 'credentials.json'), { credentials });
  privateJson(join(server, 'config.json'), { database: '/data/broker.sqlite', credential_file: '/run/broker/credentials.json', host: '0.0.0.0', port: 8787, proxy_transport: true });
  // No token, secret content, or caller-supplied URL is printed by the CLI.
  return { clients: CLIENT_TYPES.length, activationRequired: true };
}

export function parseArguments(argv) {
  const options = {};
  const names = { '--directory': 'directory', '--broker-url': 'brokerUrl', '--scope': 'scope' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--create-credentials') {
      if (options.createCredentials) fail('arguments_invalid');
      options.createCredentials = true;
      continue;
    }
    const name = names[argv[i]], value = argv[++i];
    if (!name || !value || value.startsWith('--') || options[name] !== undefined) fail('arguments_invalid');
    options[name] = value;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    enrollClients(parseArguments(process.argv.slice(2)));
    console.log('Created four private client bundles and staged broker configuration. Nothing was deployed.');
  } catch (error) {
    const known = new Set(['explicit_create_credentials_required', 'linux_required', 'absolute_private_directory_required', 'scope_invalid', 'https_origin_required', 'private_parent_required', 'destination_already_exists', 'arguments_invalid']);
    console.error(known.has(error.message) ? error.message : 'enrollment_failed_inspect_private_destination');
    process.exitCode = 1;
  }
}
