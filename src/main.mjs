import { readFileSync } from 'node:fs';
import { BrokerStore } from './store.mjs';
import { CredentialStore } from './auth.mjs';
import { createBrokerServer } from './server.mjs';

process.umask(0o077);
const configFile=process.env.BROKER_CONFIG_FILE;
if(!configFile){console.error('Set BROKER_CONFIG_FILE to a private operator configuration file.');process.exit(1);}
let store,app;
try{
  const config=JSON.parse(readFileSync(configFile,'utf8'));
  const allowed=['database','credential_file','host','port','insecure_development','proxy_loopback','tls','limits'];
  if(Object.keys(config).some(k=>!allowed.includes(k)))throw new Error('Unknown broker configuration field.');
  if(typeof config.database!=='string'||typeof config.credential_file!=='string')throw new Error('Database and credential_file are required.');
  store=new BrokerStore({path:config.database,limits:config.limits});
  const auth=new CredentialStore({path:config.credential_file,onRevoke:ids=>store.revoke(ids)});
  app=createBrokerServer({store,auth,host:config.host,port:config.port,insecureDevelopment:config.insecure_development,proxyLoopback:config.proxy_loopback,tls:config.tls});
  await app.listen();console.error('Broker ready. Delivery receipts confirm durable adapter inbox receipt only.');
  let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();store.close();};
  process.on('SIGINT',()=>stop().catch(()=>process.exitCode=1));process.on('SIGTERM',()=>stop().catch(()=>process.exitCode=1));
}catch{console.error('Broker startup failed. Check private configuration, TLS, and local storage.');try{await app?.close();store?.close();}catch{}process.exitCode=1;}
