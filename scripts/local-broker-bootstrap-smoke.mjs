// CI-only actual shell/bootstrap smoke; no native CLI, connector clone, real credentials or model calls.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
assert.equal(process.platform,'linux');assert.ok(process.getuid()>0);
const root=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'broker-only-bootstrap-'));
const guard=join(root,'guard');mkdirSync(guard,{mode:0o700});
for(const name of ['claude','git'])writeFileSync(join(guard,name),'#!/bin/sh\nprintf unexpected > "'+join(root,'unexpected-native')+'"\nexit 91\n',{mode:0o700});
const child=spawn('/bin/bash',[fileURLToPath(new URL('./start-local-broker.sh',import.meta.url)),'--image',process.argv[2]??'localhost/broker-podman:ci'],{
  // Preserve HOME/XDG so Podman sees the image built in this same runner.
  env:{...process.env,PATH:guard+':/usr/bin:/bin'},stdio:['ignore','pipe','pipe'],detached:true,
});
let output='',errors='',exited=false;
const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});});
child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGTERM');});
child.stderr.on('data',b=>{errors+=b;if(errors.length>65536)child.kill('SIGTERM');});
const timer=setTimeout(()=>{if(!exited)process.kill(-child.pid,'SIGKILL');},200000);
try {
 const deadline=Date.now()+190000;
 while(!output.includes('Leave this terminal open.')&&!exited&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 assert.ok(output.includes('Leave this terminal open.'),'broker-only bootstrap did not reach ready');
 const origin=output.match(/^BROKER_URL=(\S+)$/m)?.[1];assert.equal(new URL(origin).hostname,'127.0.0.1');
 const tokenFile=output.match(/^CLIENT-A token file: (.+)$/m)?.[1];const lab=output.match(/^Private broker directory: (.+)$/m)?.[1];
 assert.equal(dirname(lab),realpathSync(process.env.HOME));assert.match(basename(lab),/^broker-local\.[A-Za-z0-9]{8}$/);assert.ok(tokenFile.startsWith(lab+'/'));
 const token=readFileSync(tokenFile,'utf8');assert.equal(statSync(tokenFile).mode&0o777,0o600);assert.ok(!output.includes(token));assert.ok(!errors.includes(token));
 assert.equal((await fetch(origin+'/v1/clients',{signal:AbortSignal.timeout(2000)})).status,401);
 const result=await fetch(origin+'/v1/clients',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(2000)});assert.equal(result.status,200);assert.deepEqual((await result.json()).clients,[]);
 assert.equal(existsSync(join(root,'unexpected-native')),false,'broker-only startup must not execute git or Claude');
 child.kill('SIGTERM');assert.equal((await completion).code,0);
 console.log('Actual broker-only shell startup passed: no native command/clone, private connection data, empty registry, authentication and graceful stop.');
}finally{
 if(!exited){process.kill(-child.pid,'SIGKILL');await completion.catch(()=>{});}
 clearTimeout(timer);
 // Remove only this child's printed, freshly owned private lab after it exits.
 const lab=output.match(/^Private broker directory: (.+)$/m)?.[1];
 if(lab && dirname(lab)===realpathSync(process.env.HOME) && /^broker-local\.[A-Za-z0-9]{8}$/.test(basename(lab)) && existsSync(lab)) {
  const info=statSync(lab);assert.equal(info.uid,process.getuid());assert.equal(info.mode&0o777,0o700);assert.equal(realpathSync(lab),lab);
  rmSync(lab,{recursive:true,force:true});
 }
 rmSync(root,{recursive:true,force:true});
}
