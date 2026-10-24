// Pure validated release metadata. It creates no tag, release, credential or network request.
import { readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function releasePlan({eventName,action,tag,prerelease=false,draft=false,packageVersion,repository,commit,checkoutCommit}) {
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\/[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(repository??''))throw new Error('Invalid release repository.');
  if(!/^[a-f0-9]{40}$/.test(commit??'')||checkoutCommit!==commit)throw new Error('Checkout does not match the immutable event commit.');
  const valid=versionPattern.exec(packageVersion??'');
  if(!valid||valid[4]?.split('.').some(v=>/^\d+$/.test(v)&&v.length>1&&v[0]==='0'))throw new Error('package.json requires an ordinary SemVer version.');
  const image='ghcr.io/'+repository.toLowerCase();
  if(eventName==='workflow_dispatch')return {publish:false,image,version:packageVersion,latest:false,commit,tags:[]};
  if(eventName!=='release'||action!=='published'||draft!==false||typeof prerelease!=='boolean')throw new Error('Only a published GitHub Release can publish an image.');
  if(tag!=='v'+packageVersion)throw new Error('Release tag must equal v plus package.json version.');
  const latest=!prerelease&&!valid[4];
  return {publish:true,image,version:packageVersion,latest,commit,tags:[`${image}:${packageVersion}`,...(latest?[`${image}:latest`]:[])]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
    const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
    const plan=releasePlan({eventName:process.env.GITHUB_EVENT_NAME,action:event.action,tag:event.release?.tag_name,
      prerelease:event.release?.prerelease,draft:event.release?.draft,packageVersion:pkg.version,
      repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,checkoutCommit:process.env.CHECKOUT_COMMIT});
    if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(plan).filter(([key])=>key!=='tags').map(([key,value])=>`${key}=${value}\n`).join(''));
    console.log(JSON.stringify(plan));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
