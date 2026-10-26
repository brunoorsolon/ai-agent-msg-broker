// Packaged-adapter cooperative transport conformance, NOT authenticated CLI/model certification.
// Pi automatic native acceptance has a separate official-host test. OC auto admission and AG sign-in remain separate gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {mkdirSync,symlinkSync,readFileSync} from 'node:fs';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createInterface} from 'node:readline';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {approvalTlsFixture} from '../test/approval-tls-fixture.mjs';
const execute=promisify(execFile),types=['pi','claude-code','antigravity-cli','opencode'];
// JSON maps each type to an immutable checkout prepared by CI; no network resolution in the test.
const sources=JSON.parse(process.env.PSST_MATRIX_SOURCES||'null');
if(!sources)throw Error('PSST_MATRIX_SOURCES must provide all four reviewed connector checkouts');
const helperPaths={'pi':'vendor/broker/reference/approval.mjs','claude-code':'vendor/approval.mjs','antigravity-cli':'vendor/psst/approval.mjs','opencode':'vendor/enrollment/approval.mjs'};
async function eventually(fn,predicate,label){
 let value;for(let i=0;i<200;i++){value=await fn();if(predicate(value))return value;await delay(25);}
 assert.fail(label+': '+JSON.stringify(value));
}
async function startDriver(f,options){
 const env={PATH:process.env.PATH,HOME:join(options.runtime,'home'),NODE_EXTRA_CA_CERTS:f.certFile};
 const child=spawn(process.execPath,[fileURLToPath(new URL('./connector-driver.mjs',import.meta.url)),JSON.stringify(options)],{env,stdio:['pipe','pipe','pipe']});
 let stderr='',next=0;const pending=new Map();let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const exited=new Promise(resolve=>child.once('close',resolve));child.stderr.on('data',c=>stderr=(stderr+c).slice(-8192));
 createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);if(r.ready)readyResolve();else {const p=pending.get(r.id);pending.delete(r.id);if(r.error)p?.reject(Error(r.error));else p?.resolve(r.value);}});
 child.on('close',code=>{const error=Error(`matrix ${options.type} child exited ${code}: ${stderr}`);readyReject(error);for(const p of pending.values())p.reject(error);});
 const fail=error=>{readyReject(error);for(const p of pending.values())p.reject(error);pending.clear();};
 child.on('error',fail);child.stdin.on('error',error=>{fail(error);child.kill('SIGKILL');});
 const startup=setTimeout(()=>{readyReject(Error('driver_start_timeout'));child.kill('SIGKILL');},10000);
 try{await ready;}finally{clearTimeout(startup);}
 const call=(name,args={})=>new Promise((resolve,reject)=>{if(child.exitCode!==null||child.signalCode||child.stdin.destroyed){reject(Error('driver_closed'));return;}const id=++next,timer=setTimeout(()=>{pending.delete(id);child.kill('SIGKILL');reject(Error('driver_call_timeout'));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});child.stdin.write(JSON.stringify({id,name,args})+'\n');});
 return {call,async close(){if(child.exitCode!==null||child.signalCode||child.stdin.destroyed)return;await call('close');child.stdin.end();await exited;},kill(){child.kill('SIGKILL');}};
}
test('four actual packages: sixteen cooperative routes, shared approvals and installation-only recreation',{timeout:120000},async t=>{
 const f=await approvalTlsFixture(t);let enrollmentPosts=0;
 f.app.server.prependListener('request',req=>{if(req.method==='POST'&&req.url==='/v1/enrollment-requests')enrollmentPosts++;});
 const packages={},approved={},installations={},hashes={},drivers=[];
 t.after(async()=>{for(const d of drivers)try{await d.close();}catch{d.kill();}});
 for(const type of types){
  const source=resolve(sources[type]),out=join(f.directory,'packages',type);mkdirSync(out,{recursive:true,mode:0o700});
  const {stdout}=await execute('npm',['pack','--json','--ignore-scripts','--cache',join(f.directory,'npm-cache'),'--pack-destination',out],{cwd:source,timeout:30000});
  const packed=JSON.parse(stdout)[0];assert.equal(packed.name,`@matuto-ai/${type==='claude-code'?'claude-code':type==='antigravity-cli'?'antigravity':type}-broker-connector`);
  t.diagnostic(`package ${type}: ${packed.version}, integrity ${packed.integrity}`);
  const archive=join(out,packed.filename);await execute('tar',['-xzf',archive,'-C',out]);packages[type]=join(out,'package');
  if(type==='opencode')symlinkSync(join(source,'node_modules'),join(packages[type],'node_modules'));
  const helper=pathToFileURL(join(packages[type],helperPaths[type])).href;
  installations[type]=join(f.directory,'persistent',type);mkdirSync(installations[type],{recursive:true,mode:0o700});
  const options={brokerUrl:f.brokerUrl,directory:join(installations[type],'credentials'),clientType:type};
  const run=async operation=>JSON.parse((await f.runNode(`import * as h from ${JSON.stringify(helper)};process.stdout.write(JSON.stringify(await h[process.argv[1]](JSON.parse(process.argv[2]))));`,[operation,JSON.stringify(options)])).stdout);
  const pending=await run('beginApproval');assert.equal(pending.state,'pending');
  // Approval is real; native setup UI is covered by each connector's separate host tests.
  const attempt=f.approval.list().find(r=>r.id===pending.requestId);assert.equal(attempt.state,'pending');
  await f.decide(pending.requestId);approved[type]=await run('pollApproval');assert.equal(approved[type].state,'approved');
  hashes[type]=createHash('sha256').update(readFileSync(join(approved[type].connectionFile,'..','token'))).digest('hex');
 }
 assert.equal(new Set(Object.values(approved).map(x=>x.credentialId)).size,4);assert.equal(enrollmentPosts,4);
 const seen=new Set();
 for(let generation=0;generation<2;generation++){
  const sessions={};
  for(const type of types){sessions[type]=[];for(let index=0;index<2;index++){
   const runtime=join(f.directory,'ephemeral',String(generation),type,String(index));
   const d=await startDriver(f,{type,packageRoot:packages[type],installation:installations[type],runtime,nativeId:randomUUID(),brokerUrl:f.brokerUrl,...(generation===0&&index===0?{approved:approved[type]}:{})});drivers.push(d);
   const list=await eventually(()=>d.call('broker_list_clients'),r=>Array.isArray(r.clients)&&r.clients.some(c=>!seen.has(c.client_id)),type+' discovery');
   const fresh=list.clients.filter(c=>!seen.has(c.client_id));assert.equal(fresh.length,1);assert.equal(fresh[0].client_type,type);seen.add(fresh[0].client_id);
   assert.equal(f.store.db.prepare('SELECT credential FROM sessions WHERE id=?').get(fresh[0].client_id).credential,approved[type].credentialId);
   sessions[type].push({...d,id:fresh[0].client_id});
  }}
  const all=Object.values(sessions).flat();assert.equal(new Set(all.map(s=>s.id)).size,8);
  for(const from of types)for(const to of types){
   const sender=sessions[from][0],recipient=sessions[to][from===to?1:0];
   const text=`matrix ${generation}: ${from} -> ${to} ${randomUUID()}`,args={recipient_id:recipient.id,text,send_key:randomUUID()};
   const sent=await sender.call('broker_send',args);assert.ok(sent.message_id,JSON.stringify(sent));
   assert.equal((await sender.call('broker_send',args)).message_id,sent.message_id,'same send key is idempotent');
   const received=await eventually(()=>recipient.call('broker_receive'),r=>r.message_id===sent.message_id,`${from} -> ${to}`);
   assert.ok(received.message.includes(text));assert.ok(received.message.includes(sender.id));assert.equal(received.native_acceptance_recorded,false);
   const receipt={message_id:received.message_id,receipt_token:received.receipt_token};
   assert.equal((await recipient.call('broker_receive')).receipt_token,receipt.receipt_token);
   const ack=await recipient.call('broker_acknowledge',receipt);assert.equal(ack.acknowledged,true);assert.equal(ack.native_acceptance_recorded,false);assert.equal(ack.action_success,'unknown');
   assert.deepEqual(await recipient.call('broker_acknowledge',receipt),ack);
   await eventually(()=>sender.call('broker_message_status',{message_id:sent.message_id}),r=>r.delivery_state==='delivered','durable transport receipt');
  }
  for(const s of all)assert.equal((await s.call('broker_receive')).message,null,'no same-installation cross-talk');
  for(const d of all)await d.close();
  assert.equal(enrollmentPosts,4,'new native lifetimes never enroll again');
  for(const type of types)assert.equal(createHash('sha256').update(readFileSync(join(approved[type].connectionFile,'..','token'))).digest('hex'),hashes[type]);
 }
 assert.equal(seen.size,16);assert.equal(f.approval.list().length,4);
});
