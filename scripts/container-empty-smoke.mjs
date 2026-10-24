// Runs in the runtime image against its shipped deny-all config, with disposable /data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
assert.ok(process.getuid()>0);
assert.deepEqual(JSON.parse(readFileSync('/run/broker/credentials.json')), {credentials:[]});
const child=spawn(process.execPath,['src/main.mjs'],{stdio:['ignore','ignore','pipe'],env:{...process.env,BROKER_CONFIG_FILE:'/run/broker/config.json'}});
let stderr='';child.stderr.on('data',b=>{stderr+=b;if(stderr.length>8192)child.kill('SIGTERM');});
const request=path=>fetch('http://127.0.0.1:8787'+path,{signal:AbortSignal.timeout(1000)});
try {
 const until=Date.now()+5000;let ready=false;
 while(Date.now()<until) {
  assert.equal(child.exitCode,null);try{if((await request('/healthz')).status===200){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,25));
 }
 assert.ok(ready);assert.equal((await request('/readyz')).status,503);
 for(const path of ['/v1/clients','/v1/sessions','/v1/unknown'])assert.equal((await request(path)).status,401);
 assert.match(stderr,/no active credentials/);
 console.log('Default runtime deny-all bootstrap passed: no credentials generated; health200, readiness503, API401.');
}finally{
 if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),3000);await end;clearTimeout(timer);}
}
