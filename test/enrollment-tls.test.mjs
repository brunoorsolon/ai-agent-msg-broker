import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { enrollmentTlsFixture } from './enrollment-tls-fixture.mjs';
import { Inbox,newSessionIdentity } from '../reference/inbox.mjs';
import { BrokerClient } from '../reference/client.mjs';
import { AdapterRuntime } from '../reference/runtime.mjs';

const metadata=name=>({name,model:{provider:null,id:null,source:'unknown'},project:null});

test('real TLS operator grant -> helper -> dynamic auth -> all four native types -> scoped durable roundtrip',async t=>{
  const f=await enrollmentTlsFixture(t),types=['pi','claude-code','opencode','antigravity-cli'],clients=[];
  let enrollmentRequests=0;f.app.server.on('request',req=>{if(req.url==='/v1/enrollments')enrollmentRequests++;});
  function clientFor(result,type,name){
    const bundle=JSON.parse(readFileSync(result.connectionFile,'utf8'));
    assert.equal(bundle.enrollment_receipt_file,'enrollment.json');assert.equal(bundle.insecure_development,false);assert.equal(bundle.broker_url,f.brokerUrl);
    const inbox=new Inbox({directory:join(f.directory,name),identity:newSessionIdentity(type)});t.after(()=>inbox.close());
    const client=new BrokerClient({url:bundle.broker_url,tokenFile:join(dirname(result.connectionFile),bundle.token_file),caFile:f.certFile,inbox,maxAttempts:1});
    return {client,inbox,result,type};
  }
  assert.equal(f.auth.ready,false);
  for(const type of types){
    const ticket=await f.issue(type);const result=await f.connect(ticket,type);const item=clientFor(result,type,`inbox-${type}`);
    await item.client.register(metadata(type));clients.push(item);
    // A second helper process reconciles the identical issuance, not another credential.
    const repeated=await f.connect(ticket,type,result.installationDirectory);assert.equal(repeated.credentialId,result.credentialId);assert.equal(repeated.connectionFile,result.connectionFile);
  }
  assert.equal(enrollmentRequests,8);assert.equal(new Set(clients.map(c=>c.result.credentialId)).size,4);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM enrolled_credentials').get().n,4);
  assert.equal(f.store.db.prepare('SELECT count(DISTINCT token_hash) n FROM enrolled_credentials').get().n,4);
  assert.equal(f.auth.ready,true);
  for(const {client} of clients){const peers=(await client.listClients()).clients;assert.equal(peers.length,4);assert.deepEqual(peers.map(p=>p.client_type).sort(),[...types].sort());}
  const [pi,claude]=clients;
  async function deliver(sender,receiver,text){
    const key=sender.client.prepareSend({recipient_id:receiver.inbox.identity.client_id,content:{type:'text/plain',text}});
    const accepted=await sender.client.sendPrepared(key);assert.equal(accepted.delivery_state,'queued');
    const runtime=new AdapterRuntime({client:receiver.client,verifySession:()=>true,isAlive:()=>true});
    assert.equal((await runtime.receiveOnce({waitSeconds:0})).stored,true);
    assert.equal(receiver.inbox.head().envelope.content.text,text);assert.equal(receiver.inbox.head().state,'pending');
    assert.equal((await sender.client.messageStatus(accepted.message_id)).delivery_state,'delivered');
  }
  await deliver(pi,claude,'synthetic pi to claude');await deliver(claude,pi,'synthetic claude reply');
  // A separately scoped installation cannot discover/send into the shared scope.
  const privateTicket=await f.issue('opencode',{scope:'private'}),privateResult=await f.connect(privateTicket,'opencode');
  const isolated=clientFor(privateResult,'opencode','isolated-inbox');await isolated.client.register(metadata('isolated'));
  assert.deepEqual((await isolated.client.listClients()).clients.map(c=>c.client_id),[isolated.inbox.identity.client_id]);
  assert.equal((await pi.client.listClients()).clients.length,4);
  const forbidden=pi.client.prepareSend({recipient_id:isolated.inbox.identity.client_id,content:{type:'text/plain',text:'must not cross scope'}});
  await assert.rejects(pi.client.sendPrepared(forbidden),{code:'recipient_not_found'});
  const impostor=clientFor(pi.result,'opencode','wrong-type-inbox');await assert.rejects(impostor.client.register(metadata('wrong-type')),{code:'forbidden'});
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM enrolled_credentials').get().n,5);
});
