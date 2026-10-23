// Host-side driver for the CI runner's existing rootless Podman. No sudo,
// package installation, host-security changes, port publishing or real credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';

assert.equal(process.platform,'linux');
const uid=process.getuid(),gid=process.getgid();assert.ok(uid>0,'Run as the unprivileged CI user.');
const image=process.argv[2]??'localhost/broker-podman:ci';
assert.match(image,/^[a-zA-Z0-9][a-zA-Z0-9./:_@-]{0,255}$/);
const podman=(args,options={})=>execFileSync('podman',args,{encoding:'utf8',timeout:30000,maxBuffer:1024*1024,...options});
console.log(podman(['--version']).trim());
assert.equal(podman(['info','--format','{{.Host.Security.Rootless}}']).trim(),'true','The existing runner must support rootless Podman; do not relax host security.');
const directory=mkdtempSync(join(process.env.RUNNER_TEMP??tmpdir(),'broker-podman-'));
const data=join(directory,'data'),privateDirectory=join(directory,'private');
mkdirSync(data,{mode:0o700});mkdirSync(privateDirectory,{mode:0o700});
const token=randomBytes(32).toString('base64url');
writeFileSync(join(privateDirectory,'token'),token,{mode:0o600});
writeFileSync(join(privateDirectory,'credentials.json'),JSON.stringify({credentials:[{credential_id:'disposable-rootless',principal_id:'fixture',adapter_id:'fixture',client_types:['pi'],scopes:['fixture'],token_sha256:createHash('sha256').update(token).digest('hex')}]}),{mode:0o600});
writeFileSync(join(privateDirectory,'config.json'),JSON.stringify({database:'/data/broker.sqlite',credential_file:'/run/broker/credentials.json',host:'127.0.0.1',port:8787,insecure_development:true,limits:{min_free_bytes:1048576}}),{mode:0o600});
const name=`broker-rootless-${randomBytes(6).toString('hex')}`;
const start=()=>podman(['run','--detach','--name',name,'--network=none','--userns=keep-id','--user',`${uid}:${gid}`,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--volume',`${data}:/data:rw`,'--volume',`${privateDirectory}:/run/broker:ro`,image]);
const probe=phase=>console.log(podman(['exec',name,'node','scripts/podman-probe.mjs',phase,String(uid)],{timeout:20000}).trim());
try{
 start();probe('before-restart');
 podman(['kill','--signal','KILL',name]);podman(['wait',name]);podman(['rm',name]);
 start();probe('after-restart');
 podman(['stop','--time','5',name]);
 assert.equal(podman(['inspect','--format','{{.State.ExitCode}}',name]).trim(),'0');
 for(const file of['broker.sqlite','broker.sqlite.owner','fixture-state.json']){
  const stat=statSync(join(data,file));assert.equal(stat.uid,uid);assert.equal(stat.mode&0o077,0);
 }
 console.log('Rootless Podman private bind-volume, keep-id, read-only root/config, dropped capabilities, restart persistence and graceful-stop smoke passed.');
}finally{
 try{podman(['rm','--force',name],{stdio:'ignore'});}catch{}
 rmSync(directory,{recursive:true,force:true});
}
