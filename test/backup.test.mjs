import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, chmodSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupDatabase } from '../scripts/backup.mjs';

test('online backup includes committed WAL data and never mutates live identities', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'broker-backup-')); chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.sqlite'), dest = join(dir, 'snapshot.sqlite');
  const db = new DatabaseSync(source); t.after(() => db.close());
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE sessions(id TEXT, epoch INTEGER); INSERT INTO sessions VALUES('fixture-session',7); CREATE TABLE messages(id TEXT,state TEXT); INSERT INTO messages VALUES('fixture-message','claimed');");
  assert.deepEqual(await backupDatabase(source, dest), { ok: true });
  const snapshot = new DatabaseSync(dest, { readOnly: true }); t.after(() => snapshot.close());
  assert.equal(snapshot.prepare('SELECT epoch FROM sessions').get().epoch, 7);
  assert.equal(snapshot.prepare('SELECT state FROM messages').get().state, 'claimed');
  assert.equal(db.prepare('SELECT epoch FROM sessions').get().epoch, 7);
  assert.equal(statSync(dest).mode & 0o777, 0o600);
  const before = readFileSync(dest);
  await assert.rejects(backupDatabase(source, dest));
  assert.deepEqual(readFileSync(dest), before);
});

test('backup rejects symlinks, public directories and non-database sources safely', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'broker-backup-')); chmodSync(dir, 0o700);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source.sqlite'), dest = join(dir, 'snapshot.sqlite');
  const db = new DatabaseSync(source); db.exec('CREATE TABLE fixture(id INTEGER)'); db.close();
  const link = join(dir, 'source-link'); symlinkSync(source, link);
  await assert.rejects(backupDatabase(link, dest));
  chmodSync(dir, 0o755);
  await assert.rejects(backupDatabase(source, dest));
  chmodSync(dir, 0o700);
  const plain = join(dir, 'not-sqlite'); writeFileSync(plain, 'not a database');
  await assert.rejects(backupDatabase(plain, dest));
  assert.throws(() => statSync(dest), { code: 'ENOENT' });
  await assert.rejects(backupDatabase(source, source));
});
