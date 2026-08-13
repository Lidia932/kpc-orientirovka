const IDS=['lastName','firstMiddleName','age','date','place','height','build','hair','eyes','special','jacket','pants','shoes','carrying','actual'];
const $=id=>document.getElementById(id);
const canvas=$('poster'),ctx=canvas.getContext('2d');
let bg=new Image(),photoImg=null,deferredPrompt=null;
bg.src='template.jpg';
bg.onload=render;

function val(id){return $(id).value.trim()}
function save(){const d={};IDS.forEach(id=>d[id]=$(id).value);localStorage.setItem('kpc-draft',JSON.stringify(d))}
function load(){try{const d=JSON.parse(localStorage.getItem('kpc-draft')||'{}');IDS.forEach(id=>{if(d[id]!=null)$(id).value=d[id]})}catch{} if(!val('actual')) $('actual').value=new Date().toISOString().slice(0,10)}
function formatDate(s){if(!s)return'';const p=s.split('-');return p.length===3?`${p[2]}.${p[1]}.${p[0]}`:s}

function fitText(text,x,y,maxW,start=52,min=22,weight=700,color='#111'){
  if(!text)return;
  ctx.save();
  ctx.fillStyle=color;
  let size=start;
  ctx.font=`${weight} ${size}px "Arial Narrow", Arial, sans-serif`;
  while(ctx.measureText(text).width>maxW&&size>min){size-=1;ctx.font=`${weight} ${size}px "Arial Narrow", Arial, sans-serif`}
  ctx.fillText(text,x,y);
  ctx.restore();
}

function wrap(text,x,y,maxW,lineH,font='24px "Arial Narrow", Arial, sans-serif',maxLines=3,color='#111',weight=''){
  if(!text)return;
  ctx.save();
  ctx.fillStyle=color;
  ctx.font=weight?`${weight} ${font}`:font;
  const words=(text||'').split(/\s+/).filter(Boolean);
  let line='',lines=[];
  for(const w of words){
    const t=line?line+' '+w:w;
    if(ctx.measureText(t).width>maxW&&line){lines.push(line);line=w}else line=t;
  }
  if(line)lines.push(line);
  lines.slice(0,maxLines).forEach((l,i)=>ctx.fillText(l,x,y+i*lineH));
  ctx.restore();
}

function valueOnly(value,x,y,maxW,fontSize=19,maxLines=2){
  if(!value)return;
  wrap(value,x,y,maxW,24,`${fontSize}px "Arial Narrow", Arial, sans-serif`,maxLines,'#111');
}

function drawContainedPhoto(img,x,y,w,h,r=16){
  ctx.save();
  roundRect(x,y,w,h,r);
  ctx.clip();
  const scale=Math.min(w/img.width,h/img.height);
  const dw=img.width*scale,dh=img.height*scale;
  const dx=x+(w-dw)/2,dy=y+(h-dh)/2;
  ctx.drawImage(img,dx,dy,dw,dh);
  ctx.restore();
}

function render(){
  if(!bg.complete)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bg,0,0,canvas.width,canvas.height);

  if(photoImg){
    drawContainedPhoto(photoImg,42,278,445,558,18);
  }

  fitText(val('lastName').toUpperCase(),525,435,420,55,30,800,'#080808');
  fitText(val('firstMiddleName'),525,500,420,35,22,700,'#080808');
  fitText(val('age'),525,578,390,28,20,700,'#111');
  fitText(formatDate(val('date')),790,696,170,22,17,700,'#c00000');
  wrap(val('place'),582,778,365,31,'24px "Arial Narrow", Arial, sans-serif',3,'#111',700);

  valueOnly(val('height'),122,955,300,19,1);
  valueOnly(val('build'),170,995,260,19,1);
  valueOnly(val('hair'),146,1034,290,19,2);
  valueOnly(val('eyes'),124,1072,310,19,1);
  valueOnly(val('special'),190,1110,245,19,2);

  valueOnly(val('jacket'),608,955,340,19,1);
  valueOnly(val('pants'),596,995,350,19,1);
  valueOnly(val('shoes'),596,1034,350,19,1);
  valueOnly(val('carrying'),612,1072,335,19,2);

  fitText(formatDate(val('actual')),530,1521,155,16,13,500,'#fff');
}

function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

IDS.forEach(id=>$(id).addEventListener('input',()=>{save();render()}));
$('previewBtn').onclick=render;
$('clearBtn').onclick=()=>{
  if(confirm('Очистить все введённые данные?')){
    IDS.forEach(id=>$(id).value='');
    localStorage.removeItem('kpc-draft');
    photoImg=null;
    $('photoThumb').hidden=true;
    $('actual').value=new Date().toISOString().slice(0,10);
    render();
  }
};

$('photo').onchange=e=>{
  const f=e.target.files[0];
  if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    photoImg=new Image();
    photoImg.onload=()=>{
      render();
      $('photoThumb').src=ev.target.result;
      $('photoThumb').hidden=false;
    };
    photoImg.src=ev.target.result;
  };
  r.readAsDataURL(f);
};

$('pdfBtn').onclick=()=>{
  render();
  const jpg=canvas.toDataURL('image/jpeg',.96);
  const win=window.open('','_blank');
  if(!win){$('message').textContent='Браузер заблокировал окно печати. Разрешите всплывающие окна.';return}
  win.document.write(`<html><head><title>Ориентировка</title><style>@page{size:A4 portrait;margin:0}html,body{margin:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff}img{width:198mm;height:auto;max-height:297mm;display:block}</style></head><body><img src="${jpg}" onload="setTimeout(()=>window.print(),300)"></body></html>`);
  win.document.close();
  $('message').textContent='В окне печати выберите «Сохранить как PDF».';
};

function net(){const on=navigator.onLine;$('netStatus').textContent=on?'Онлайн':'Офлайн — приложение работает';$('netStatus').className='badge '+(on?'online':'offline')}
window.addEventListener('online',net);
window.addEventListener('offline',net);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;$('installBtn').hidden=false});
$('installBtn').onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('installBtn').hidden=true}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'));
load();net();
