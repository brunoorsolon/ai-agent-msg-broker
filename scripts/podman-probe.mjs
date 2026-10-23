// Runs inside the isolated rootless CI container. No production enrollment.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const phase=process.argv[2],expectedUid=Number(process.argv[3]);
assert.ok(['before-restart','after-restart'].includes(phase));
assert.ok(Number.isInteger(expectedUid)&&expectedUid>0);
assert.equal(process.getuid(),expectedUid);
const processStatus=readFileSync('/proc/self/status','utf8');
assert.match(processStatus,/^NoNewPrivs:\s+1$/m);
assert.match(processStatus,/^CapEff:\s+0+$/m);
for(const path of ['/app/root-readonly-probe','/run/broker/config-readonly-probe']){
  assert.throws(()=>writeFileSync(path,'must fail'),e=>['EROFS','EACCES'].includes(e.code));
}
const token=readFileSync('/run/broker/token','utf8').trim();
const base='http://127.0.0.1:8787';
const request=async(path,{method='GET',body,session,epoch=1,key}={})=>{
 const response=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,...(session?{'X-Client-ID':session,'X-Lease-Epoch':String(epoch)}:{}),...(key?{'Idempotency-Key':key}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(2000)});
 return {status:response.status,body:response.status===204?null:await response.json()};
};
const deadline=Date.now()+10000;let ready=false;
while(Date.now()<deadline){try{if((await request('/readyz')).status===200){ready=true;break;}}catch{}await delay(50);}
assert.ok(ready,'Broker did not become ready.');
assert.equal((await fetch(base+'/v1/clients',{signal:AbortSignal.timeout(2000)})).status,401);
const statePath='/data/fixture-state.json';
if(phase==='before-restart'){
 const registration=()=>({protocol_version:'1',client_id:randomUUID(),client_type:'pi',session_instance_id:randomUUID(),connection_id:randomUUID(),previous_epoch:0,metadata:{name:'rootless-fixture',model:{provider:null,id:null,source:'unknown'},project:null},capabilities:{protocol_version:'1',adapter_version:'0.1.0',client_type:'pi',receive_enabled:true,durable_inbox:true}});
 const sender=registration(),recipient=registration();
 for(const value of[sender,recipient])assert.equal((await request('/v1/sessions',{method:'POST',body:value})).status,200);
 const body={recipient_id:recipient.client_id,content:{type:'text/plain',text:'disposable rootless persistence fixture'}};
 const sent=await request('/v1/messages',{method:'POST',session:sender.client_id,key:'persisted-send',body});assert.equal(sent.status,202);
 const claim=await request('/v1/mailbox/claim',{method:'POST',session:recipient.client_id,key:'unconfirmed',body:{}});assert.equal(claim.status,200);assert.equal(claim.body.attempt,1);
 writeFileSync(statePath,JSON.stringify({sender,recipient,body,message_id:sent.body.message_id,old_claim_id:claim.body.claim_id}),{mode:0o600});
}else{
 const saved=JSON.parse(readFileSync(statePath,'utf8'));
 for(const value of[saved.sender,saved.recipient]){
  const state=await request(`/v1/sessions/${value.client_id}`);assert.equal(state.body.connected,false);
  const reconnect=await request('/v1/sessions',{method:'POST',body:{...value,previous_epoch:1,connection_id:randomUUID()}});assert.equal(reconnect.body.lease_epoch,2);
 }
 const replay=await request('/v1/messages',{method:'POST',session:saved.sender.client_id,epoch:2,key:'persisted-send',body:saved.body});assert.equal(replay.body.message_id,saved.message_id);
 const stale=await request(`/v1/mailbox/${saved.message_id}/complete`,{method:'POST',session:saved.recipient.client_id,epoch:1,body:{claim_id:saved.old_claim_id,outcome:'delivered'}});assert.equal(stale.body.error.code,'stale_lease_epoch');
 const claim=await request('/v1/mailbox/claim',{method:'POST',session:saved.recipient.client_id,epoch:2,key:'recovered',body:{}});assert.equal(claim.body.attempt,2);assert.equal(claim.body.envelope.message_id,saved.message_id);
 const complete=await request(`/v1/mailbox/${saved.message_id}/complete`,{method:'POST',session:saved.recipient.client_id,epoch:2,body:{claim_id:claim.body.claim_id,outcome:'delivered'}});assert.equal(complete.body.delivery_state,'delivered');
}
for(const path of['/data/broker.sqlite',statePath]){const stat=statSync(path);assert.equal(stat.uid,expectedUid);assert.equal(stat.mode&0o077,0);}
console.log(`Rootless fixture ${phase}: keep-id, private read-only config, writable durable volume and authenticated transport passed.`);
