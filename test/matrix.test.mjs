import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inbox, newSessionIdentity } from '../reference/inbox.mjs';
import { BrokerClient } from '../reference/client.mjs';
import { AdapterRuntime } from '../reference/runtime.mjs';
import { TYPES } from '../src/protocol.mjs';
import { httpFixture } from './helpers.mjs';

// This matrix tests wire/type-neutral routing into real durable reference inboxes.
// It deliberately does not execute or certify any native CLI final-hop mechanism.
test('all 16 simulated family routes reach exact distinct-session durable inboxes over HTTP',async t=>{
 const f=await httpFixture(t,{limits:{send_burst:100}}),sessions=[];
 const metadata={name:'same-name',model:{provider:null,id:null,source:'unknown'},project:null};
 for(const type of TYPES){for(let index=0;index<2;index++){
  const identity=newSessionIdentity(type),directory=join(f.dir,`${type}-${index}`),inbox=new Inbox({directory,identity,now:()=>f.now});t.after(()=>inbox.close());
  const tokenFile=join(directory,'token');writeFileSync(tokenFile,f.a.token,{mode:0o600});
  const client=new BrokerClient({url:f.base,tokenFile,insecureDevelopment:true,inbox,now:()=>f.now});await client.register(metadata);
  const runtime=new AdapterRuntime({client,verifySession:()=>true,isAlive:()=>true});sessions.push({type,index,identity,inbox,client,runtime});
 }}
 assert.equal((await sessions[0].client.listClients()).clients.length,8);
 const messages=[];
 for(const sourceType of TYPES){for(const recipientType of TYPES){
  const sender=sessions.find(s=>s.type===sourceType&&s.index===0),recipient=sessions.find(s=>s.type===recipientType&&s.index===1);
  const key=sender.client.prepareSend({recipient_id:recipient.identity.client_id,content:{type:'text/plain',text:`${sourceType} to ${recipientType}`}});
  const sent=await sender.client.sendPrepared(key);messages.push({sender,recipient,sent});assert.notEqual(sender.identity.client_id,recipient.identity.client_id);
 }}
 for(const recipient of sessions.filter(s=>s.index===1)){
  for(let i=0;i<4;i++)assert.equal((await recipient.runtime.receiveOnce({waitSeconds:0})).stored,true);
  assert.equal(await recipient.runtime.receiveOnce({waitSeconds:0}),null);
  assert.equal(recipient.inbox.head().state,'pending'); // no model input or native receipt invented
 }
 for(const {sender,sent}of messages)assert.equal((await sender.client.messageStatus(sent.message_id)).delivery_state,'delivered');
 for(const sender of sessions.filter(s=>s.index===0))assert.equal(sender.inbox.head(),null);
 assert.equal(messages.length,16);
});
