// Test-only synthetic host boundaries. Transport, tools and persistence are packaged production code.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
const options=JSON.parse(process.argv[2]);
const {type,packageRoot,installation,runtime,nativeId,approved}=options;
const load=p=>import(pathToFileURL(join(packageRoot,p)));
mkdirSync(runtime,{recursive:true,mode:0o700});
let call,close;
if(type==='pi'){
 const {installExtension}=await load('src/extension.mjs');
 const {createConfigPathStore}=await load('src/config-path.mjs');
 const env={PI_CODING_AGENT_DIR:installation},store=createConfigPathStore(undefined,env);
 if(approved)store.write(approved.connectionFile);
 const events={},commands={},tools={},ctx={hasUI:false,sessionManager:{getSessionId:()=>nativeId}};
 const schema={Object:()=>({}),String:()=>({}),Optional:()=>({}),Integer:()=>({})};
 installExtension({on:(n,f)=>events[n]=f,registerCommand:(n,c)=>commands[n]=c,registerTool:t=>tools[t.name]=t},schema,{env,pathStore:store});
 await events.session_start({},ctx);await commands['psst-mode'].handler('manual',ctx);
 call=async(name,args)=>(await tools[name].execute(randomUUID(),args,new AbortController().signal,undefined,ctx)).details;
 close=()=>events.session_shutdown({},ctx);
}else if(type==='claude-code'){
 process.env.CLAUDE_CONFIG_DIR=installation;process.env.PSST_CLAUDE_CONFIG='';process.env.PSST_CONFIG_FILE='';
 const {pluginHook,nativeStateConfig}=await load('src/plugin-state.mjs');
 const {processIdentity}=await load('src/launch-state.mjs');
 const {saveSelection,installationRoot}=await load('src/installation-selection.mjs');
 if(approved)saveSelection(approved.connectionFile,null,installationRoot());
 const owner=processIdentity(process.pid),config=nativeStateConfig();
 pluginHook(config,{hook_event_name:'SessionStart',session_id:nativeId},owner);
 const child=spawn(process.execPath,[join(packageRoot,'bin/plugin-mcp.mjs')],{stdio:['pipe','pipe','inherit']});
 const ended=once(child,'close');let id=0;const pending=new Map();
 createInterface({input:child.stdout}).on('line',line=>{const r=JSON.parse(line);pending.get(r.id)?.(r);pending.delete(r.id);});
 const rpc=(method,params)=>new Promise(resolve=>{const key=++id;pending.set(key,resolve);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'synthetic-matrix-host',version:'1'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 call=async(name,args)=>{const response=await rpc('tools/call',{name,arguments:args});if(response.error)throw Error('mcp_call_failed');return JSON.parse(response.result.content[0].text);};
 close=async()=>{child.stdin.end();await ended;pluginHook(config,{hook_event_name:'SessionEnd',session_id:nativeId},owner);};
}else if(type==='antigravity-cli'){
 const {openInstallation}=await load('src/installation.mjs');
 if(approved){const store=openInstallation(installation);store.beginPending({brokerUrl:options.brokerUrl,requestId:approved.requestId,previousRevision:null});store.commit({...approved,previousRevision:null});}
 const {serveNativePlugin}=await load('src/native-plugin.mjs'),{processIdentity}=await load('src/native-binding.mjs');
 const host=processIdentity(process.pid),context={host,conversationId:nativeId};
 const server=await serveNativePlugin({base:runtime,installationRoot:installation,host,input:new PassThrough(),output:new PassThrough()});
 call=(name,args)=>server.tools[name](server.binding.issue({context,tool:name,args}));
 await call('broker_setup_status',{});close=()=>server.close();
}else if(type==='opencode'){
 const {selectInstallation,readInstallation}=await load('src/installation.mjs');
 if(approved)await selectInstallation({directory:installation,connectionFile:approved.connectionFile,expectedRevision:null});
 const {createNativePlugin}=await load('src/native-plugin.mjs'),{loadBrokerReference}=await load('src/reference.mjs');
 const {tool}=await import(pathToFileURL(join(packageRoot,'node_modules/@opencode-ai/plugin/dist/index.js')));
 const native={directory:runtime,worktree:runtime,client:{session:{get:async({path})=>({data:{id:path.id,directory:runtime}})}}};
 const hooks=await createNativePlugin({native,tool,reference:await loadBrokerReference(),loadInstallation:()=>readInstallation(installation)});
 const context={sessionID:nativeId,directory:runtime,worktree:runtime,messageID:'matrix',abort:new AbortController().signal};
 call=async(name,args)=>JSON.parse(await hooks.tool[name].execute(args,context));close=()=>hooks.dispose();
}else throw Error('unknown_matrix_type');
process.stdout.write(JSON.stringify({ready:true})+'\n');
for await(const line of createInterface({input:process.stdin})){
 const {id,name,args={}}=JSON.parse(line);
 try{const value=name==='close'?(await close(),{closed:true}):await call(name,args);process.stdout.write(JSON.stringify({id,value})+'\n');if(name==='close')break;}
 catch(error){process.stdout.write(JSON.stringify({id,error:error.code||error.message})+'\n');}
}
