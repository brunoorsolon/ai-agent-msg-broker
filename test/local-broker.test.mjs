import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const unprivileged = process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
test('broker-only startup needs no CLI or connector, creates no sessions, and gives usable private connection data', { timeout: 20000 }, () => {
  const code = `
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalBroker } from ${JSON.stringify(new URL('../scripts/local-broker.mjs', import.meta.url).href)};
import { Inbox, newSessionIdentity } from ${JSON.stringify(new URL('../reference/inbox.mjs', import.meta.url).href)};
import { BrokerClient } from ${JSON.stringify(new URL('../reference/client.mjs', import.meta.url).href)};
import { AdapterRuntime } from ${JSON.stringify(new URL('../reference/runtime.mjs', import.meta.url).href)};
const root=mkdtempSync(join(tmpdir(),'broker-only-')); let broker; const inboxes=[];
try {
 broker=await startLocalBroker({directory:join(root,'state')});
 assert.equal(process.env.PATH,'/no-native-executables');
 assert.equal(new URL(broker.origin).hostname,'127.0.0.1');
 assert.equal((await fetch(broker.origin+'/v1/clients',{signal:AbortSignal.timeout(2000)})).status,401);
 assert.equal(broker.clients.length,2);
 const manifest=broker.clients.map(c=>JSON.parse(readFileSync(c.connectionFile)));
 assert.equal(manifest[0].protocol_version,'1');
 assert.deepEqual(manifest[0].allowed_client_types,['pi','antigravity-cli','claude-code','opencode']);
 for(let i=0;i<2;i++) {
  const m=manifest[i], c=broker.clients[i];
  assert.equal(m.broker_url,broker.origin); assert.equal(m.token_file,c.tokenFile);
  assert.equal(m.authorization_header,'Authorization'); assert.equal(m.authorization_scheme,'Bearer');
  assert.equal(statSync(c.tokenFile).mode&0o777,0o600); assert.equal(statSync(c.connectionFile).mode&0o777,0o600);
  assert.ok(Date.parse(m.expires_at)>Date.now()+7190000);
  assert.ok(!JSON.stringify(broker).includes(readFileSync(c.tokenFile,'utf8')));
 }
 const token=readFileSync(broker.clients[0].tokenFile,'utf8');
 const headers={Authorization:'Bearer '+token};
 assert.deepEqual((await (await fetch(broker.origin+'/v1/clients',{headers,signal:AbortSignal.timeout(2000)})).json()).clients,[],'broker must not create or impersonate native sessions');
 assert.ok(!readdirSync(join(root,'state')).some(n=>n.includes('project')||n.includes('connector')));
 const clients=manifest.map((m,i)=>{
  const inbox=new Inbox({directory:join(root,'inbox-'+i),identity:newSessionIdentity(i?'claude-code':'pi')});inboxes.push(inbox);
  return new BrokerClient({...m.reference_client_options,inbox});
 });
 for(let i=0;i<2;i++)await clients[i].register({name:'real-protocol-fixture-'+i,model:{provider:null,id:null,source:'unknown'},project:null});
 const key=clients[0].prepareSend({recipient_id:inboxes[1].identity.client_id,content:{type:'text/plain',text:'broker-only test'}});
 const sent=await clients[0].sendPrepared(key);
 await new AdapterRuntime({client:clients[1],verifySession:()=>true,isAlive:()=>true}).receiveOnce({waitSeconds:0});
 assert.equal((await clients[0].messageStatus(sent.message_id)).delivery_state,'delivered');
 await assert.rejects(startLocalBroker({directory:join(root,'state')}),/directory_already_exists/);
 assert.equal(readFileSync(broker.clients[0].tokenFile,'utf8'),token);
 for(const inbox of inboxes)inbox.close();inboxes.length=0;
 await Promise.all([broker.stop(),broker.stop()]);
 await assert.rejects(fetch(broker.origin+'/readyz',{signal:AbortSignal.timeout(1000)}));
 console.log('Broker-only transport passed without native executables or connector checkout.');
} finally {for(const inbox of inboxes)inbox.close();await broker?.stop();rmSync(root,{recursive:true,force:true});}
`;
  const child=spawnSync(process.execPath,['--input-type=module'],{input:code,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:{...process.env,PATH:'/no-native-executables'},...unprivileged});
  assert.equal(child.status,0,child.stderr||child.error?.message);
  assert.match(child.stdout,/Broker-only transport passed/);
});

test('shell startup diagnostics are immediate and missing Claude no longer exits silently', { timeout: 10000 }, () => {
  const code=`
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'broker-shell-diagnostic-'));
try {
 for(const command of ['uname','id','git','sha256sum','readlink'])symlinkSync('/usr/bin/'+command,join(root,command));
 writeFileSync(join(root,'podman'),'#!/bin/sh\\n[ "$1" = info ] && echo true\\n',{mode:0o700});
 const old=spawnSync('/bin/bash',[${JSON.stringify(new URL('../scripts/start-local-claude-lab.sh', import.meta.url).pathname)}],{env:{...process.env,PATH:root},encoding:'utf8',timeout:2000});
 assert.equal(old.status,1);assert.match(old.stdout,/Preparing/);assert.match(old.stderr,/No terminal Claude executable found/);assert.match(old.stderr,/start-local-broker/);
 rmSync(join(root,'podman'));
 const current=spawnSync('/bin/bash',[${JSON.stringify(new URL('../scripts/start-local-broker.sh', import.meta.url).pathname)}],{env:{...process.env,PATH:root},encoding:'utf8',timeout:2000});
 assert.equal(current.status,1);assert.match(current.stdout,/Preparing broker-only/);assert.match(current.stderr,/Required local command is unavailable: podman/);
 console.log('Startup diagnostics passed.');
}finally{rmSync(root,{recursive:true,force:true});}
`;
  const child=spawnSync(process.execPath,['--input-type=module'],{input:code,encoding:'utf8',timeout:8000,maxBuffer:1024*1024,...unprivileged});
  assert.equal(child.status,0,child.stderr||child.error?.message);assert.match(child.stdout,/Startup diagnostics passed/);
});
