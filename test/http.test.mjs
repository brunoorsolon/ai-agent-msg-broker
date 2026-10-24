import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createBrokerServer } from '../src/server.mjs';
import { httpFixture, registration, sendBody, credential, uuid } from './helpers.mjs';

test('all /v1 endpoints authenticate, reject browser and malformed input, health is minimal',async t=>{
 const f=await httpFixture(t);
 assert.equal((await f.request('/healthz',{token:null})).body.status,'ok');assert.equal((await f.request('/readyz',{token:null})).status,200);
 for(const path of ['/v1/clients','/v1/sessions','/v1/unknown'])assert.equal((await f.request(path,{token:null})).status,401);
 assert.equal((await f.request('/v1/clients',{headers:{Origin:'https://example.invalid'}})).status,403);
 assert.equal((await f.request('/v1/clients?token=secret')).status,400);
 assert.equal((await f.request('/v1/sessions',{method:'POST',body:{}})).status,400);
 const bad=await fetch(f.base+'/v1/sessions',{method:'POST',headers:{Authorization:`Bearer ${f.a.token}`,'Content-Type':'application/json'},body:Buffer.from([0xff])});assert.equal(bad.status,400);
 const malformed=await fetch(f.base+'/v1/sessions',{method:'POST',headers:{Authorization:`Bearer ${f.a.token}`,'Content-Type':'application/json'},body:'{'});assert.equal(malformed.status,400);
 const oversized=await f.request('/v1/sessions',{method:'POST',body:{secret:'x'.repeat(100000)}});assert.equal(oversized.status,413);assert.ok(!JSON.stringify(oversized.body).includes(f.a.token));
});

test('HTTP send, concurrent FIFO sequences, independent polls, and durable completion',async t=>{
 const f=await httpFixture(t,{limits:{send_burst:100}}),a=registration(),b=registration(),c=registration();
 assert.equal((await f.request('/v1/sessions',{method:'POST',body:a})).status,200);
 await f.request('/v1/sessions',{token:f.b.token,method:'POST',body:b});await f.request('/v1/sessions',{token:f.b.token,method:'POST',body:c});
 const receipts=await Promise.all(Array.from({length:12},(_,i)=>f.request('/v1/messages',{method:'POST',session:a.client_id,key:`send-${i}`,body:sendBody(b.client_id,`message-${i}`)})));
 assert.ok(receipts.every(r=>r.status===202));assert.deepEqual(receipts.map(r=>r.body.recipient_sequence).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
 const empty=f.request('/v1/mailbox/claim',{token:f.b.token,method:'POST',session:c.client_id,key:'wait',body:{wait_seconds:1}});
 const claim=await f.request('/v1/mailbox/claim',{token:f.b.token,method:'POST',session:b.client_id,key:'claim',body:{}});assert.equal(claim.status,200);assert.equal(claim.body.envelope.recipient_sequence,1);
 const complete=await f.request(`/v1/mailbox/${claim.body.envelope.message_id}/complete`,{token:f.b.token,method:'POST',session:b.client_id,body:{claim_id:claim.body.claim_id,outcome:'delivered'}});assert.equal(complete.body.delivery_state,'delivered');
 assert.equal((await empty).status,204);
});

test('long poll one-consumer guard, revocation promptly cancels, token rotation retains identity',async t=>{
 const f=await httpFixture(t),a=registration();await f.request('/v1/sessions',{method:'POST',body:a});
 const pending=f.request('/v1/mailbox/claim',{method:'POST',session:a.client_id,key:'wait',body:{wait_seconds:30}});
 while(f.app.polls.size===0)await new Promise(r=>setTimeout(r,1));
 assert.equal((await f.request('/v1/mailbox/claim',{method:'POST',session:a.client_id,key:'second',body:{wait_seconds:0}})).status,409);
 const rotation=credential('rotated');rotation.entry.adapter_id=f.a.entry.adapter_id;
 f.writeCreds([f.a.entry,rotation.entry,f.b.entry]);
 assert.equal((await f.request(`/v1/sessions/${a.client_id}/heartbeat`,{method:'POST',token:rotation.token,session:a.client_id,body:{}})).status,200);
 f.writeCreds([rotation.entry,f.b.entry]);assert.equal((await pending).status,401);
 // Rotation heartbeat transferred lease to the live replacement credential.
 assert.equal((await f.request(`/v1/sessions/${a.client_id}/heartbeat`,{method:'POST',token:rotation.token,session:a.client_id,body:{}})).status,200);
 assert.equal((await f.request('/v1/clients')).status,401);
});

test('non-loopback plaintext and implicit insecure startup are rejected',()=>{
 assert.throws(()=>createBrokerServer({host:'0.0.0.0',insecureDevelopment:true}),/TLS|loopback/);
 assert.throws(()=>createBrokerServer({host:'127.0.0.1'}),/TLS/);
});

test('HTTP lower-case normalization, expiry-independent receipt reads and concise errors',async t=>{
 const f=await httpFixture(t),a=registration(),b=registration();await f.request('/v1/sessions',{method:'POST',body:a});await f.request('/v1/sessions',{token:f.b.token,method:'POST',body:b});
 const sent=await f.request('/v1/messages',{method:'POST',session:a.client_id.toUpperCase(),key:'x',body:sendBody(b.client_id)});assert.equal(sent.status,202);
 f.advance(180001);const status=await f.request(sent.body.status_url,{session:a.client_id});assert.equal(status.status,200);
 const beat=await f.request(`/v1/sessions/${a.client_id}/heartbeat`,{method:'POST',session:a.client_id,body:{}});assert.equal(beat.status,409);assert.equal(beat.body.error.effect,'not_applied');assert.ok(beat.body.error.contract_ref.includes('LeaseEpoch'));
});

test('operator scope shrink removes former-scope discovery and send access without granting new scopes',async t=>{
 const f=await httpFixture(t),a=registration(),b=registration();
 f.a.entry.scopes=['secret'];f.b.entry.scopes=['secret','public'];f.writeCreds([f.a.entry,f.b.entry,f.c.entry]);
 await f.request('/v1/sessions',{method:'POST',body:a});await f.request('/v1/sessions',{token:f.b.token,method:'POST',body:b});
 assert.equal((await f.request('/v1/clients')).body.clients.length,2);
 const sent=await f.request('/v1/messages',{method:'POST',session:a.client_id,key:'before',body:sendBody(b.client_id)});assert.equal(sent.status,202);
 f.b.entry.scopes=['public'];f.writeCreds([f.a.entry,f.b.entry,f.c.entry]);
 const listing=await f.request('/v1/clients?connected=false');assert.equal(listing.body.clients.length,1);assert.equal(listing.body.clients[0].client_id,a.client_id);
 assert.equal((await f.request('/v1/messages',{method:'POST',session:a.client_id,key:'after',body:sendBody(b.client_id)})).status,404);
 assert.equal((await f.request(sent.body.status_url,{session:a.client_id})).status,200);
 assert.equal((await f.request(sent.body.status_url,{token:f.b.token,session:b.client_id})).status,404);
 const state=await f.request(`/v1/sessions/${b.client_id}`,{token:f.b.token});assert.equal(state.status,200);assert.equal(state.body.connected,false);
 const reconnected=await f.request('/v1/sessions',{token:f.b.token,method:'POST',body:{...b,previous_epoch:1,connection_id:uuid()}});assert.equal(reconnected.status,200);
 assert.equal((await f.request('/v1/clients?connected=false')).body.clients.length,1);
});

test('explicit empty credential collection keeps health public but every API denied and readiness unavailable',async t=>{
 const f=await httpFixture(t);f.writeCreds([]);
 assert.equal((await f.request('/healthz',{token:null})).status,200);
 assert.equal((await f.request('/readyz',{token:null})).status,503);
 for(const token of [null,f.a.token,'123'])for(const path of ['/v1/clients','/v1/sessions','/v1/unknown']) {
  assert.equal((await f.request(path,{token})).status,401);
  assert.equal((await f.request(path,{token,method:'POST',body:{}})).status,401);
 }
 assert.equal(f.auth.ready,false);assert.deepEqual(f.auth.entries,[]);
});

test('reloading empty credentials revokes leases and cancels polls without silently restoring them',async t=>{
 const f=await httpFixture(t),session=registration();await f.request('/v1/sessions',{method:'POST',body:session});
 const pending=f.request('/v1/mailbox/claim',{method:'POST',session:session.client_id,key:'disable',body:{wait_seconds:30}});
 while(f.app.polls.size===0)await new Promise(r=>setTimeout(r,1));
 f.writeCreds([]);assert.equal((await f.request('/readyz',{token:null})).status,503);assert.equal((await pending).status,401);
 f.writeCreds([f.a.entry]);assert.equal((await f.request('/readyz',{token:null})).status,200);
 assert.equal((await f.request(`/v1/sessions/${session.client_id}`)).body.connected,false);
 assert.equal((await f.request(`/v1/sessions/${session.client_id}/heartbeat`,{method:'POST',session:session.client_id,body:{}})).status,403); // removed scope is not silently re-granted
});

test('explicit proxy transport permits container listener without trusting forwarded auth or bypassing API auth',async t=>{
 const f=await httpFixture(t,{server:{host:'0.0.0.0',insecureDevelopment:false,proxyTransport:true}});
 assert.equal(f.app.server.address().address,'0.0.0.0');
 assert.equal((await f.request('/healthz',{token:null})).status,200);
 assert.equal((await f.request('/v1/clients',{token:null,headers:{'X-Forwarded-Proto':'https','X-Forwarded-For':'127.0.0.1','X-Forwarded-User':'owner'}})).status,401);
 assert.equal((await f.request('/v1/clients')).status,200);
});

test('proxy transport must be explicit boolean and cannot combine with TLS or development exceptions',()=>{
 for(const options of [
  {proxyTransport:'true'},{proxyTransport:1},{proxyTransport:true,insecureDevelopment:true},
  {proxyTransport:true,proxyLoopback:true},{proxyTransport:true,tls:{certFile:'unused',keyFile:'unused'}},
  {host:'0.0.0.0',proxyLoopback:true},{host:'0.0.0.0'}
 ])assert.throws(()=>createBrokerServer(options));
});
