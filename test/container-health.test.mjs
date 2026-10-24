import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { checkLiveness } from '../scripts/container-health.mjs';
import { createBrokerServer } from '../src/server.mjs';
import { fixture } from './helpers.mjs';

test('shipped HTTP health uses liveness200 rather than readiness503 and bounds stalled/refused probes',async t=>{
 const server=http.createServer((req,res)=>{res.writeHead(req.url==='/healthz'?200:503);res.end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 assert.equal(await checkLiveness({host:'0.0.0.0',port:server.address().port}),true);
 const stalled=http.createServer(()=>{});await new Promise(r=>stalled.listen(0,'127.0.0.1',r));
 t.after(()=>{stalled.closeAllConnections();stalled.close();});
 assert.equal(await checkLiveness({host:'127.0.0.1',port:stalled.address().port},{timeoutMs:30}),false);
 const reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;
 await new Promise(r=>reservation.close(r));assert.equal(await checkLiveness({host:'127.0.0.1',port}),false);
});

test('direct-TLS health probes listener only when DNS certificate SAN differs from bind IP',async t=>{
 const f=fixture(t),key=`${f.dir}/key.pem`,cert=`${f.dir}/cert.pem`;
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=broker.example.test','-addext','subjectAltName=DNS:broker.example.test'],{stdio:'ignore'});chmodSync(key,0o600);
 const tls={certFile:cert,keyFile:key},app=createBrokerServer({store:f.store,auth:f.auth,host:'127.0.0.1',port:0,tls});
 const address=await app.listen();t.after(()=>app.close());
 assert.equal(await checkLiveness({host:'127.0.0.1',port:address.port,tls}),true);
 // A liveness result is deliberately NOT certificate verification or API readiness.
 f.writeCreds([]);assert.equal(await checkLiveness({host:'127.0.0.1',port:address.port,tls}),true);
});
