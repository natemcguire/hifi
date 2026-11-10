// Finds the two things the room shader needs in each photo (rooms/<id>.jpg) and writes
// rooms/calibration.json: the CRT screen (the chroma-green area: bounding box and four corners)
// and the record label (an ellipse grown from labelSeed in rooms.json). Needs ffmpeg.
// Run after gen_rooms.py: node mockups/youtube-live/calibrate.mjs
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('./',import.meta.url));
const spec=JSON.parse(readFileSync(dir+'rooms.json','utf8'));
const out={};
for(const room of spec.rooms){
  const file=`${dir}rooms/${room.id}.jpg`;
  const probe=execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0',file]).toString().trim().split(',').map(Number);
  const [W,H]=probe;
  const px=execFileSync('ffmpeg',['-v','error','-i',file,'-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:64<<20});
  const at=(x,y)=>{const i=(y*W+x)*3;return [px[i],px[i+1],px[i+2]];};
  // Screen: the largest connected chroma-green region.
  const green=new Uint8Array(W*H);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const [r,g,b]=at(x,y);if(g>110&&g-Math.max(r,b)>55)green[y*W+x]=1;}
  const seen=new Uint8Array(W*H);let best=[];
  for(let i=0;i<W*H;i++){
    if(!green[i]||seen[i])continue;
    const comp=[],stack=[i];seen[i]=1;
    while(stack.length){const j=stack.pop();comp.push(j);const x=j%W,y=(j/W)|0;
      for(const k of [x>0&&j-1,x<W-1&&j+1,y>0&&j-W,y<H-1&&j+W])if(k!==false&&green[k]&&!seen[k]){seen[k]=1;stack.push(k);}}
    if(comp.length>best.length)best=comp;
  }
  if(best.length<W*H*.02) throw Error(`${room.id}: no green screen found`);
  let x0=W,y0=H,x1=0,y1=0;
  for(const j of best){const x=j%W,y=(j/W)|0;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  // Corners: the green pixel nearest each bounding-box corner (the glass has rounded corners, so
  // these sit a little inside; the shader maps the clip past them and keys the edge).
  const corner=(cx,cy)=>{let d=1e9,p;for(const j of best){const x=j%W,y=(j/W)|0,e=(x-cx)**2+(y-cy)**2;if(e<d){d=e;p=[x,y];}}return p;};
  const corners=[corner(x0,y0),corner(x1,y0),corner(x1,y1),corner(x0,y1)];
  // Label: grow from the seed over pixels close to the seed's colour, then fit an ellipse by moments.
  const [sx,sy]=room.labelSeed;
  const avg=[0,0,0];let n=0;
  for(let y=sy-3;y<=sy+3;y++)for(let x=sx-3;x<=sx+3;x++){const c=at(x,y);avg[0]+=c[0];avg[1]+=c[1];avg[2]+=c[2];n++;}
  avg.forEach((v,i)=>avg[i]=v/n);
  const lum=c=>c[0]*.3+c[1]*.59+c[2]*.11;
  const chroma=c=>{const m=Math.max(...c),l=Math.min(...c);return m-l;};
  const near=c=>{const k=lum(avg)/Math.max(lum(c),1);return Math.hypot(c[0]*k-avg[0],c[1]*k-avg[1],c[2]*k-avg[2])<45&&lum(c)>lum(avg)*.35&&chroma(c)>chroma(avg)*.4;};
  const lab=new Uint8Array(W*H),stack=[sy*W+sx];lab[sy*W+sx]=1;const pts=[];
  while(stack.length){const j=stack.pop();pts.push(j);const x=j%W,y=(j/W)|0;
    if(Math.abs(x-sx)>120||Math.abs(y-sy)>80)continue;
    for(const k of [j-1,j+1,j-W,j+W])if(!lab[k]&&near(at(k%W,(k/W)|0))){lab[k]=1;stack.push(k);}}
  let mx=0,my=0;for(const j of pts){mx+=j%W;my+=(j/W)|0;}mx/=pts.length;my/=pts.length;
  let cxx=0,cyy=0,cxy=0;for(const j of pts){const dx=j%W-mx,dy=((j/W)|0)-my;cxx+=dx*dx;cyy+=dy*dy;cxy+=dx*dy;}
  cxx/=pts.length;cyy/=pts.length;cxy/=pts.length;
  const tr=cxx+cyy,det=cxx*cyy-cxy*cxy,l1=tr/2+Math.sqrt(tr*tr/4-det),l2=tr/2-Math.sqrt(tr*tr/4-det);
  const angle=.5*Math.atan2(2*cxy,cxx-cyy);
  // A filled ellipse has variance a²/4 along each axis; the spindle hole and the sheen make it a bit small.
  const label={cx:+mx.toFixed(1),cy:+my.toFixed(1),a:+(2*Math.sqrt(l1)*1.04).toFixed(1),b:+(2*Math.sqrt(l2)*1.04).toFixed(1),angle:+angle.toFixed(4),color:avg.map(Math.round)};
  out[room.id]={width:W,height:H,screen:{box:[x0,y0,x1,y1],corners},label};
  console.log(room.id,JSON.stringify(out[room.id]),`label px ${pts.length}`);
}
writeFileSync(dir+'rooms/calibration.json',JSON.stringify(out,null,1)+'\n');
