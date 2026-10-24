import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { credential, registration, sendBody, uuid } from './helpers.mjs';

test('SIGKILL/restart preserves WAL messages and idempotency while fencing every old lease and claim',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'broker-crash-')),creds=credential(),file=join(directory,'credentials.json'),config=join(directory,'config.json');
 writeFileSync(file,JSON.stringify({credentials:[creds.entry]}),{mode:0o600});
 const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 writeFileSync(config,JSON.stringify({database:join(directory,'broker.sqlite'),credential_file:file,host:'127.0.0.1',port,insecure_development:true}),{mode:0o600});
 let child;
 const stop=async signal=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill(signal);await exited;};
 t.after(async()=>{await stop('SIGTERM');rmSync(directory,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;
 const start=async()=>{
  child=spawn(process.execPath,['src/main.mjs'],{env:{...process.env,BROKER_CONFIG_FILE:config},stdio:'ignore'});
  const until=Date.now()+5000;
  while(Date.now()<until){assert.equal(child.exitCode,null);try{if((await fetch(base+'/readyz',{signal:AbortSignal.timeout(200)})).status===200)return;}catch{}await delay(20);}
  throw new Error('Child broker startup timeout.');
 };
 const request=async(path,{method='GET',body,client,epoch=1,key}={})=>{
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${creds.token}`,...(client?{'X-Client-ID':client,'X-Lease-Epoch':String(epoch)}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(3000)});
  return {status:r.status,body:r.status===204?null:await r.json()};
 };
 await start();const a=registration(),b=registration();await request('/v1/sessions',{method:'POST',body:a});await request('/v1/sessions',{method:'POST',body:b});
 const body=sendBody(b.client_id,'survives abrupt broker death');const first=await request('/v1/messages',{method:'POST',client:a.client_id,key:'persist',body});assert.equal(first.status,202);
 const lost=await request('/v1/mailbox/claim',{method:'POST',client:b.client_id,key:'lost-response',body:{}});assert.equal(lost.body.attempt,1);
 await stop('SIGKILL');await start();
 assert.equal((await request(`/v1/sessions/${a.client_id}`)).body.connected,false);
 assert.equal((await request(`/v1/sessions/${a.client_id}/heartbeat`,{method:'POST',client:a.client_id,body:{}})).body.error.code,'stale_lease_epoch');
 for(const s of[a,b])assert.equal((await request('/v1/sessions',{method:'POST',body:{...s,previous_epoch:1,connection_id:uuid()}})).body.lease_epoch,2);
 const replay=await request('/v1/messages',{method:'POST',client:a.client_id,epoch:2,key:'persist',body});assert.equal(replay.body.message_id,first.body.message_id);
 const stale=await request(`/v1/mailbox/${first.body.message_id}/complete`,{method:'POST',client:b.client_id,body:{claim_id:lost.body.claim_id,outcome:'delivered'}});assert.equal(stale.body.error.code,'stale_lease_epoch');
 const redelivered=await request('/v1/mailbox/claim',{method:'POST',client:b.client_id,epoch:2,key:'redelivery',body:{}});assert.equal(redelivered.body.envelope.message_id,first.body.message_id);assert.equal(redelivered.body.attempt,2);
 const completed=await request(`/v1/mailbox/${first.body.message_id}/complete`,{method:'POST',client:b.client_id,epoch:2,body:{claim_id:redelivered.body.claim_id,outcome:'delivered'}});assert.equal(completed.body.delivery_state,'delivered');
 await stop('SIGTERM');
});
