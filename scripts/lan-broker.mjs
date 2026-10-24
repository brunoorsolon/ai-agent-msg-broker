// Explicit operator-run HTTPS broker for separate network namespaces. No native client management.
import { randomBytes, createHash, X509Certificate, generateKeyPairSync } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { BrokerStore } from '../src/store.mjs';
import { CredentialStore } from '../src/auth.mjs';
import { createBrokerServer } from '../src/server.mjs';
import { TYPES } from '../src/protocol.mjs';

const DURATION_MS=2*60*60*1000;
const fail=code=>{throw new Error(code);};
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
export function validateLanOptions({bind,hostname,port=8787,allowAllInterfaces=false}) {
  if(typeof bind!=='string'||isIP(bind)!==4)fail('bind_invalid');
  if(bind==='0.0.0.0') { if(allowAllInterfaces!==true)fail('wildcard_ack_required'); }
  else if(bind!=='127.0.0.1') {
    let interfaces;try{interfaces=networkInterfaces();}catch{fail('interface_inspection_failed');}
    if(!Object.values(interfaces).flat().some(i=>i?.family==='IPv4'&&i.address===bind))fail('bind_not_local');
  }
  if(typeof hostname!=='string'||hostname.length>253||hostname==='0.0.0.0'||!(isIP(hostname)===4||(/[a-zA-Z]/.test(hostname)&&hostname.split('.').every(label=>/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)))))fail('hostname_invalid');
  if(!Number.isInteger(port)||(port!==0&&(port<1024||port>65535)))fail('port_invalid');
  return {bind,hostname:hostname.toLowerCase(),port,allowAllInterfaces};
}
function certificates(directory,hostname) {
  const caKey=join(directory,'ca.key'),caFile=join(directory,'ca.crt'),keyFile=join(directory,'server.key'),certFile=join(directory,'server.crt');
  const csr=join(directory,'server.csr'),extensions=join(directory,'server.ext');
  const openssl=args=>{try{return execFileSync('openssl',args,{stdio:['ignore','pipe','pipe'],timeout:20000,maxBuffer:65536});}catch{fail('certificate_generation_failed');}};
  for(const path of [caKey,keyFile]) {
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
    writeFileSync(path,privateKey,{mode:0o600,flag:'wx'});
  }
  openssl(['req','-x509','-key',caKey,'-sha256','-out',caFile,'-days','1','-subj','/CN=Disposable broker test CA',
    '-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign']);
  chmodSync(caKey,0o600);chmodSync(caFile,0o600);
  openssl(['req','-new','-key',keyFile,'-sha256','-out',csr,'-subj','/CN=Disposable broker test server']);chmodSync(keyFile,0o600);
  writeFileSync(extensions,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName='+(isIP(hostname)===4?'IP:':'DNS:')+hostname+'\n',{mode:0o600,flag:'wx'});
  openssl(['x509','-req','-in',csr,'-CA',caFile,'-CAkey',caKey,'-set_serial','0x'+randomBytes(16).toString('hex'),'-out',certFile,'-days','1','-sha256','-extfile',extensions]);chmodSync(certFile,0o600);
  openssl(['verify','-CAfile',caFile,certFile]);
  const leaf=new X509Certificate(readFileSync(certFile));
  if(!(isIP(hostname)===4?leaf.checkIP(hostname):leaf.checkHost(hostname)))fail('certificate_generation_failed');
  // No ongoing signing authority is kept. Restart with new material rather than renewing this lab.
  for(const path of [caKey,csr,extensions])rmSync(path);
  return {caFile,certFile,keyFile,caSha256:createHash('sha256').update(readFileSync(caFile)).digest('hex')};
}

export async function startLanBroker({directory,...options}) {
  const {bind,hostname,port}=validateLanOptions(options);
  if(process.platform!=='linux'||!process.getuid?.()||process.versions.node!=='24.19.0')fail('runtime_required');
  const sqlite=new DatabaseSync(':memory:');try{if(sqlite.prepare('SELECT sqlite_version() AS v').get().v!=='3.53.3')fail('runtime_required');}finally{sqlite.close();}
  if(typeof directory!=='string'||!isAbsolute(directory)||directory.length>4096||/[\u0000-\u001f\u007f-\u009f]/u.test(directory))fail('private_directory_required');
  directory=resolve(directory);const parent=dirname(directory),info=lstatSync(parent);
  if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(parent)!==parent||info.uid!==process.getuid()||(info.mode&0o077))fail('private_directory_required');
  try{lstatSync(directory);fail('directory_already_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  mkdirSync(directory,{mode:0o700});let store,app,timer,stopping;
  const expiresAt=new Date(Date.now()+DURATION_MS).toISOString();
  try {
    const pki=join(directory,'server-private');mkdirSync(pki,{mode:0o700});
    const tls=certificates(pki,hostname),credentials=[],clients=[];
    const publicDirectory=join(directory,'connectivity');mkdirSync(publicDirectory,{mode:0o700});
    const publicCaFile=join(publicDirectory,'ca.crt');writeFileSync(publicCaFile,readFileSync(tls.caFile),{mode:0o600,flag:'wx'});
    for(const suffix of ['a','b']) {
      const label=`client-${suffix}`,bundleDirectory=join(directory,label);mkdirSync(bundleDirectory,{mode:0o700});
      const token=randomBytes(32).toString('base64url');
      writeFileSync(join(bundleDirectory,'token'),token,{mode:0o600,flag:'wx'});
      writeFileSync(join(bundleDirectory,'ca.crt'),readFileSync(tls.caFile),{mode:0o600,flag:'wx'});
      credentials.push({credential_id:label,principal_id:label,adapter_id:label,client_types:[...TYPES],scopes:['lan-test'],expires_at:expiresAt,token_sha256:createHash('sha256').update(token).digest('hex')});
      clients.push({label,bundleDirectory,connectionFile:join(bundleDirectory,'connection.json')});
    }
    const verifierFile=join(pki,'credentials.json');json(verifierFile,{credentials});
    store=new BrokerStore({path:join(directory,'broker','broker.sqlite')});
    const auth=new CredentialStore({path:verifierFile,onRevoke:ids=>store.revoke(ids),onPolicyChange:entries=>store.applyAuthorizationPolicies(entries)});
    app=createBrokerServer({store,auth,host:bind,port,tls:{certFile:tls.certFile,keyFile:tls.keyFile}});
    const address=await app.listen(),origin=`https://${hostname}:${address.port}`;
    json(join(publicDirectory,'connection.json'),{format:'broker-connectivity-v1',broker_url:origin,ca_file:'ca.crt',file_paths_relative_to:'connection_file_directory',ca_sha256:tls.caSha256,no_credentials:true});
    for(const client of clients)json(client.connectionFile,{
      format:'broker-client-bundle-v1',protocol_version:'1',broker_url:origin,
      token_file:'token',ca_file:'ca.crt',file_paths_relative_to:'connection_file_directory',
      authorization_header:'Authorization',authorization_scheme:'Bearer',insecure_development:false,
      expires_at:expiresAt,allowed_client_types:[...TYPES],scope:'lan-test',ca_sha256:tls.caSha256,
    });
    json(join(directory,'LAN-BROKER.json'),{format:1,purpose:'disposable-https-broker',bind,origin,expiresAt,pid:process.pid,caSha256:tls.caSha256});
    const stop=()=>stopping??=(async()=>{clearTimeout(timer);try{await app.close();}finally{store.close();}})();
    timer=setTimeout(()=>{void stop().catch(()=>{process.exitCode=1;});},DURATION_MS);timer.unref();
    return {directory,bind,origin,port:address.port,expiresAt,caSha256:tls.caSha256,publicCaFile,clients,stop};
  }catch(error){clearTimeout(timer);try{await app?.close();}finally{try{store?.close();}finally{rmSync(directory,{recursive:true,force:true});}}throw error;}
}

function argumentsOf(argv) {
  const options={};const names={'--directory':'directory','--bind':'bind','--hostname':'hostname','--port':'port'};
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==='--allow-all-interfaces'){if(options.allowAllInterfaces)fail('arguments_invalid');options.allowAllInterfaces=true;continue;}
    const name=names[argv[i]],value=argv[++i];if(!name||!value||options[name]!==undefined)fail('arguments_invalid');options[name]=name==='port'?Number(value):value;
  }
  if(!options.directory||!options.bind||!options.hostname)fail('arguments_invalid');return options;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log('Preparing broker-only HTTPS. No client session, global CA trust, firewall or container network is changed.');
  try {
    process.umask(0o077);const options=argumentsOf(process.argv.slice(2));validateLanOptions(options);
    console.log(`Requested host bind: ${options.bind}; certificate/client hostname: ${options.hostname}.`);
    if(options.bind==='0.0.0.0')console.log('EXPOSURE: explicit all-interface listener; reachable LAN interfaces may accept TLS connections. Authentication remains required.');
    console.log('Generating disposable private TLS material and two separate client bundles (bounded OpenSSL operations).');
    const broker=await startLanBroker(options);
    console.log(`BROKER_URL=${broker.origin}`);console.log(`PUBLIC_CA_FILE=${broker.publicCaFile}`);console.log(`CA_SHA256=${broker.caSha256}`);
    console.log('Connectivity-first: share only connectivity/ca.crt; /healthz and /readyz need no token. /v1/clients without a token must return 401.');
    for(const client of broker.clients)console.log(`${client.label.toUpperCase()} bundle directory: ${client.bundleDirectory}`);
    console.log(`Credentials and broker expire at ${broker.expiresAt}; no secret value is printed.`);
    console.log('Each bundle contains only connection.json, token and ca.crt. Resolve relative paths inside that client container.');
    console.log('Never share server-private or the other client bundle. Use per-client CA trust; never disable TLS verification.');
    console.log('Connection data is not an installed-plugin API or automatic session attachment. Hostname routing must already work.');
    console.log('Leave this terminal open. Ctrl+C stops only this HTTPS broker; private files remain for explicit cleanup.');
    const stop=()=>{void broker.stop().then(()=>console.log('HTTPS broker stopped.')).catch(()=>{console.error('HTTPS broker shutdown failed.');process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }catch(error){
    const messages={bind_invalid:'--bind must be an explicit IPv4 host address.',interface_inspection_failed:'Host interface inspection is unavailable; no address was guessed.',bind_not_local:'The selected bind is not assigned to this host. Do not bind a container virtual gateway address.',wildcard_ack_required:'0.0.0.0 requires --allow-all-interfaces and exposes all reachable host interfaces.',hostname_invalid:'Choose the exact DNS hostname or IPv4 address clients will use; no wildcard or configuration syntax.',port_invalid:'Choose port 1024-65535, or 0 for an OS-selected port.',runtime_required:'Use nonroot Linux with isolated Node 24.19.0 / SQLite 3.53.3.',private_directory_required:'Use a new directory under your own canonical private parent.',directory_already_exists:'Existing state was not adopted or overwritten.',certificate_generation_failed:'Bounded OpenSSL certificate generation/verification failed.',arguments_invalid:'Supply --directory, --bind and --hostname; optional --port and explicit wildcard acknowledgment.'};
    console.error(`HTTPS broker startup failed: ${messages[error.message]??'Private storage or TLS listener initialization failed; existing state was not overwritten.'}`);process.exitCode=1;
  }
}
