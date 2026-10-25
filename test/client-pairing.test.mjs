import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,chmodSync,writeFileSync,unlinkSync } from 'node:fs';
import { join,dirname } from 'node:path';
import { secretHash } from '../src/enrollment.mjs';
import { setup } from './pairing-helpers.mjs';
import { connectPairingFile,readEnrollmentReceipt } from '../reference/enrollment.mjs';
import { manageEnrollment,argumentsFor } from '../scripts/manage-enrollment.mjs';
test('client helper persists before request, redacts failures, retries after unknown, writes legacy bundle and isolates attempts',async t=>{
 const s=setup(t),directory=join(s.f.dir,'installation');let firstBody;
 const transport=async(url,secret,body)=>{assert.equal(url,'https://broker.example');assert.equal(secret,s.pair.pairing_secret);firstBody??=body;assert.equal(body,firstBody);return s.enrollment.redeem(`Pairing ${secret}`,JSON.parse(body),s.auth.entries);};
 // Adapt service response shape to HTTP helper.
 const success=async(...args)=>{const r=await transport(...args);return{status:r.status,body:r.result};};
 await assert.rejects(connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport:async(...args)=>{await success(...args);throw Error(`do not leak ${s.pair.pairing_secret}`);}}),e=>e.code==='enrollment_local_error'&&!e.message.includes(s.pair.pairing_secret));
 const result=await connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport:success});assert.equal(result.connectionFile,join(directory,'enrollments',secretHash(s.pair.pairing_secret),'connection.json'));
 const bundle=JSON.parse(readFileSync(result.connectionFile));assert.equal(bundle.format,'broker-client-bundle-v1');assert.equal(bundle.insecure_development,false);
 const token=readFileSync(join(dirname(result.connectionFile),bundle.token_file),'utf8').trim();assert.equal(s.auth.authenticate(`Bearer ${token}`).credential_id,result.credentialId);
 const r2=await connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport:success});assert.deepEqual(r2,result);
 await assert.rejects(connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi',brokerUrl:'https://wrong.example'},{transport:success}),e=>e.code==='broker_origin_mismatch');
 chmodSync(s.pairingFile,0o644);await assert.rejects(connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport:success}),e=>e.code==='private_file_required');
});

test('operator explicit consent, bounded TTL, safe output, and local revocation',t=>{
 const s=setup(t);assert.throws(()=>manageEnrollment({action:'pair',policyFile:s.policyFile}));
 const opts={action:'pair',policyFile:s.policyFile,outputFile:join(s.f.dir,'operator-ticket.json'),brokerUrl:'https://broker.example',clientType:'pi',principalId:'owner',scope:'default',approve:true};
 for(const bad of [{ticketSeconds:0},{ticketSeconds:3601},{credentialDays:366},{brokerUrl:'http://broker.example'},{clientType:'unknown'}])assert.throws(()=>manageEnrollment({...opts,...bad}));
 const result=manageEnrollment(opts,{clock:()=>s.f.now});assert.equal(result.action,'pair');const pair=JSON.parse(readFileSync(opts.outputFile));assert.equal(JSON.stringify(result).includes(pair.pairing_secret),false);
 assert.throws(()=>manageEnrollment(opts,{clock:()=>s.f.now}));
 const issued=s.enrollment.redeem(`Pairing ${pair.pairing_secret}`,s.request);
 manageEnrollment({action:'revoke',policyFile:s.policyFile,credentialId:issued.result.credential_id,approve:true});assert.throws(()=>s.auth.authenticate(`Bearer ${s.token}`),e=>e.code==='unauthenticated');
 assert.throws(()=>argumentsFor(['pair','--token','never-allowed']));
});

test('kernel ownership rejects concurrent connect and releases after SIGKILL without losing retry identity',async t=>{
 const {spawn}=await import('node:child_process');const {once}=await import('node:events');
 const s=setup(t),directory=join(s.f.dir,'crash-installation');
 const moduleUrl=new URL('../reference/enrollment.mjs',import.meta.url).href;
 const child=spawn(process.execPath,['--input-type=module','-e',`import {connectPairingFile} from ${JSON.stringify(moduleUrl)}; await connectPairingFile(JSON.parse(process.argv[1]),{transport:async(_url,_secret,body)=>{process.send(JSON.parse(body));await new Promise(()=>setInterval(()=>{},1000));}});`,JSON.stringify({pairingFile:s.pairingFile,directory,clientType:'pi'})],{stdio:['ignore','ignore','pipe','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
 const [pending]=await once(child,'message');
 await assert.rejects(connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'}),e=>e.code==='enrollment_busy');
 child.kill('SIGKILL');await once(child,'exit');
 const result=await connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport:async(_url,secret,body)=>{assert.deepEqual(JSON.parse(body),pending);const r=s.enrollment.redeem(`Pairing ${secret}`,JSON.parse(body));return{status:r.status,body:r.result};}});
 assert.ok(result.credentialId);
});

test('helper refuses plaintext and never sends enrollment to an untrusted TLS certificate',async t=>{
 const {execFileSync}=await import('node:child_process');const https=await import('node:https');const {writeFileSync}=await import('node:fs');
 const s=setup(t),directory=join(s.f.dir,'tls-installation'),key=join(s.f.dir,'key.pem'),cert=join(s.f.dir,'cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
 let requests=0;const server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(_q,r)=>{requests++;r.end('{}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const pair=JSON.parse(readFileSync(s.pairingFile));pair.broker_url=`https://127.0.0.1:${server.address().port}`;writeFileSync(s.pairingFile,JSON.stringify(pair));
 await assert.rejects(connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'}),e=>e.code==='enrollment_transport_error'&&!e.message.includes(pair.pairing_secret));assert.equal(requests,0);
 pair.broker_url='http://127.0.0.1';writeFileSync(s.pairingFile,JSON.stringify(pair));await assert.rejects(connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'}),e=>e.code==='https_origin_required');
});

test('saved enrollment receipt binds credential partition to broker, type and private token',async t=>{
 const s=setup(t),directory=join(s.f.dir,'receipt-installation');
 const result=await connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport:async(_url,secret,body)=>{const r=s.enrollment.redeem(`Pairing ${secret}`,JSON.parse(body));return{status:r.status,body:r.result};}});
 assert.deepEqual(readEnrollmentReceipt({connectionFile:result.connectionFile,clientType:'pi'}),{credentialId:result.credentialId,expiresAt:result.expiresAt});
 const receiptFile=join(dirname(result.connectionFile),'enrollment.json'),original=JSON.parse(readFileSync(receiptFile));
 for(const patch of [{token_sha256:'0'.repeat(64)},{broker_url:'https://wrong.example'},{client_type:'opencode'},{credential_id:'user-supplied-name'}]){
   writeFileSync(receiptFile,JSON.stringify({...original,...patch}));assert.throws(()=>readEnrollmentReceipt({connectionFile:result.connectionFile,clientType:'pi'}),e=>e.code==='invalid_enrollment_receipt');
 }
 writeFileSync(receiptFile,JSON.stringify({...original,expires_at:new Date(0).toISOString()}));assert.throws(()=>readEnrollmentReceipt({connectionFile:result.connectionFile,clientType:'pi'}),e=>e.code==='credential_expired');
 unlinkSync(receiptFile);assert.throws(()=>readEnrollmentReceipt({connectionFile:result.connectionFile,clientType:'pi'}),e=>e.code==='invalid_enrollment_receipt');
});

test('real HTTPS helper bounds slow-trickle deadline and oversized response, and never follows redirects',async t=>{
 const {execFileSync,spawn}=await import('node:child_process');const https=await import('node:https');const {once}=await import('node:events');
 const s=setup(t),key=join(s.f.dir,'bounded-key.pem'),cert=join(s.f.dir,'bounded-cert.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
 let mode='redirect',requests=0;
 const server=https.createServer({key:readFileSync(key),cert:readFileSync(cert)},(_q,r)=>{
   requests++;
   if(mode==='redirect'){r.writeHead(302,{Location:'https://localhost:'+server.address().port+'/must-not-follow'});r.end('{}');}
   else if(mode==='oversized'){r.writeHead(200);r.end('x'.repeat(17000));}
   else {r.writeHead(200);r.write('{');const timer=setInterval(()=>r.write(' '),100);r.on('close',()=>clearInterval(timer));}
 });
 await new Promise(r=>server.listen(0,r));t.after(()=>new Promise(r=>server.close(r)));
 const pair=JSON.parse(readFileSync(s.pairingFile));pair.broker_url=`https://localhost:${server.address().port}`;writeFileSync(s.pairingFile,JSON.stringify(pair));
 const moduleUrl=new URL('../reference/enrollment.mjs',import.meta.url).href;
 for(const current of ['redirect','oversized','slow']){
   mode=current;requests=0;const start=Date.now();
   const child=spawn(process.execPath,['--input-type=module','-e',`import {connectPairingFile} from ${JSON.stringify(moduleUrl)};try{await connectPairingFile(JSON.parse(process.argv[1]));process.exitCode=1;}catch(e){console.log(JSON.stringify({code:e.code,effect:e.effect}));}`,JSON.stringify({pairingFile:s.pairingFile,directory:join(s.f.dir,'bounded-'+current),clientType:'pi'})],{env:{...process.env,NODE_EXTRA_CA_CERTS:cert},stdio:['ignore','pipe','pipe']});
   let out='';child.stdout.on('data',c=>out+=c);const [code]=await once(child,'exit');assert.equal(code,0);const result=JSON.parse(out);
   assert.equal(requests,1);assert.equal(result.effect,'unknown');assert.ok(['invalid_response','enrollment_transport_error'].includes(result.code));
   if(current==='slow'){assert.ok(Date.now()-start<13000);assert.ok(Date.now()-start>=9500);}
 }
});

test('native private-input helper shares file retries without writing the pairing secret',async t=>{
 const {connectPairingSecret}=await import('../reference/enrollment.mjs');
 const {readdirSync}=await import('node:fs');
 const s=setup(t),directory=join(s.f.dir,'native-input');let bodyFirst;
 const options={directory,brokerUrl:'https://broker.example',clientType:'pi',pairingSecret:s.pair.pairing_secret};
 const transport=async(_url,secret,body)=>{bodyFirst??=body;assert.equal(body,bodyFirst);const r=s.enrollment.redeem(`Pairing ${secret}`,JSON.parse(body));return{status:r.status,body:r.result};};
 await assert.rejects(connectPairingSecret(options,{transport:async(...args)=>{await transport(...args);throw Error(options.pairingSecret);}}),e=>e.code==='enrollment_local_error'&&!e.message.includes(options.pairingSecret));
 const result=await connectPairingSecret(options,{transport});
 assert.deepEqual(await connectPairingFile({pairingFile:s.pairingFile,directory,clientType:'pi'},{transport}),result);
 const scan=path=>{for(const entry of readdirSync(path,{withFileTypes:true})){const child=join(path,entry.name);if(entry.isDirectory())scan(child);else assert.equal(readFileSync(child).includes(Buffer.from(options.pairingSecret)),false);}};
 scan(directory);
 assert.equal(readEnrollmentReceipt({connectionFile:result.connectionFile,clientType:'pi'}).credentialId,result.credentialId);
 for(const change of [{pairingSecret:'short'},{brokerUrl:'http://broker.example'},{clientType:'wrong'}]) await assert.rejects(connectPairingSecret({...options,...change},{transport:()=>{throw Error('must not request');}}));
});
