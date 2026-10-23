import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateLanOptions } from '../scripts/lan-broker.mjs';

test('HTTPS startup requires explicit local bind, wildcard acknowledgment and injection-safe SAN',()=>{
  const options={bind:'127.0.0.1',hostname:'host.containers.internal'};
  assert.equal(validateLanOptions(options).port,8787);
  assert.throws(()=>validateLanOptions({...options,bind:'0.0.0.0'}),/wildcard_ack_required/);
  assert.equal(validateLanOptions({...options,bind:'0.0.0.0',allowAllInterfaces:true}).bind,'0.0.0.0');
  assert.throws(()=>validateLanOptions({...options,bind:'192.0.2.123'}),/bind_not_local|interface_inspection_failed/);
  for(const hostname of ['*.example.com','evil\nDNS.2=wrong','a,b','-bad.example','bad/example','https://host.test','127.1','0.0.0.0',''])assert.throws(()=>validateLanOptions({...options,hostname}),/hostname_invalid/);
  for(const port of [80,-1,65536,NaN])assert.throws(()=>validateLanOptions({...options,port}),/port_invalid/);
});

test('temporary HTTPS broker validates CA/name/auth and emits portable least-disclosure bundles', {timeout:30000},()=>{
  const code=`
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,readdirSync,existsSync,rmSync}from'node:fs';
import{join}from'node:path';import{tmpdir}from'node:os';import https from'node:https';import{X509Certificate}from'node:crypto';
import{startLanBroker}from ${JSON.stringify(new URL('../scripts/lan-broker.mjs',import.meta.url).href)};
const root=mkdtempSync(join(tmpdir(),'broker-https-'));let first,second;
const request=(broker,options={})=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port:broker.port,servername:'host.containers.internal',path:'/v1/clients',signal:AbortSignal.timeout(2000),...options},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);});
try{
 const options={bind:'127.0.0.1',hostname:'host.containers.internal',port:0};
 first=await startLanBroker({...options,directory:join(root,'first')});
 second=await startLanBroker({...options,directory:join(root,'second')});
 assert.notEqual(first.caSha256,second.caSha256);
 const ca=readFileSync(first.publicCaFile);assert.equal(new X509Certificate(ca).ca,true);
 const leaf=new X509Certificate(readFileSync(join(first.directory,'server-private/server.crt')));assert.equal(leaf.ca,false);assert.equal(leaf.checkHost('host.containers.internal'),'host.containers.internal');assert.equal(leaf.checkHost('wrong.invalid'),undefined);assert.ok(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
 assert.equal(existsSync(join(first.directory,'server-private/ca.key')),false);
 assert.equal(statSync(join(first.directory,'server-private/server.key')).mode&0o777,0o600);
 assert.deepEqual(readdirSync(join(first.directory,'connectivity')).sort(),['ca.crt','connection.json']);
 await assert.rejects(request(first),e=>['UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(e.code));
 await assert.rejects(request(first,{ca:readFileSync(second.publicCaFile)}));
 await assert.rejects(request(first,{ca,servername:'wrong.invalid'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
 assert.equal((await request(first,{ca,path:'/healthz'})).status,200);assert.equal((await request(first,{ca,path:'/readyz'})).status,200);
 assert.equal((await request(first,{ca})).status,401);assert.equal((await request(first,{ca,headers:{Authorization:'Bearer '+'x'.repeat(43)}})).status,401);
 for(const c of first.clients){
  assert.deepEqual(readdirSync(c.bundleDirectory).sort(),['ca.crt','connection.json','token']);
  const manifest=JSON.parse(readFileSync(c.connectionFile));assert.equal(manifest.broker_url,first.origin);assert.equal(manifest.token_file,'token');assert.equal(manifest.ca_file,'ca.crt');assert.equal(manifest.insecure_development,false);assert.equal(manifest.file_paths_relative_to,'connection_file_directory');
  assert.ok(Date.parse(manifest.expires_at)>Date.now()+7180000);
  const token=readFileSync(join(c.bundleDirectory,'token'),'utf8');assert.equal(statSync(join(c.bundleDirectory,'token')).mode&0o777,0o600);assert.ok(!JSON.stringify(first).includes(token));
  assert.equal((await request(first,{ca,headers:{Authorization:'Bearer '+token}})).status,200);
 }
 await assert.rejects(startLanBroker({...options,directory:first.directory}),/directory_already_exists/);
 await Promise.all([first.stop(),first.stop()]);await assert.rejects(request(first,{ca}));
 console.log('HTTPS CA, SAN, auth, private bundles and lifecycle passed.');
}finally{await first?.stop();await second?.stop();rmSync(root,{recursive:true,force:true});}
`;
  const child=spawnSync(process.execPath,['--input-type=module'],{input:code,encoding:'utf8',timeout:25000,maxBuffer:1024*1024,...(process.getuid?.()===0?{uid:65534,gid:65534}:{})});
  assert.equal(child.status,0,child.stderr||child.error?.message);assert.match(child.stdout,/HTTPS CA, SAN/);
});
