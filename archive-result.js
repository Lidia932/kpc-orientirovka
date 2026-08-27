export const ARCHIVE_RESULTS={
  'НЖ':{short:'НЖ',label:'Найден жив',stamp:'НЖ — НАЙДЕН ЖИВ',className:'found-alive',color:'#197443'},
  'НП':{short:'НП',label:'Найден погибшим',stamp:'НП — НАЙДЕН ПОГИБШИМ',className:'found-deceased',color:'#34393d'}
};

export function archiveResultForItem(item){
  if(ARCHIVE_RESULTS[item?.closureResult])return item.closureResult;
  const match=String(item?.archiveFileName||'').match(/^[^—]+—\s*(НЖ|НП)\s*—/u);
  return match?.[1]||'';
}

export function archiveResultLabel(result){return ARCHIVE_RESULTS[result]?.label||''}

export function archiveFileNameWithResult(item,result){
  const safe=String(item?.title||'Ориентировка').replace(/[\\/:*?"<>|]/g,' ').replace(/\s+/g,' ').trim();
  return `${item.type} — ${result} — ${safe}.pdf`;
}

function loadPoster(bytes){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'})),image=new Image();
    image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};
    image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('poster-result-load'))};
    image.src=url;
  });
}

function roundedRect(ctx,x,y,width,height,radius){
  const right=x+width,bottom=y+height;
  ctx.beginPath();ctx.moveTo(x+radius,y);ctx.lineTo(right-radius,y);ctx.quadraticCurveTo(right,y,right,y+radius);ctx.lineTo(right,bottom-radius);ctx.quadraticCurveTo(right,bottom,right-radius,bottom);ctx.lineTo(x+radius,bottom);ctx.quadraticCurveTo(x,bottom,x,bottom-radius);ctx.lineTo(x,y+radius);ctx.quadraticCurveTo(x,y,x+radius,y);ctx.closePath();
}

function fitCenteredText(ctx,text,centerX,y,maxWidth,startSize,minSize){
  let size=startSize;ctx.font=`900 ${size}px Arial, sans-serif`;
  while(ctx.measureText(text).width>maxWidth&&size>minSize){size-=2;ctx.font=`900 ${size}px Arial, sans-serif`}
  ctx.textAlign='center';ctx.fillText(text,centerX,y);ctx.textAlign='start';
}

export async function createArchivePosterWithResult(posterBytes,result){
  const config=ARCHIVE_RESULTS[result];if(!config)throw new Error('archive-result');
  const image=await loadPoster(posterBytes),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  canvas.width=1024;canvas.height=1536;ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const x=42,y=58,width=940,height=262,radius=16;
  ctx.save();ctx.shadowColor='#00000038';ctx.shadowBlur=18;ctx.shadowOffsetY=5;roundedRect(ctx,x,y,width,height,radius);ctx.fillStyle='#fffffff5';ctx.fill();ctx.shadowColor='transparent';ctx.lineWidth=12;ctx.strokeStyle=config.color;ctx.stroke();
  ctx.fillStyle=config.color;ctx.font='800 29px Arial, sans-serif';ctx.textAlign='center';ctx.fillText('ПОИСК ЗАВЕРШЁН',canvas.width/2,y+69);fitCenteredText(ctx,config.stamp,canvas.width/2,y+178,width-72,70,42);ctx.restore();
  return canvas.toDataURL('image/jpeg',.94);
}
