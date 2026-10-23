import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('operator lab uses private distinct expiring credentials, real loopback delivery, and bounded ownership', { timeout: 20000 }, () => {
  // The Docker build test stage is root; the lab intentionally is not. Run the
  // same assertions in one disposable unprivileged child in either environment.
  const code = `
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalClaudeLab } from ${JSON.stringify(new URL('../scripts/local-claude-lab.mjs', import.meta.url).href)};
import { Inbox, newSessionIdentity } from ${JSON.stringify(new URL('../reference/inbox.mjs', import.meta.url).href)};
import { BrokerClient } from ${JSON.stringify(new URL('../reference/client.mjs', import.meta.url).href)};
import { AdapterRuntime } from ${JSON.stringify(new URL('../reference/runtime.mjs', import.meta.url).href)};
const root = mkdtempSync(join(tmpdir(), "broker-lab-quote-'-$-"));
const adapter = join(root,'adapter'), binary = join(root,'synthetic-claude');
mkdirSync(adapter); mkdirSync(join(adapter,'bin')); mkdirSync(join(adapter,'src'));
writeFileSync(join(adapter,'bin/launch.mjs'),'// Synthetic launcher fixture only.');
writeFileSync(join(adapter,'src/reference-pin.mjs'),'export function verifyReference(root){if(!root.startsWith("/"))throw Error("invalid");}');
const setVersion = version => writeFileSync(binary, '#!'+process.execPath+'\\nconsole.log('+JSON.stringify(version+' (synthetic fixture)')+');\\n', {mode:0o700});
setVersion('2.1.309');
let lab; const inboxes=[];
try {
 const directory=join(root,'state');
 const options={directory,adapterDirectory:adapter,claudeBinary:binary};
 lab=await startLocalClaudeLab(options);
 const endpoint=new URL(lab.origin); assert.equal(endpoint.hostname,'127.0.0.1'); assert.equal(endpoint.protocol,'http:'); assert.ok(Number(endpoint.port)>0);
 assert.equal((await fetch(lab.origin+'/v1/clients',{signal:AbortSignal.timeout(2000)})).status,401);
 const manifest=JSON.parse(readFileSync(join(directory,'LOCAL-TEST.json')));
 assert.equal(manifest.nativeCertified,false);
 assert.ok(Date.parse(manifest.expiresAt)>Date.now()+7190000);
 const verifier=JSON.parse(readFileSync(join(directory,'credentials.json'))).credentials;
 const clients=lab.clients.map(info=>{
  const config=JSON.parse(readFileSync(info.configFile));
  assert.equal(config.expectedCliVersion,'2.1.309'); assert.equal(config.insecureDevelopment,true);
  assert.equal(config.brokerUrl,lab.origin); assert.equal(statSync(info.configFile).mode&0o777,0o600);
  assert.equal(statSync(info.tokenFile).mode&0o777,0o600); assert.equal(statSync(info.stateRoot).mode&0o777,0o700);
  const token=readFileSync(info.tokenFile,'utf8'); assert.ok(!JSON.stringify(lab).includes(token));
  assert.ok(!readFileSync(join(directory,'credentials.json'),'utf8').includes(token));
  const inbox=new Inbox({directory:join(info.stateRoot,'fixture'),identity:newSessionIdentity('claude-code')}); inboxes.push(inbox);
  return new BrokerClient({url:lab.origin,tokenFile:info.tokenFile,insecureDevelopment:true,inbox});
 });
 assert.notEqual(verifier[0].principal_id,verifier[1].principal_id); assert.notEqual(verifier[0].token_sha256,verifier[1].token_sha256);
 const metadata=name=>({name,model:{provider:null,id:null,source:'unknown'},project:null});
 await clients[0].register(metadata('A')); await clients[1].register(metadata('B'));
 assert.equal((await clients[0].listClients()).clients.length,2);
 const key=clients[0].prepareSend({recipient_id:inboxes[1].identity.client_id,content:{type:'text/plain',text:'local native lab transport fixture'}});
 const sent=await clients[0].sendPrepared(key);
 assert.equal((await clients[0].messageStatus(sent.message_id)).delivery_state,'queued');
 const runtime=new AdapterRuntime({client:clients[1],verifySession:()=>true,isAlive:()=>true});
 await runtime.receiveOnce({waitSeconds:0});
 assert.equal((await clients[0].messageStatus(sent.message_id)).delivery_state,'delivered');
 assert.equal(inboxes[1].head().state,'pending');
 assert.ok(lab.commands.every(command=>command.includes("'\\\\''")), 'shell apostrophes must be quoted');
 const before=readFileSync(lab.clients[0].tokenFile,'utf8');
 await assert.rejects(startLocalClaudeLab(options)); assert.equal(readFileSync(lab.clients[0].tokenFile,'utf8'),before);
 setVersion('0.0.0'); const bad=join(root,'bad-version');
 await assert.rejects(startLocalClaudeLab({...options,directory:bad})); assert.equal(existsSync(bad),false);
 for(const inbox of inboxes)inbox.close(); inboxes.length=0;
 await Promise.all([lab.stop(),lab.stop()]);
 await assert.rejects(fetch(lab.origin+'/readyz',{signal:AbortSignal.timeout(1000)}));
 assert.equal(existsSync(join(directory,'LOCAL-TEST.json')),true,'successful shutdown preserves private journals for explicit cleanup');
 console.log('Private local lab transport and cleanup assertions passed; native CLI remains a separate gate.');
} finally { for(const inbox of inboxes)inbox.close(); await lab?.stop(); rmSync(root,{recursive:true,force:true}); }
`;
  const child = spawnSync(process.execPath, ['--input-type=module'], { input: code, encoding: 'utf8', timeout: 15000,
    maxBuffer: 1024 * 1024, ...(process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {}) });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  assert.match(child.stdout, /Private local lab transport and cleanup assertions passed/);
});
