import { randomBytes,randomUUID } from 'node:crypto';
import { writeFileSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { EnrollmentService,secretHash } from '../src/enrollment.mjs';
import { CredentialStore } from '../src/auth.mjs';
export function setup(t){
  const f=fixture(t),policyFile=join(f.dir,'enrollment-policy.json'),pairingFile=join(f.dir,'pairing.json');
  const issue=(extra={})=>{
    const secret=randomBytes(32).toString('base64url'),expires_at=new Date(f.now+600000).toISOString();
    let policy;try{policy=JSON.parse(readFileSync(policyFile));}catch{policy={format:'psst-enrollment-policy-v1',grants:[],revoked_credentials:[]};}
    policy.grants.push({grant_id:randomUUID(),secret_sha256:secretHash(secret),principal_id:'owner',client_type:'pi',scopes:['default'],expires_at,credential_expires_at:new Date(f.now+(extra.credentialDays??90)*86400000).toISOString()});
    writeFileSync(policyFile,JSON.stringify(policy),{mode:0o600});
    writeFileSync(extra.outputFile??pairingFile,JSON.stringify({format:'psst-pairing-v1',broker_url:'https://broker.example',pairing_secret:secret,client_type:'pi',expires_at}),{mode:0o600});
  };
  issue(); const pair=JSON.parse(readFileSync(pairingFile));
  let enrollment=new EnrollmentService({store:f.store,policyFile});
  const auth=new CredentialStore({path:join(f.dir,'credentials.json'),clock:()=>f.now,additionalCredentials:()=>enrollment.credentials(),onRevoke:ids=>f.store.revoke(ids),onPolicyChange:entries=>f.store.applyAuthorizationPolicies(entries)});
  const token=randomBytes(32).toString('base64url');
  const request={enrollment_id:randomUUID(),client_type:'pi',token_sha256:secretHash(token)};
  return {f,policyFile,pairingFile,pair,auth,token,request,issue,get enrollment(){return enrollment;},restart(){f.restart();enrollment=new EnrollmentService({store:f.store,policyFile});},redeem(body=request){return enrollment.redeem(`Pairing ${pair.pairing_secret}`,body,auth.entries);}};
}
export function revoke(policyFile,credentialId){const p=JSON.parse(readFileSync(policyFile));p.revoked_credentials.push(credentialId);writeFileSync(policyFile,JSON.stringify(p),{mode:0o600});}
