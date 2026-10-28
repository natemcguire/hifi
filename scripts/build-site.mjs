import {mkdir,rm,cp,copyFile,lstat,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
await rm(root+'dist',{recursive:true,force:true});await mkdir(root+'dist');
for(const file of ['index.html','landing.html','privacy.html','spotify.html','spotify.js','landing.css','landing.js','app.js','styles.css','favicon.svg','stations.json']) await copyFile(root+file,root+'dist/'+file);
// download/ holds the notarized Mac DMG once one is built (ios/scripts/build-dmg.sh).
for(const dir of ['engine','tracks','shots','download'].filter(dir=>dir!=='download'||existsSync(root+dir))) await cp(root+dir,root+'dist/'+dir,{recursive:true,filter:async source=>{if((await lstat(source)).isSymbolicLink())throw Error('Symlink not allowed in public assets');return true;}});
// Every script and stylesheet is linked with a hash of its contents, so the worker
// can let browsers keep them for a year, and the landing page carries its CSS inline.
const dist=root+'dist/';
const hash=async file=>createHash('sha256').update(await readFile(dist+file)).digest('hex').slice(0,10);
const rewrite=async(file,pairs)=>{let text=await readFile(dist+file,'utf8');for(const[from,to]of pairs){if(!text.includes(from))throw Error(`${file} has no ${from}`);text=text.replaceAll(from,to);}await writeFile(dist+file,text);};
const engine=['scheduler.js','storage.js','windowShortcuts.js'];
await rewrite('app.js',await Promise.all(engine.map(async name=>[`'./engine/${name}'`,`'./engine/${name}?v=${await hash('engine/'+name)}'`])));
await rewrite('index.html',[['href="styles.css"',`href="styles.css?v=${await hash('styles.css')}"`],['src="app.js"',`src="app.js?v=${await hash('app.js')}"`]]);
await rewrite('spotify.html',[['src="spotify.js"',`src="spotify.js?v=${await hash('spotify.js')}"`]]);
await rewrite('privacy.html',[['href="/landing.css"',`href="/landing.css?v=${await hash('landing.css')}"`]]);
await rewrite('landing.html',[['<link rel="stylesheet" href="/landing.css">',`<style>${(await readFile(dist+'landing.css','utf8')).trim()}</style>`],['src="/landing.js"',`src="/landing.js?v=${await hash('landing.js')}"`]]);
console.log('Built public HIFI assets; source, scripts and configuration excluded.');
