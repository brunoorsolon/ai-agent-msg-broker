// Liveness only. Empty credentials intentionally make readiness unavailable.
import http from 'node:http';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function checkLiveness(config,{timeoutMs=2000}={}) {
  return new Promise(resolveResult=>{
    const host=config.host==='::'?'::1':(config.host==='0.0.0.0'?'127.0.0.1':(config.host??'127.0.0.1'));
    let handle,done=false;
    const finish=okay=>{if(done)return;done=true;clearTimeout(timer);handle?.destroy();resolveResult(okay);};
    const timer=setTimeout(()=>finish(false),timeoutMs);
    try {
      if(config.tls) {
        // Listener-only probe: no TLS request, identity claim or verification bypass.
        // Real client certificate trust/SAN checks remain unchanged and mandatory.
        handle=net.connect({host,port:config.port??8787});
        handle.once('connect',()=>finish(true));
      } else {
        handle=http.get({host,port:config.port??8787,path:'/healthz'},response=>{
          response.resume();response.once('end',()=>finish(response.statusCode===200));
          response.once('error',()=>finish(false));
        });
      }
      handle.once('error',()=>finish(false));
    }catch{finish(false);}
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {process.exitCode=await checkLiveness(JSON.parse(readFileSync(process.env.BROKER_CONFIG_FILE,'utf8')))?0:1;}
  catch{process.exitCode=1;}
}
