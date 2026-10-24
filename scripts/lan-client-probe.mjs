// Disposable CI transport probe inside a separate rootless network namespace; not a native agent.
import assert from 'node:assert/strict';
import https from 'node:https';
import { rootCertificates } from 'node:tls';
import { readFileSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrokerClient } from '../reference/client.mjs';
import { Inbox, newSessionIdentity } from '../reference/inbox.mjs';

assert.ok(process.getuid()>0);const bundle='/run/broker-client';
assert.deepEqual(readdirSync(bundle).sort(),['ca.crt','connection.json','token']);
const manifest=JSON.parse(readFileSync(join(bundle,'connection.json')));
assert.equal(manifest.insecure_development,false);assert.equal(manifest.token_file,'token');assert.equal(manifest.ca_file,'ca.crt');
const ca=readFileSync(join(bundle,'ca.crt')),token=readFileSync(join(bundle,'token'),'utf8');assert.equal(statSync(join(bundle,'token')).mode&0o077,0);
const request=(path,options={})=>new Promise((resolve,reject)=>{const req=https.get(new URL(path,manifest.broker_url),{signal:AbortSignal.timeout(4000),...options},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);});
await assert.rejects(request('/healthz'));
await assert.rejects(request('/healthz',{ca:rootCertificates[0]}));
await assert.rejects(request('/healthz',{ca,servername:'wrong.invalid'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
assert.equal((await request('/healthz',{ca})).status,200);assert.equal((await request('/readyz',{ca})).status,200);
assert.equal((await request('/v1/clients',{ca})).status,401);
assert.equal((await request('/v1/clients',{ca,headers:{Authorization:'Bearer '+'x'.repeat(43)}})).status,401);
assert.equal((await request('/v1/clients',{ca,headers:{Authorization:'Bearer '+token}})).status,200);
const directory=mkdtempSync(join(tmpdir(),'broker-tls-probe-'));let inbox;
try {
 inbox=new Inbox({directory:join(directory,'inbox'),identity:newSessionIdentity('claude-code')});
 const client=new BrokerClient({url:manifest.broker_url,caFile:join(bundle,'ca.crt'),tokenFile:join(bundle,'token'),inbox});
 await client.register({name:'container-transport-fixture',model:{provider:null,id:null,source:'unknown'},project:null});
 await client.heartbeat();assert.ok((await client.listClients()).clients.some(c=>c.client_id===inbox.identity.client_id));
 await client.closeSession();
 console.log('Separate container HTTPS probe passed: CA/SAN verification, health, missing/invalid auth rejection, private token, registration and heartbeat.');
}finally{inbox?.close();rmSync(directory,{recursive:true,force:true});}
