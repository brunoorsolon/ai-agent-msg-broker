// Isolated test-only credentials are random, never printed, and removed on exit.
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

if (process.getuid?.() === 0) throw new Error('Smoke fixture must run as nonroot.');
const directory = mkdtempSync(join(tmpdir(), 'broker-container-smoke-'));
const token = randomBytes(32).toString('base64url');
const credentialFile = join(directory, 'credentials.json');
const configFile = join(directory, 'config.json');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
writeFileSync(credentialFile, JSON.stringify({ credentials: [{ credential_id: 'disposable-smoke', principal_id: 'fixture', adapter_id: 'fixture', client_types: ['pi'], scopes: ['fixture'], token_sha256: createHash('sha256').update(token).digest('hex') }] }), { mode: 0o600 });
writeFileSync(configFile, JSON.stringify({ database: join(directory, 'data', 'broker.sqlite'), credential_file: credentialFile, host: '127.0.0.1', port, insecure_development: true, limits: { min_free_bytes: 1024 * 1024 } }), { mode: 0o600 });
const child = spawn(process.execPath, ['src/main.mjs'], { env: { ...process.env, BROKER_CONFIG_FILE: configFile }, stdio: ['ignore', 'ignore', 'ignore'] });
try {
  const deadline = Date.now() + 10000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Broker exited during smoke startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      ready = response.status === 200 && (await response.json()).status === 'ready';
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.ok(ready, 'Broker did not become ready.');
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/v1/clients`)).status, 401);
  const authorized = await fetch(`http://127.0.0.1:${port}/v1/clients`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(authorized.status, 200);
  assert.deepEqual((await authorized.json()).clients, []);
  console.log('Nonroot broker startup, readiness, authenticated API, and shutdown smoke passed.');
} finally {
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000); force.unref();
  if (child.exitCode === null) await once(child, 'exit');
  clearTimeout(force);
  rmSync(directory, { recursive: true, force: true });
}
