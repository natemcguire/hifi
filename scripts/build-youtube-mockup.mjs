// Builds the HIFI Live (YouTube 24/7 streams) design mockup into dist-youtube-mockup/.
// It is a preview only: it is not part of the production site (scripts/build-site.mjs).
// Station names, colors, genres, taglines, tracks and TV clips come from stations.json;
// mockups/youtube-live/lineup.json adds the stream titles, moods and the Christmas setlist.
import {mkdir,rm,cp,copyFile,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const src=root+'mockups/youtube-live/',out=root+'dist-youtube-mockup/';
await rm(out,{recursive:true,force:true});await mkdir(out+'tv',{recursive:true});
for(const file of ['index.html','room.html','mockup.css','scene.js']) await copyFile(src+file,out+file);
await cp(src+'posters',out+'posters',{recursive:true});
await copyFile(root+'favicon.svg',out+'favicon.svg');
const catalog=JSON.parse(await readFile(root+'stations.json','utf8'));
const lineup=JSON.parse(await readFile(src+'lineup.json','utf8'));
const streams=[];
for(const stream of lineup.streams){
  const station=catalog.stations.find(s=>s.id===stream.id);
  if(!station) throw Error(`lineup.json names ${stream.id}, which is not in stations.json`);
  if(!station.tv?.length) throw Error(`${stream.id} has no TV clips`);
  for(const clip of station.tv) await copyFile(root+clip,out+clip);
  const tracks=(stream.tracks||station.tracks||[]).map(({title,artist,year})=>({title,artist,...(year?{year}:{})}));
  if(!tracks.length) throw Error(`${stream.id} has no tracks for the lower third`);
  streams.push({
    id:stream.id,name:station.name,frequency:station.frequency,color:station.color,
    genre:stream.genre||station.genre,tagline:stream.tagline||station.tagline,
    title:stream.title,mood:stream.mood,sky:stream.sky,christmas:!!stream.christmas,
    needsCatalog:!!stream.needsCatalog,watching:stream.watching,
    tv:station.tv,thumb:station.tv[stream.thumbClip-1],poster:`posters/${stream.id}-${stream.thumbClip}.jpg`,tracks,
  });
}
await writeFile(out+'data.js',`window.HIFI_LIVE=${JSON.stringify({streams})};\n`);
console.log(`Built the HIFI Live mockup (${streams.length} streams) in dist-youtube-mockup/.`);
