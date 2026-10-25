// Disposable test-only authority, TLS and live broker; no production configuration.
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { BrokerStore } from '../src/store.mjs';
import { EnrollmentService } from '../src/enrollment.mjs';
import { CredentialStore } from '../src/auth.mjs';
import { createBrokerServer } from '../src/server.mjs';
const execute=promisify(execFile);

export async function enrollmentTlsFixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'psst-real-pairing-tls-'));
  const certFile=join(directory,'test-ca.pem'),keyFile=join(directory,'test-key.pem');
  const policyFile=join(directory,'enrollment-policy.json'),credentialFile=join(directory,'credentials.json');
  let store,app,sequence=0;
  t.after(async()=>{try{await app?.close();}finally{try{store?.close();}finally{rmSync(directory,{recursive:true,force:true});}}});
  await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{timeout:10000});
  writeFileSync(credentialFile,JSON.stringify({credentials:[]}),{mode:0o600});
  writeFileSync(policyFile,JSON.stringify({format:'psst-enrollment-policy-v1',grants:[],revoked_credentials:[]}),{mode:0o600});
  store=new BrokerStore({path:join(directory,'broker.sqlite')});
  const enrollment=new EnrollmentService({store,policyFile});
  const auth=new CredentialStore({path:credentialFile,additionalCredentials:()=>enrollment.credentials(),onRevoke:ids=>store.revoke(ids),onPolicyChange:entries=>store.applyAuthorizationPolicies(entries)});
  app=createBrokerServer({store,auth,enrollment,host:'127.0.0.1',port:0,tls:{certFile,keyFile},pollIntervalMs:5});
  const address=await app.listen(),brokerUrl=`https://127.0.0.1:${address.port}`;
  const trustedEnvironment={...process.env,NODE_EXTRA_CA_CERTS:certFile};
  delete trustedEnvironment.NODE_TLS_REJECT_UNAUTHORIZED;
  const runNode=(source,args=[],options={})=>execute(process.execPath,['--input-type=module','-e',source,...args],{env:trustedEnvironment,timeout:15000,maxBuffer:65536,...options});
  async function issue(clientType,{scope='shared'}={}) {
    const pairingFile=join(directory,`ticket-${++sequence}.json`);
    // Invoke the actual operator CLI. Only nonsecret file paths and policy enter argv.
    await execute(process.execPath,[fileURLToPath(new URL('../scripts/manage-enrollment.mjs',import.meta.url)),'pair','--policy-file',policyFile,'--output-file',pairingFile,'--broker-url',brokerUrl,'--principal-id','test-operator','--scope',scope,'--client-type',clientType,'--approve'],{timeout:10000,maxBuffer:65536});
    return pairingFile;
  }
  async function connect(pairingFile,clientType,installationDirectory=join(directory,`installation-${++sequence}`)) {
    const helper=new URL('../reference/enrollment.mjs',import.meta.url).href;
    const source=`import {connectPairingFile,readEnrollmentReceipt} from ${JSON.stringify(helper)};const options=JSON.parse(process.argv[1]);const result=await connectPairingFile(options);const receipt=readEnrollmentReceipt({connectionFile:result.connectionFile,clientType:options.clientType});if(receipt.credentialId!==result.credentialId)throw Error('receipt_mismatch');process.stdout.write(JSON.stringify(result));`;
    const {stdout}=await runNode(source,[JSON.stringify({pairingFile,directory:installationDirectory,clientType})]);
    return {...JSON.parse(stdout),installationDirectory};
  }
  return {directory,certFile,policyFile,brokerUrl,store,auth,enrollment,app,issue,connect,runNode};
}
