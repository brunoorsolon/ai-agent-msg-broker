import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
function files(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(`${path}/${e.name}`):e.name.endsWith('.mjs')?[`${path}/${e.name}`]:[]);}
for(const file of ['src','reference','test','scripts'].flatMap(files)){const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(result.status)process.exit(result.status);}
console.log('All JavaScript syntax checks passed.');
