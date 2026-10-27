import {mkdir,rm,cp,copyFile,lstat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const root=fileURLToPath(new URL('../',import.meta.url));
await rm(root+'dist',{recursive:true,force:true});await mkdir(root+'dist');
for(const file of ['index.html','landing.html','privacy.html','spotify.html','spotify.js','landing.css','landing.js','app.js','styles.css','favicon.svg','stations.json']) await copyFile(root+file,root+'dist/'+file);
// download/ holds the notarized Mac DMG once one is built (ios/scripts/build-dmg.sh).
for(const dir of ['engine','tracks','shots','download'].filter(dir=>dir!=='download'||existsSync(root+dir))) await cp(root+dir,root+'dist/'+dir,{recursive:true,filter:async source=>{if((await lstat(source)).isSymbolicLink())throw Error('Symlink not allowed in public assets');return true;}});
console.log('Built public HIFI assets; source, scripts and configuration excluded.');
