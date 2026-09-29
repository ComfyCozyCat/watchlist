// The image is decoded and recognized only in this browser. No photo or OCR text is sent to a service.
const asset = name => new URL(`./vendor/ocr/${name}`, import.meta.url).href;
let workerPromise;

async function worker() {
  if (!workerPromise) workerPromise = (async () => {
    const {default: Tesseract} = await import(asset('tesseract.esm.min.js'));
    const {createWorker} = Tesseract;
    const instance = await createWorker('eng', 1, {
      workerPath: asset('worker.min.js'), corePath: asset(''), langPath: asset(''),
      workerBlobURL: false, gzip: true
    });
    await instance.setParameters({tessedit_pageseg_mode: '6'});
    return instance;
  })().catch(error => { workerPromise = null; throw error; });
  return workerPromise;
}

export function parseDVD(text) {
  const normalized = text.toUpperCase().replace(/[|]/g, 'I');
  const track = normalized.match(/TR[KX][\s.:]*([0-9OIL]{1,3})\s*[/I]\s*([0-9OIL]{1,3})/);
  const times = [...normalized.matchAll(/([0-9OIL]{1,3})\s*[:.]\s*([0-9OIL]{1,2})\s*[:.]\s*([0-9OIL]{1,2})/g)];
  const number = value => Number(value.replace(/O/g,'0').replace(/[IL]/g,'1'));
  const plausible = times.map(match => match.slice(1).map(number)).filter(([h,m,s]) => h <= 99 && m < 60 && s < 60);
  const time = plausible.at(-1)?.map(n => String(n).padStart(2,'0')).join(':') || null;
  const value = track && number(track[1]);
  const total = track && number(track[2]);
  return {track: value > 0 && value <= total ? value : null, total: total > 0 ? total : null, time};
}

export async function readDVD(file, crop = null) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo');
  const bitmap = await createImageBitmap(file);
  try {
    const ocr = await worker();
    // The manual selection uses the exact rectangle; automatic scanning tries two top strips.
    const regions = crop ? [crop] : [{x:0,y:.07,width:1,height:.13},{x:0,y:0,width:1,height:.32}];
    for (const [index,region] of regions.entries()) {
      const sourceWidth = bitmap.width * region.width, sourceHeight = bitmap.height * region.height;
      if (sourceWidth < 10 || sourceHeight < 10) throw new Error('Selected area is too small');
      const width = Math.min(2304, Math.max(600, sourceWidth * 2));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width); canvas.height = Math.round(sourceHeight * width / sourceWidth);
      const context = canvas.getContext('2d', {willReadFrequently:true});
      context.drawImage(bitmap, bitmap.width * region.x, bitmap.height * region.y, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0,0,canvas.width,canvas.height);
      for (let i=0; i<pixels.data.length; i+=4) {
        const lum = .2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2];
        const v = lum > 105 ? 255 : 0;
        pixels.data[i] = pixels.data[i+1] = pixels.data[i+2] = v;
      }
      context.putImageData(pixels,0,0);
      const {data} = await ocr.recognize(canvas);
      const result = parseDVD(data.text);
      if (result.track && result.time) return result;
      if (index === regions.length - 1) return result;
    }
  } finally { bitmap.close(); }
}
