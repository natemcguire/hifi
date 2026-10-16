import {mkdir,rm,cp,copyFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await rm(root+'dist',{recursive:true,force:true});await mkdir(root+'dist');
for(const file of ['index.html','landing.html','landing.css','landing.js','app.js','tv.js','styles.css','themes.css','themes.js','favicon.svg','stations.json']) await copyFile(root+file,root+'dist/'+file);
for(const dir of ['engine','tracks']) await cp(root+dir,root+'dist/'+dir,{recursive:true,filter:async source=>{if((await lstat(source)).isSymbolicLink())throw Error('Symlink not allowed in public assets');return true;}});
console.log('Built public HIFI assets; source, scripts and configuration excluded.');
