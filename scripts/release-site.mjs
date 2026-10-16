import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,CI:'true'};delete env.CLOUDFLARE_API_KEY;delete env.CLOUDFLARE_EMAIL;
const run=(cmd,args,pipe=false)=>execFileSync(cmd,args,{cwd:root,env,stdio:pipe?'pipe':'inherit',encoding:'utf8'});
const git=(...args)=>run('git',args,true).trim();
if(git('status','--porcelain'))throw Error('Commit all HIFI source before releasing.');
const commit=git('rev-parse','HEAD');
for(const file of ['app.js','tv.js','worker.js','landing.js','themes.js'])run(process.execPath,['--check',file]);
run(process.execPath,['scripts/build-site.mjs']);
const fingerprint=()=>createHash('sha256').update(readdirSync(root+'dist',{recursive:true}).filter(p=>!p.endsWith('/')).sort().map(p=>{try{return p+':'+createHash('sha256').update(readFileSync(root+'dist/'+p)).digest('hex')}catch(e){if(e.code==='EISDIR')return '';throw e}}).join('\n')).digest('hex');
const digest=fingerprint();
run('npx',['--no-install','wrangler','deploy','--dry-run']);
if(git('rev-parse','HEAD')!==commit || git('status','--porcelain') || fingerprint()!==digest)throw Error('Source or assets changed during release.');
run('npx',['--no-install','wrangler','deploy']);
// Never retry the deployment mutation. Public readback can be rerun separately.
for(const [path,file] of [['/','landing.html'],['/player','index.html'],['/app.js','app.js'],['/tv.js','tv.js'],['/styles.css','styles.css']]){
 const response=await fetch('https://hifi.nates-software.com'+path,{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok || !Buffer.from(await response.arrayBuffer()).equals(readFileSync(root+'dist/'+file)))throw Error('Published asset check failed: '+path);
}
console.log(JSON.stringify({released:true,commit,assetDigest:digest,url:'https://hifi.nates-software.com'}));
