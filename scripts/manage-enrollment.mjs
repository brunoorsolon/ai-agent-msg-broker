// Operator-only local consent command. No HTTP admin surface; never opens broker DB.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { openSync, closeSync, writeFileSync, fsyncSync, renameSync, unlinkSync, lstatSync, realpathSync, constants } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPrivateJson, validateEnrollmentPolicy, secretHash, ENROLLMENT_LIMIT } from '../src/enrollment.mjs';
import { TYPES } from '../src/protocol.mjs';
const fail = () => { throw new Error('enrollment_operator_configuration_invalid'); };
function privateParent(path) {
  if(typeof path!=='string'||!isAbsolute(path)||realpathSync(dirname(path))!==dirname(resolve(path)))fail();
  const s=lstatSync(dirname(path));
  if(!s.isDirectory()||(s.mode&0o077)||(process.getuid&&s.uid!==process.getuid()))fail();
}
function durableWrite(path, value, exclusive=false) {
  const temp=exclusive?path:`${path}.${randomUUID()}.tmp`;
  const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}
  if(!exclusive)renameSync(temp,path);
  const d=openSync(dirname(path),constants.O_RDONLY);try{fsyncSync(d);}finally{closeSync(d);}
}
export function manageEnrollment({action,policyFile,outputFile,brokerUrl,clientType,principalId,scope,ticketSeconds=600,credentialDays=90,credentialId,approve=false}, {clock=Date.now}={}) {
  if(approve!==true||!['pair','revoke'].includes(action))fail();
  privateParent(policyFile);
  const lockFile=`${policyFile}.owner.sqlite`;
  try{const stat=lstatSync(lockFile);if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)||(process.getuid&&stat.uid!==process.getuid()))fail();}catch(e){if(e.code!=='ENOENT')throw e;}
  const fd=openSync(lockFile,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);closeSync(fd);
  const lock=new DatabaseSync(lockFile);
  try{lock.exec('PRAGMA journal_mode=DELETE; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS owner (id INTEGER);');}catch(e){lock.close();throw e;}
  try{
    let policy;
    try{policy=validateEnrollmentPolicy(readPrivateJson(policyFile));}
    catch(e){if(e.code!=='ENOENT')throw e;policy={format:'psst-enrollment-policy-v1',grants:[],revoked_credentials:[]};}
    const now=clock();
    // Redeemed-grant retry data is retained in broker DB, independent of this pruning.
    policy.grants=policy.grants.filter(g=>Date.parse(g.expires_at)>now);
    if(action==='pair'){
      privateParent(outputFile);
      let url;try{url=new URL(brokerUrl);}catch{fail();}
      if(typeof brokerUrl!=='string'||/[\u0000-\u0020\u007f]/u.test(brokerUrl)||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)fail();
      if(!TYPES.includes(clientType)||typeof principalId!=='string'||!/^[-a-zA-Z0-9_.]{1,128}$/.test(principalId)||typeof scope!=='string'||!/^[-a-zA-Z0-9_.]{1,128}$/.test(scope)
        || !Number.isSafeInteger(ticketSeconds)||ticketSeconds<60||ticketSeconds>3600||!Number.isSafeInteger(credentialDays)||credentialDays<1||credentialDays>365||policy.grants.length>=ENROLLMENT_LIMIT)fail();
      const secret=randomBytes(32).toString('base64url'),expires_at=new Date(now+ticketSeconds*1000).toISOString();
      const grant={grant_id:randomUUID(),secret_sha256:secretHash(secret),principal_id:principalId,client_type:clientType,scopes:[scope],expires_at,credential_expires_at:new Date(now+credentialDays*86400000).toISOString()};
      policy.grants.push(grant);
      // A crash after output but before policy commit leaves an unusable ticket, never extra authorization.
      durableWrite(outputFile,{format:'psst-pairing-v1',broker_url:url.origin,pairing_secret:secret,client_type:clientType,expires_at},true);
      durableWrite(policyFile,validateEnrollmentPolicy(policy));
      return {action:'pair',grantId:grant.grant_id,expiresAt:expires_at};
    }
    if(typeof credentialId!=='string'||!/^enrolled-[0-9a-f-]{36}$/.test(credentialId))fail();
    if(!policy.revoked_credentials.includes(credentialId))policy.revoked_credentials.push(credentialId);
    durableWrite(policyFile,validateEnrollmentPolicy(policy));
    return {action:'revoke',credentialId};
  }finally{lock.close();}
}
export function argumentsFor(argv){
  const options={action:argv[0]};
  const names={'--policy-file':'policyFile','--output-file':'outputFile','--broker-url':'brokerUrl','--client-type':'clientType','--principal-id':'principalId','--scope':'scope','--ticket-seconds':'ticketSeconds','--credential-days':'credentialDays','--credential-id':'credentialId'};
  for(let i=1;i<argv.length;i++){
    if(argv[i]==='--approve'){if(options.approve)fail();options.approve=true;continue;}
    const name=names[argv[i]],value=argv[++i];
    if(!name||value===undefined||value.startsWith('--')||options[name]!==undefined)fail();
    options[name]=['ticketSeconds','credentialDays'].includes(name)?Number(value):value;
  }
  return options;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.umask(0o077);
  try{const result=manageEnrollment(argumentsFor(process.argv.slice(2)));console.log(result.action==='pair'?'Pairing ticket saved privately. No secret was printed.':'Credential revocation saved. Active requests will be denied on the next authorization check.');}
  catch{console.error('Enrollment command failed. Inspect private files; do not overwrite a pending ticket or alter an active owner database.');process.exitCode=1;}
}
