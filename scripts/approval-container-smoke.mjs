// CI-only product bootstrap/recreation test. No process-name or PID heuristics.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

const [mode, image] = process.argv.slice(2);
assert(['compose', 'podman'].includes(mode), 'Use compose or podman and an already built image.');
assert.match(image ?? '', /^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,255}$/);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'psst-approval-ci-'));
const name = `psst-approval-${randomBytes(6).toString('hex')}`;
const password = randomBytes(32).toString('base64url');
let backend, origin, container, proxy, ca, started = false;
let legacyContainer, legacyVolume;
let environment = { ...process.env };
const command = (program, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(program, args, { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '', errors = '';
  const deadline = setTimeout(() => child.kill('SIGKILL'), 120000);
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errors += data; });
  child.on('error', reject);
  child.on('close', code => {
    clearTimeout(deadline);
    // Do not dump container configuration, command environments or password values.
    if (code !== 0) reject(new Error(`${program} exited ${code}: ${errors.replaceAll(password, '[redacted]').slice(-3000)}`));
    else resolve(output.trim());
  });
});
const compose = args => command('docker', ['compose', '-p', name, '-f', join(root, 'compose.yaml'), ...args]);
const request = (path, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = https.request(origin + path, { method, ca, headers, timeout: 5000 }, res => {
    let text = '';
    res.on('data', part => { text += part; if (text.length > 1024 * 1024) res.destroy(Error('oversize response')); });
    res.on('error', reject);
    res.on('end', () => { let json; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, text, json }); });
  });
  req.on('timeout', () => req.destroy(Error('request deadline')));
  req.on('error', reject); req.end(body);
});
const api = (path, token, { enrollment = false, body, session, epoch = 1, key, method = body === undefined ? 'GET' : 'POST' } = {}) => request(path, {
  method, body: body === undefined ? undefined : JSON.stringify(body), headers: {
    Authorization: `${enrollment ? 'Enrollment' : 'Bearer'} ${token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(session ? { 'X-Client-ID': session, 'X-Lease-Epoch': String(epoch) } : {}),
    ...(key ? { 'Idempotency-Key': key } : {}),
  },
});
const healthy = async () => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await request('/healthz')).status === 200) return; } catch {}
    await delay(250);
  }
  throw Error('Product HTTP health did not become available.');
};
const mapping = async () => {
  const published = mode === 'compose'
    ? await compose(['port', 'broker', '8787'])
    : await command('podman', ['port', container, '8787/tcp']);
  const port = /127\.0\.0\.1:(\d+)/.exec(published)?.[1];
  assert(port, 'Expected isolated IPv4 loopback published port.');
  backend = `http://127.0.0.1:${port}`;
};
const start = async () => {
  started = true; // Also clean up a partially failed start under our unique name.
  if (mode === 'compose') {
    await compose(['up', '-d', '--force-recreate', '--no-build', '--pull', 'never']);
  } else {
    container = await command('podman', ['run', '--detach', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '-p', '127.0.0.1::8787', '-v', `${name}:/data`, '-e', 'PSST_ADMIN_PASSWORD', '-e', 'PSST_PUBLIC_ORIGIN', image]);
  }
  await mapping(); await healthy();
};
const registration = () => ({ protocol_version: '1', client_id: randomUUID(), client_type: 'pi', session_instance_id: randomUUID(), connection_id: randomUUID(), previous_epoch: 0,
  metadata: { name: 'same synthetic installation', model: { provider: null, id: null, source: 'unknown' }, project: null },
  capabilities: { protocol_version: '1', adapter_version: 'ci', client_type: 'pi', receive_enabled: true, durable_inbox: true } });

async function legacyUpgrade() {
  const oldImage = process.env.APPROVAL_TEST_LEGACY_IMAGE;
  assert.match(oldImage ?? '', /^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,255}$/, 'Build the pinned legacy image before this gate.');
  const engine = mode === 'compose' ? 'docker' : 'podman';
  legacyVolume = `${name}-legacy`;
  await command(engine, ['volume', 'create', legacyVolume]);
  const a = randomBytes(32).toString('base64url'), b = randomBytes(32).toString('base64url');
  const fixture = { sender: registration(), recipient: registration(), key: randomUUID() };
  const env = { ...environment, PSST_TEST_LEGACY_A: a, PSST_TEST_LEGACY_B: b, PSST_TEST_LEGACY_FIXTURE: JSON.stringify(fixture) };
  // Executes against the OLD image's code, not the new schema implementation.
  const seed = `
    import {writeFileSync} from 'node:fs'; import {randomUUID,randomBytes,createHash} from 'node:crypto';
    import {BrokerStore} from './src/store.mjs'; import {EnrollmentService} from './src/enrollment.mjs';
    process.umask(0o077); const save=(p,v)=>writeFileSync('/data/'+p,JSON.stringify(v),{mode:0o600});
    const hash=v=>createHash('sha256').update(v).digest('hex');const f=JSON.parse(process.env.PSST_TEST_LEGACY_FIXTURE);
    const entry={credential_id:'legacy-static',principal_id:'owner',adapter_id:'legacy-static',client_types:['pi'],scopes:['legacy'],token_sha256:hash(process.env.PSST_TEST_LEGACY_A)};
    const secret=randomBytes(32).toString('base64url'),now=Date.now();
    save('legacy-credentials.json',{credentials:[entry]});
    save('legacy-policy.json',{format:'psst-enrollment-policy-v1',revoked_credentials:[],grants:[{grant_id:randomUUID(),secret_sha256:hash(secret),principal_id:'owner',client_type:'pi',scopes:['legacy'],expires_at:new Date(now+600000).toISOString(),credential_expires_at:new Date(now+86400000).toISOString()}]});
    save('legacy-config.json',{database:'/data/broker.sqlite',credential_file:'/data/legacy-credentials.json',enrollment_policy_file:'/data/legacy-policy.json',host:'0.0.0.0',port:8787,proxy_transport:true});
    const store=new BrokerStore({path:'/data/broker.sqlite'}),enrollment=new EnrollmentService({store,policyFile:'/data/legacy-policy.json'});
    enrollment.redeem('Pairing '+secret,{enrollment_id:randomUUID(),client_type:'pi',token_sha256:hash(process.env.PSST_TEST_LEGACY_B)},[entry]);
    store.register(entry,f.sender);store.register(enrollment.credentials()[0],f.recipient);
    const sent=store.send(entry,f.sender.client_id,1,f.key,{recipient_id:f.recipient.client_id,content:{type:'text/plain',text:'legacy queued fixture'}});
    if(store.db.prepare('PRAGMA user_version').get().user_version!==3)throw Error('Expected actual old schema3');
    store.close();console.log(JSON.stringify({message_id:sent.message_id}));`;
  const seedResult = JSON.parse(await command(engine, ['run', '--rm', '--network', 'none', '-v', `${legacyVolume}:/data`,
    '-e', 'PSST_TEST_LEGACY_A', '-e', 'PSST_TEST_LEGACY_B', '-e', 'PSST_TEST_LEGACY_FIXTURE', oldImage, 'node', '--input-type=module', '-e', seed], { env }));
  legacyContainer = await command(engine, ['run', '--detach', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '-p', '127.0.0.1::8787', '-v', `${legacyVolume}:/data`, '-e', 'BROKER_CONFIG_FILE=/data/legacy-config.json', '-e', 'PSST_ADMIN_PASSWORD', '-e', 'PSST_PUBLIC_ORIGIN', image]);
  const published = await command(engine, ['port', legacyContainer, '8787/tcp']);
  const port = /127\.0\.0\.1:(\d+)/.exec(published)?.[1];assert(port);backend = `http://127.0.0.1:${port}`;await healthy();
  for (const [session, token] of [[fixture.sender, a], [fixture.recipient, b]]) {
    const response = await api('/v1/sessions', token, { body: { ...session, previous_epoch: 1, connection_id: randomUUID() } });
    assert.equal(response.status, 200);assert.equal(response.json.lease_epoch, 2);
  }
  const receipt = await api(`/v1/messages/${seedResult.message_id}`, a, { session: fixture.sender.client_id, epoch: 2 });
  assert.equal(receipt.status, 200);assert.equal(receipt.json.delivery_state, 'queued');
  const replay = await api('/v1/messages', a, { session: fixture.sender.client_id, epoch: 2, key: fixture.key,
    body: { recipient_id: fixture.recipient.client_id, content: { type: 'text/plain', text: 'legacy queued fixture' } } });
  assert.equal(replay.status, 202);assert.equal(replay.json.message_id, seedResult.message_id);
  const inspect = `import{readdirSync,statSync}from'node:fs';import{DatabaseSync}from'node:sqlite';
    const folders=readdirSync('/data').filter(x=>x.startsWith('before-approval-'));if(folders.length!==1)throw Error('one migration backup required');
    const p='/data/'+folders[0];if(statSync(p).mode&63||statSync(p+'/broker.sqlite').mode&63)throw Error('private backup required');
    const db=new DatabaseSync(p+'/broker.sqlite',{readOnly:true});if(db.prepare('PRAGMA user_version').get().user_version!==3||db.prepare('SELECT count(*) n FROM messages').get().n!==1)throw Error('old snapshot lost');db.close();`;
  await command(engine, ['exec', legacyContainer, 'node', '--input-type=module', '-e', inspect]);
  console.log('Actual prior-image schema3 upgraded: static/enrolled credentials, session IDs, queued mail and send replay preserved; private pre-migration snapshot verified.');
}

try {
  if (mode === 'podman') assert.equal(await command('podman', ['info', '--format', '{{.Host.Security.Rootless}}']), 'true');
  const key = join(temporary, 'tls.key'), cert = join(temporary, 'tls.crt');
  await command('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-addext', 'basicConstraints=critical,CA:TRUE']);
  ca = readFileSync(cert);
  proxy = https.createServer({ key: readFileSync(key), cert: ca }, (incoming, outgoing) => {
    if (!backend) { outgoing.writeHead(503); outgoing.end(); return; }
    // Preserve the external Host. Do not grant authority through forwarded headers.
    const headers = { ...incoming.headers };
    for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-') || key === 'forwarded') delete headers[key];
    const upstream = http.request(backend + incoming.url, { method: incoming.method, headers }, response => {
      outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${proxy.address().port}`;
  environment = { ...environment, BROKER_IMAGE: image, BROKER_BIND_IP: '127.0.0.1', BROKER_PORT: '0', PSST_ADMIN_PASSWORD: password, PSST_PUBLIC_ORIGIN: origin };
  await start();
  assert.equal((await request('/readyz')).status, 503, 'Fresh deny-all broker awaits its first approval, without blocking admin UI.');
  assert.equal((await request('/v1/clients')).status, 401);
  const login = await request('/admin');
  assert.equal(login.status, 200); assert.match(login.text, /type=["']password["']/);
  assert(!login.headers['www-authenticate'], 'Product must use a login form, not HTTP Basic.');
  assert(!login.text.includes(password));
  const grants = Array.from({ length: 3 }, (_, i) => ({ request_id: randomUUID(), token: randomBytes(32).toString('base64url'), label: `CI request ${i}` }));
  for (const grant of grants) {
    const created = await api('/v1/enrollment-requests', grant.token, { enrollment: true, body: { request_id: grant.request_id, client_type: 'pi', label: grant.label } });
    assert([200, 201, 202].includes(created.status)); assert.equal(created.json.state, 'pending');
    assert.equal((await api('/v1/clients', grant.token)).status, 401, 'Pending candidate cannot authenticate transport.');
  }
  await command('python3', ['scripts/approval-browser-smoke.py'], { env: { ...environment, APPROVAL_TEST_ORIGIN: origin, APPROVAL_TEST_PASSWORD: password,
    APPROVAL_TEST_CA: cert, APPROVAL_TEST_REQUESTS: JSON.stringify(grants.map(x => x.request_id)),
    APPROVAL_TEST_SESSION_FILE: join(temporary, 'browser-session.json'),
    APPROVAL_TEST_ARTIFACTS: process.env.APPROVAL_TEST_ARTIFACTS ?? join(root, 'approval-ui-artifacts', mode) } });
  for (const [i, state] of ['approved', 'denied', 'revoked'].entries()) {
    const result = await api(`/v1/enrollment-requests/${grants[i].request_id}`, grants[i].token, { enrollment: true });
    assert.equal(result.json.state, state); assert(!result.text.includes(grants[i].token));
  }
  assert.equal((await request('/readyz')).status, 200);
  // Approval of the third request must not silently revoke the first installation.
  const approved = grants[0], sessions = Array.from({ length: 30 }, registration);
  for (const session of sessions) {
    const response = await api('/v1/sessions', approved.token, { body: session });
    assert.equal(response.status, 200); assert.equal(response.json.lease_epoch, 1);
  }
  const clients = await api('/v1/clients', approved.token);
  assert.equal(clients.status, 200); assert.equal(new Set(clients.json.clients.map(x => x.client_id)).size, 30);
  const message = { recipient_id: sessions[1].client_id, content: { type: 'text/plain', text: 'synthetic persistence probe' } };
  const sendKey = randomUUID();
  const sent = await api('/v1/messages', approved.token, { body: message, session: sessions[0].client_id, key: sendKey });
  assert.equal(sent.status, 202);
  if (mode === 'podman') { await command('podman', ['stop', '--time', '5', container]); await command('podman', ['rm', container]); container = null; }
  await start(); // Compose force-recreates; the normal product data volume remains.
  const oldCookies = JSON.parse(readFileSync(join(temporary, 'browser-session.json'), 'utf8'));
  const afterRestart = await request('/admin', { headers: { Cookie: oldCookies.map(c => `${c.name}=${c.value}`).join('; ') } });
  assert.match(afterRestart.text, /type=["']password["']/, 'Old admin session must not survive broker process restart.');
  assert.equal((await api(`/v1/enrollment-requests/${approved.request_id}`, approved.token, { enrollment: true })).json.state, 'approved');
  for (const session of sessions) {
    const response = await api('/v1/sessions', approved.token, { body: { ...session, connection_id: randomUUID(), previous_epoch: 1 } });
    assert.equal(response.status, 200); assert.equal(response.json.lease_epoch, 2);
  }
  const replay = await api('/v1/messages', approved.token, { body: message, session: sessions[0].client_id, epoch: 2, key: sendKey });
  assert.equal(replay.status, 202); assert.equal(replay.json.message_id, sent.json.message_id);
  const receipt = await api(`/v1/messages/${sent.json.message_id}`, approved.token, { session: sessions[0].client_id, epoch: 2 });
  assert.equal(receipt.status, 200); assert.equal(receipt.json.delivery_state, 'queued');
  for (const denied of grants.slice(1)) assert.equal((await api('/v1/clients', denied.token)).status, 401);
  console.log(`${mode}: normal product startup, trusted HTTPS browser login/approval/deny/revoke, 30 distinct wire sessions and recreate/pending-mail persistence passed.`);
  console.log('Wire-session evidence is not native CLI/model automatic-receive acceptance; connector gates remain separate.');
  await legacyUpgrade();
} finally {
  const legacyEngine = mode === 'compose' ? 'docker' : 'podman';
  if (legacyContainer) { try { await command(legacyEngine, ['rm', '--force', legacyContainer]); } catch {} }
  if (legacyVolume) { try { await command(legacyEngine, ['volume', 'rm', legacyVolume]); } catch {} }
  if (started) {
    if (mode === 'compose') { try { await compose(['down', '--volumes', '--remove-orphans']); } catch {} }
    else { try { await command('podman', ['rm', '--force', container || name]); } catch {} try { await command('podman', ['volume', 'rm', name]); } catch {} }
  }
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  rmSync(temporary, { recursive: true, force: true });
}
