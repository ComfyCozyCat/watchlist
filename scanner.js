// Photos, processed images, and recognized text stay in this browser.
const asset = name => new URL(`./vendor/ocr/${name}`, import.meta.url).href;
let workerPromise;
async function worker() {
  if (!workerPromise) workerPromise = (async () => {
    const {default: Tesseract} = await import(asset('tesseract.esm.min.js'));
    return Tesseract.createWorker('eng', 1, {workerPath: asset('worker.min.js'), corePath: asset(''), langPath: asset(''), workerBlobURL: false, gzip: true});
  })().catch(error => { workerPromise = null; throw error; });
  return workerPromise;
}
const digit = '[0-9OIL|SBZ]';
const numeric = count => `${digit}(?:[ \\t]*${digit}){0,${count - 1}}`;
const timePattern = `(?<!${digit})(${numeric(2)})[ \\t]*[:;.][ \\t]*(${numeric(2)})[ \\t]*[:;.][ \\t]*(${numeric(2)})(?!${digit})`;
const number = value => Number(value.replace(/\s/g, '').replace(/O/g,'0').replace(/[IL|]/g,'1').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2'));
export function parseDVD(text, field = 'both') {
  const normalized = text.toUpperCase();
  const times = [...normalized.matchAll(new RegExp(timePattern, 'g'))];
  // Only a dedicated time crop may recover separators missing between six digits.
  if (!times.length && field === 'time') {
    const compact = normalized.replace(/\s/g,'');
    if (new RegExp(`^${digit}{6}$`).test(compact)) times.push([compact,compact.slice(0,2),compact.slice(2,4),compact.slice(4,6)]);
  }
  const plausible = times.map(match => match.slice(1).map(number)).filter(([h,m,s]) => h <= 99 && m < 60 && s < 60);
  const time = plausible.at(-1)?.map(n => String(n).padStart(2,'0')).join(':') || null;
  const withoutTime = normalized.replace(new RegExp(timePattern, 'g'), ' ');
  let track;
  for (const token of [`${digit}{1,3}`, numeric(3)]) {
    const match = withoutTime.match(new RegExp(`T[ \\t]*R[ \\t]*[KX][ \\t.:]*(${token})[ \\t]*[/\\\\][ \\t]*(${token})`))
      || (field === 'track' && withoutTime.match(new RegExp(`(${token})[ \\t]*[/\\\\][ \\t]*(${token})`)));
    if (match && number(match[1]) > 0 && number(match[1]) <= number(match[2])) { track = match; break; }
  }
  const value = track && number(track[1]), total = track && number(track[2]);
  return {track: value > 0 && value <= total ? value : null, total: total > 0 ? total : null, time};
}
function percentile(histogram, count, fraction) {
  const target = count * fraction; let sum = 0;
  for (let i=0; i<256; i++) { sum += histogram[i]; if (sum >= target) return i; }
  return 255;
}
function luminance(r,g,b) { return Math.round(.35*r + .55*g + .1*b); }
// Locate pale lettering, wherever the photographed screen falls in the image.
export function findStatusBands({data,width,height}) {
  const gray = new Uint8Array(width*height), histogram = new Uint32Array(256);
  for (let i=0; i<gray.length; i++) { gray[i] = luminance(data[i*4],data[i*4+1],data[i*4+2]); histogram[gray[i]]++; }
  const threshold = Math.max(45, percentile(histogram,gray.length,.94));
  const edge = Math.max(9, (percentile(histogram,gray.length,.98)-percentile(histogram,gray.length,.1))*.07);
  const rows = new Uint32Array(height), left = new Int32Array(height).fill(width), right = new Int32Array(height);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const i=y*width+x, r=data[i*4],g=data[i*4+1],b=data[i*4+2];
    if (gray[i] < threshold || Math.min(r,g,b) < Math.max(r,g,b)*.28) continue;
    const localDark = Math.min(gray[y*width+Math.max(0,x-5)],gray[y*width+Math.min(width-1,x+5)],gray[Math.max(0,y-5)*width+x],gray[Math.min(height-1,y+5)*width+x]);
    if (gray[i]-localDark < edge) continue;
    rows[y]++; left[y]=Math.min(left[y],x); right[y]=Math.max(right[y],x);
  }
  const groups=[]; let start=-1,last=-1;
  const gap=Math.max(3,Math.round(height*.004));
  for(let y=0;y<=height;y++) {
    if(y<height && rows[y]>=Math.max(8,width*.045)) { if(start<0) start=y; last=y; }
    if(start>=0 && (y===height || y-last>gap)) {
      let x1=width,x2=0,count=0;
      for(let row=start;row<=last;row++) {x1=Math.min(x1,left[row]);x2=Math.max(x2,right[row]);count+=rows[row];}
      const h=last-start+1,span=x2-x1;
      if(span>width*.4 && h>=4 && h<height*.13 && start<height*.85) {
        const pad=Math.max(8,h*.55);
        groups.push({x:0,y:Math.max(0,start-pad)/height,width:1,height:(Math.min(height,last+pad+1)-Math.max(0,start-pad))/height,
          score:span/width + Math.min(1,count/(width*h)) - start/height*.45});
      }
      start=-1;
    }
  }
  return groups.sort((a,b)=>b.score-a.score).slice(0,3).map(({score,...region})=>region);
}
export function deskewAngle({data,width,height}) {
  const points=[],hist=new Uint32Array(256);
  for(let i=0;i<data.length;i+=4) hist[luminance(data[i],data[i+1],data[i+2])]++;
  const threshold=Math.max(50,percentile(hist,width*height,.92));
  for(let y=0;y<height;y+=2) for(let x=0;x<width;x+=2) {
    const i=(y*width+x)*4;
    if(luminance(data[i],data[i+1],data[i+2])>=threshold && Math.min(data[i],data[i+1],data[i+2])>=Math.max(data[i],data[i+1],data[i+2])*.28) points.push([x,y]);
  }
  if(points.length<30) return 0;
  let best=0,bestScore=0,zeroScore=0;
  for(let angle=-6;angle<=6;angle+=.5) {
    const slope=Math.tan(angle*Math.PI/180),padding=Math.ceil(width*.12),rows=new Uint32Array(height+padding*2);
    for(const [x,y] of points) {const row=Math.round(y-slope*(x-width/2))+padding;if(row>=0&&row<rows.length) rows[row]++;}
    const score=rows.reduce((sum,n)=>sum+n*n,0);
    if(angle===0) zeroScore=score;
    if(score>bestScore) {bestScore=score;best=angle;}
  }
  return bestScore>zeroScore*1.025 ? -best : 0;
}
// Preserve shades first; local thresholding handles glare and uneven lighting on retry.
export function preprocessPixels(image, mode = 'contrast') {
  const {data,width,height}=image,gray=new Uint8Array(width*height),hist=new Uint32Array(256);
  for(let i=0;i<gray.length;i++){gray[i]=luminance(data[i*4],data[i*4+1],data[i*4+2]);hist[gray[i]]++;}
  const low=percentile(hist,gray.length,.1),high=Math.max(low+20,percentile(hist,gray.length,.98));
  let integral;
  if(mode==='adaptive') {
    integral=new Float64Array((width+1)*(height+1));
    for(let y=1;y<=height;y++){let sum=0;for(let x=1;x<=width;x++){sum+=gray[(y-1)*width+x-1];integral[y*(width+1)+x]=integral[(y-1)*(width+1)+x]+sum;}}
  }
  const radius=Math.max(12,Math.round(width/65));
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const i=y*width+x; let value;
    if(integral) {
      const x1=Math.max(0,x-radius),x2=Math.min(width,x+radius+1),y1=Math.max(0,y-radius),y2=Math.min(height,y+radius+1),stride=width+1;
      const mean=(integral[y2*stride+x2]-integral[y1*stride+x2]-integral[y2*stride+x1]+integral[y1*stride+x1])/((x2-x1)*(y2-y1));
      value=gray[i]>mean+Math.max(6,(high-low)*.045) ? 0 : 255;
    } else value=255-Math.max(0,Math.min(255,(gray[i]-low)*255/(high-low)));
    data[i*4]=data[i*4+1]=data[i*4+2]=Math.round(value); data[i*4+3]=255;
  }
  return image;
}
// Vote separately for fields; unreadable later attempts never erase an earlier reading.
export function combineReadings(readings, options = {}) {
  let duration;
  function choose(field) {
    const groups=new Map();
    for(const reading of readings) {
      const value=reading[field]; if(value==null) continue;
      if(field==='track' && options.tracks?.length && !options.tracks.includes(value)) continue;
      if(field==='time' && Number.isFinite(duration) && duration>0 && value.split(':').reduce((sum,part)=>sum*60+Number(part),0)>duration+2) continue;
      const group=groups.get(value)||{value,count:0,confidence:0,readings:[]};
      group.count++;group.confidence+=reading[`${field}Confidence`]??reading.confidence??0;group.readings.push(reading);groups.set(value,group);
    }
    const sorted=[...groups.values()].sort((a,b)=>b.count-a.count || b.confidence-a.confidence);
    const best=sorted[0];
    if(!best || (best.count===1 && best.confidence<35) || (sorted[1] && best.count<=sorted[1].count)) return null;
    return best;
  }
  const track=choose('track'); duration=track && options.durations?.[track.value];
  const time=choose('time');
  const seconds=time && time.value.split(':').reduce((value,part)=>value*60+Number(part),0);
  const validTime=time && !(Number.isFinite(duration) && duration>0 && seconds>duration+2);
  return {track:track?.value||null,total:track?.readings.find(r=>r.total)?.total||null,time:validTime?time.value:null,
    confirmed:Boolean(track?.count>=2 && validTime && time.count>=2)};
}
export function readOCR(data, field = 'both') {
  const lines=(data.lines?.length ? data.lines : data.text.split('\n').map(text=>({text,confidence:data.confidence})))
    .map(line=>({...line,parsed:parseDVD(line.text,field)}));
  const trackLines=lines.filter(line=>line.parsed.track).sort((a,b)=>b.confidence-a.confidence);
  const anchor=trackLines[0];
  const times=lines.filter(line=>line.parsed.time && (!anchor?.bbox || !line.bbox || Math.abs((line.bbox.y0+line.bbox.y1-anchor.bbox.y0-anchor.bbox.y1)/2)<Math.max(line.bbox.y1-line.bbox.y0,anchor.bbox.y1-anchor.bbox.y0)*2));
  const time=times.sort((a,b)=>(a===anchor?-1:b===anchor?1:b.confidence-a.confidence))[0];
  return {track:anchor?.parsed.track||null,total:anchor?.parsed.total||null,time:time?.parsed.time||null,
    trackConfidence:anchor?.confidence||0,timeConfidence:time?.confidence||0};
}
function canvasRegion(bitmap, region) {
  const sw=bitmap.width*region.width,sh=bitmap.height*region.height;
  if(sw<10||sh<10) throw new Error('Selected area is too small');
  const scale=Math.min(2,2200/sw,2000/sh),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(sw*scale));canvas.height=Math.max(1,Math.round(sh*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,bitmap.width*region.x,bitmap.height*region.y,sw,sh,0,0,canvas.width,canvas.height);
  return canvas;
}
function preparedCanvas(base, mode) {
  const raw=base.getContext('2d').getImageData(0,0,base.width,base.height);
  const angle=base.width/base.height>2 ? deskewAngle(raw) : 0;
  const radians=angle*Math.PI/180,canvas=document.createElement('canvas');
  canvas.width=base.width+24;canvas.height=Math.ceil(base.height+Math.abs(Math.sin(radians))*base.width)+24;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(radians);ctx.drawImage(base,-base.width/2,-base.height/2);
  ctx.resetTransform();ctx.putImageData(preprocessPixels(ctx.getImageData(0,0,canvas.width,canvas.height),mode),0,0);
  return canvas;
}
export async function readDVD(file, crop = null, options = {}) {
  if(!file.type.startsWith('image/')) throw new Error('Choose a photo');
  const bitmap=await createImageBitmap(file),readings=[];
  try {
    const ocr=await worker(); let attempts=0;
    const thumbnail=canvasRegion(bitmap,crop || {x:0,y:0,width:1,height:1});
    const found=crop ? [crop] : findStatusBands(thumbnail.getContext('2d').getImageData(0,0,thumbnail.width,thumbnail.height));
    const regions=found.slice(0,2);
    if(!regions.length) regions.push(crop || {x:0,y:.04,width:1,height:.26});
    async function attempt(region,mode,field='both',sparse=false) {
      if(options.cancelled?.()) throw new Error('Scan cancelled');
      options.onProgress?.(++attempts);
      const image=preparedCanvas(canvasRegion(bitmap,region),mode);
      await ocr.setParameters({tessedit_pageseg_mode: sparse ? '11' : field!=='both' && image.width/image.height>3 ? '7' : '6',
        tessedit_char_whitelist: field==='time' ? '0123456789OIL|SBZ:;. ' : '0123456789CDROMTRKXOI|LSBZ/:;. ', preserve_interword_spaces:'1'});
      const {data}=await ocr.recognize(image);
      readings.push(readOCR(data,field));
      return combineReadings(readings,options);
    }
    for(const region of regions) for(const mode of ['contrast','adaptive']) {
      const result=await attempt(region,mode);
      if(result.confirmed) return result;
    }
    // Separate number groups so player icons cannot confuse the time or track.
    for(const region of regions.slice(0,1)) for(const field of ['track','time']) {
      const split=field==='track' ? {x:region.x,y:region.y,width:region.width*.65,height:region.height}
        : {x:region.x+region.width*.6,y:region.y,width:region.width*.4,height:region.height};
      for(const mode of ['contrast','adaptive']) {
        const result=await attempt(split,mode,field);
        if(result.confirmed) return result;
      }
    }
    const broad=crop || {x:0,y:0,width:1,height:.8};
    for(const mode of ['contrast','adaptive']) {
      const result=await attempt(broad,mode,'both',true);
      if(result.confirmed) return result;
    }
    return combineReadings(readings,options);
  } finally { bitmap.close(); }
}
