// CI-only explicit host-interface TLS test. No host-network container, firewall edits or native harness.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
assert.equal(process.platform,'linux');const uid=process.getuid(),gid=process.getgid();assert.ok(uid>0);
const bind=Object.values(networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal)?.address;
assert.ok(bind,'An already assigned host IPv4 interface is required; do not alter networking to pass.');
const root=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'broker-https-bootstrap-')),guard=join(root,'guard');mkdirSync(guard,{mode:0o700});
for(const name of ['claude','git'])writeFileSync(join(guard,name),'#!/bin/sh\nprintf unexpected > "'+join(root,'unexpected-native')+'"\nexit 91\n',{mode:0o700});
const image=process.argv[2]??'localhost/broker-podman:ci';
assert.match(image,/^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,255}$/);
const child=spawn('/bin/bash',[fileURLToPath(new URL('./start-lan-broker.sh',import.meta.url)),'--image',image,'--bind',bind,'--hostname','host.containers.internal','--port','0'],{
 env:{...process.env,PATH:guard+':/usr/bin:/bin'},stdio:['ignore','pipe','pipe'],detached:true,
});
let output='',errors='',exited=false;
const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>{exited=true;resolve({code,signal});});});
child.stdout.on('data',b=>{output+=b;if(output.length>65536)child.kill('SIGTERM');});child.stderr.on('data',b=>{errors+=b;if(errors.length>65536)child.kill('SIGTERM');});
const timer=setTimeout(()=>{if(!exited)process.kill(-child.pid,'SIGKILL');},240000);
const run=promisify(execFile),containerName='broker-https-probe-'+randomBytes(8).toString('hex');
try {
 const deadline=Date.now()+210000;while(!output.includes('Leave this terminal open.')&&!exited&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
 assert.ok(output.includes('Leave this terminal open.'),'HTTPS shell bootstrap did not reach ready');
 assert.match(output,/^BROKER_URL=https:\/\/host\.containers\.internal:\d+$/m);assert.match(output,/^PUBLIC_CA_FILE=/m);
 const lab=output.match(/^Private HTTPS broker directory: (.+)$/m)?.[1];assert.equal(dirname(lab),realpathSync(process.env.HOME));assert.match(basename(lab),/^broker-lan-test\.[A-Za-z0-9]{8}$/);
 const bundle=output.match(/^CLIENT-A bundle directory: (.+)$/m)?.[1];assert.ok(bundle.startsWith(lab+'/'));
 // Only this disposable container gets this explicit DNS mapping to the already assigned host interface.
 // slirp's host-loopback exception remains OFF; no host networking or published container port is used.
 const {stdout}=await run('podman',['run','--rm','--name',containerName,'--pull=never','--network=slirp4netns','--add-host',`host.containers.internal:${bind}`,
  '--userns=keep-id','--user',`${uid}:${gid}`,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
  '--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--volume',`${bundle}:/run/broker-client:ro`,image,'node','scripts/lan-client-probe.mjs'],{encoding:'utf8',timeout:45000,maxBuffer:65536});
 assert.match(stdout,/Separate container HTTPS probe passed/);console.log(stdout.trim());assert.equal(existsSync(join(root,'unexpected-native')),false);
 child.kill('SIGTERM');assert.equal((await completion).code,0);
 console.log('Host HTTPS broker to separate rootless slirp container passed with explicit per-container DNS mapping; not a universal pasta/LAN certification.');
}finally{
 try{await run('podman',['rm','--force',containerName],{timeout:10000,maxBuffer:65536});}catch{}
 if(!exited){process.kill(-child.pid,'SIGKILL');await completion.catch(()=>{});}clearTimeout(timer);
 const lab=output.match(/^Private HTTPS broker directory: (.+)$/m)?.[1];
 if(lab&&dirname(lab)===realpathSync(process.env.HOME)&&/^broker-lan-test\.[A-Za-z0-9]{8}$/.test(basename(lab))&&existsSync(lab)){
  const info=statSync(lab);assert.equal(info.uid,uid);assert.equal(info.mode&0o777,0o700);assert.equal(realpathSync(lab),lab);rmSync(lab,{recursive:true,force:true});
 }
 rmSync(root,{recursive:true,force:true});
}
