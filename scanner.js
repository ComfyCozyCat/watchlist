// The image is decoded and recognized only in this browser. No photo or OCR text is sent to a service.
const asset = name => new URL(`./vendor/ocr/${name}`, import.meta.url).href;
let workerPromise;

async function worker() {
  if (!workerPromise) workerPromise = (async () => {
    const {createWorker} = await import(asset('tesseract.esm.min.js'));
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

export async function readDVD(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a photo');
  const bitmap = await createImageBitmap(file);
  try {
    const ocr = await worker();
    // Player status is near the top; the second pass handles looser framing.
    for (const [top,height] of [[.07,.13],[0,.32]]) {
      const width = Math.min(2304, bitmap.width * 2);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = Math.round(bitmap.height * height * width / bitmap.width);
      const context = canvas.getContext('2d', {willReadFrequently:true});
      context.drawImage(bitmap, 0, bitmap.height * top, bitmap.width, bitmap.height * height, 0, 0, canvas.width, canvas.height);
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
      if (top === 0) return result;
    }
  } finally { bitmap.close(); }
}
