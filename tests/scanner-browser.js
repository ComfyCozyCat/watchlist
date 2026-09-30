import {readDVD} from '../scanner.js?v=20260930-accuracy-1';
const button=document.getElementById('run'),output=document.getElementById('result');
button.onclick=async()=>{
 button.disabled=true; output.textContent='Starting…';
 try {
  for(const [name,gray,angle] of [['Clear',230,0],['Dim and tilted',95,3]]) {
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=700;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#151a25';ctx.fillRect(0,0,1200,700);
   ctx.translate(600,230);ctx.rotate(angle*Math.PI/180);ctx.translate(-600,-230);
   ctx.fillStyle='#040609';ctx.fillRect(0,170,1200,100);
   ctx.font='bold 38px monospace';ctx.fillStyle=`rgb(${gray},${gray},${gray})`;
   ctx.fillText('CDROM TRK 11/16',55,235);ctx.fillText('00:03:01',890,235);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   const result=await readDVD(new File([blob],'synthetic.png',{type:'image/png'}),null,{tracks:[11],durations:{11:2400},onProgress:n=>{output.textContent=`${name}: reading attempt ${n}…`;}});
   if(result.track!==11||result.time!=='00:03:01')throw new Error(`${name}: ${JSON.stringify(result)}`);
   output.textContent=`${name}: passed`;
  }
  output.textContent='PASS: Clear photo and dim, tilted photo. Track 11 / 16 at 00:03:01.';
 } catch(error){output.textContent=`FAIL: ${error.message}`;} finally{button.disabled=false;}
};
