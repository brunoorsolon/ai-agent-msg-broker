import { readFileSync } from 'node:fs';
import { BrokerStore } from './store.mjs';
import { EnrollmentService } from './enrollment.mjs';
import { CredentialStore } from './auth.mjs';
import { createBrokerServer } from './server.mjs';

process.umask(0o077);
const configFile=process.env.BROKER_CONFIG_FILE;
if(!configFile){console.error('Set BROKER_CONFIG_FILE to a private operator configuration file.');process.exit(1);}
let store,app;
try{
  const config=JSON.parse(readFileSync(configFile,'utf8'));
  const allowed=['database','credential_file','host','port','insecure_development','proxy_loopback','proxy_transport','tls','limits','enrollment_policy_file'];
  if(Object.keys(config).some(k=>!allowed.includes(k)))throw new Error('Unknown broker configuration field.');
  if(typeof config.database!=='string'||typeof config.credential_file!=='string')throw new Error('Database and credential_file are required.');
  store=new BrokerStore({path:config.database,limits:config.limits});
  const enrollment=config.enrollment_policy_file===undefined?undefined:new EnrollmentService({store,policyFile:config.enrollment_policy_file});
  const auth=new CredentialStore({path:config.credential_file,additionalCredentials:()=>enrollment?.credentials()??[],onRevoke:ids=>store.revoke(ids),onPolicyChange:entries=>store.applyAuthorizationPolicies(entries)});
  app=createBrokerServer({store,auth,enrollment,host:config.host,port:config.port,insecureDevelopment:config.insecure_development,proxyLoopback:config.proxy_loopback,proxyTransport:config.proxy_transport,tls:config.tls,maxPolls:store.limits.max_polls,requestRate:store.limits.request_per_minute});
  if(config.proxy_transport)console.error('Explicit proxy transport: HTTP backend requires an isolated trusted proxy path; clients must use verified HTTPS.');
  await app.listen();console.error(auth.ready
    ? 'Broker ready. Delivery receipts confirm durable adapter inbox receipt only.'
    : enrollment ? 'Broker listening with no active client credentials. Only approved pairing grants can enroll; readiness is unavailable until a credential is active.'
    : 'Broker listening with no active credentials. Health is available; all API requests are denied and readiness is unavailable.');
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();store.close();};
  process.on('SIGINT',()=>stop().catch(()=>process.exitCode=1));process.on('SIGTERM',()=>stop().catch(()=>process.exitCode=1));
}catch{console.error('Broker startup failed. Check private configuration, TLS, and local storage.');try{await app?.close();store?.close();}catch{}process.exitCode=1;}
