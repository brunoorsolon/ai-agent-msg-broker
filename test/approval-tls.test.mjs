import test from 'node:test';
import assert from 'node:assert/strict';
import {join,dirname} from 'node:path';
import {readFileSync} from 'node:fs';
import {approvalTlsFixture} from './approval-tls-fixture.mjs';
import {registration,sendBody} from './helpers.mjs';
test('real TLS helper subprocesses all four types, actual admin forms, scope and messaging',async t=>{
 const f=await approvalTlsFixture(t),clients=[];
 for(const type of ['pi','claude-code','opencode','antigravity-cli']){
  const options={brokerUrl:f.brokerUrl,directory:join(f.directory,type),clientType:type};
  const pending=await f.helper('beginApproval',options);assert.equal(pending.state,'pending');
  const records=f.approval.list();assert.equal(records.find(r=>r.id===pending.requestId).state,'pending');
  await f.decide(pending.requestId);
  const approved=await f.helper('pollApproval',options);assert.equal(approved.state,'approved');
  const token=readFileSync(join(dirname(approved.connectionFile),'token'),'utf8').trim();
  const req=registration(type),auth={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  const response=await f.request('/v1/sessions',{method:'POST',headers:auth,body:JSON.stringify(req)});assert.equal(response.status,200);
  const session=JSON.parse(response.text);clients.push({token,session,headers:{...auth,'X-Client-ID':session.client_id,'X-Lease-Epoch':String(session.lease_epoch)}});
 }
 assert.equal(new Set(clients.map(c=>c.session.client_id)).size,4);
 const [a,b]=clients;
 const send=await f.request('/v1/messages',{method:'POST',headers:{...a.headers,'Idempotency-Key':'approval-tls-message'},body:JSON.stringify(sendBody(b.session.client_id))});assert.equal(send.status,202);
 await f.decide(f.approval.list().find(r=>r.type==='pi').id,'revoke');
 assert.equal((await f.request('/v1/clients',{headers:{Authorization:`Bearer ${a.token}`}})).status,401);
});
