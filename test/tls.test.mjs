import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, chmodSync, symlinkSync } from 'node:fs';
import https from 'node:https';
import { createBrokerServer } from '../src/server.mjs';
import { CredentialStore } from '../src/auth.mjs';
import { fixture } from './helpers.mjs';

// Disposable self-signed material exists only in this test's temporary directory.
// No installed CA, real credential, or persistent access is provisioned.
test('direct TLS requires a trusted certificate and matching hostname',async t=>{
 const f=fixture(t),key=`${f.dir}/key.pem`,cert=`${f.dir}/cert.pem`;
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});chmodSync(key,0o600);
 const app=createBrokerServer({store:f.store,auth:f.auth,host:'127.0.0.1',port:0,tls:{certFile:cert,keyFile:key}});const address=await app.listen();t.after(()=>app.close());
 const request=options=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port:address.port,path:'/v1/clients',headers:{Authorization:`Bearer ${f.a.token}`},...options},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);});
 await assert.rejects(request({servername:'localhost'}),e=>['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN'].includes(e.code));
 await assert.rejects(request({ca:readFileSync(cert),servername:'wrong.invalid'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
 const good=await request({ca:readFileSync(cert),servername:'localhost'});assert.equal(good.status,200);assert.deepEqual(good.body.clients,[]);
});

test('credential files fail closed for broad mode and symlinks',t=>{
 const f=fixture(t),file=`${f.dir}/credentials.json`;
 chmodSync(file,0o644);assert.throws(()=>new CredentialStore({path:file}),/private/);chmodSync(file,0o600);
 const link=`${f.dir}/linked.json`;symlinkSync(file,link);assert.throws(()=>new CredentialStore({path:link}));
});
