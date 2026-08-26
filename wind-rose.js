const DIRECTIONS=['С','ССВ','СВ','ВСВ','В','ВЮВ','ЮВ','ЮЮВ','Ю','ЮЮЗ','ЮЗ','ЗЮЗ','З','ЗСЗ','СЗ','ССЗ'];
const SPEED_COLORS=['#9bd4df','#386fd8','#42a75b','#e1c832','#e95454'];
const RP5_DIRECTIONS=new Map([
  ['ветер, дующий с севера',0],['ветер, дующий с северо-северо-востока',22.5],['ветер, дующий с северо-востока',45],['ветер, дующий с востоко-северо-востока',67.5],
  ['ветер, дующий с востока',90],['ветер, дующий с востоко-юго-востока',112.5],['ветер, дующий с юго-востока',135],['ветер, дующий с юго-юго-востока',157.5],
  ['ветер, дующий с юга',180],['ветер, дующий с юго-юго-запада',202.5],['ветер, дующий с юго-запада',225],['ветер, дующий с западо-юго-запада',247.5],
  ['ветер, дующий с запада',270],['ветер, дующий с западо-северо-запада',292.5],['ветер, дующий с северо-запада',315],['ветер, дующий с северо-северо-запада',337.5]
]);

const $=id=>document.getElementById(id);
const state={map:null,marker:null,stationMarker:null,stationLine:null,mapTarget:'search',windLayers:null,place:'Выбранная точка',rows:[],meta:null,summary:null,rp5:null};

function pad(value){return String(value).padStart(2,'0')}
function localInputValue(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`}
function dateOnly(value){return value.slice(0,10)}
function formatPeriod(value){return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
function round(value,digits=1){const factor=10**digits;return Math.round(value*factor)/factor}
function finite(value){const number=Number(String(value??'').replace(',','.'));return Number.isFinite(number)?number:null}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function directionIndex(degrees){return Math.round((((degrees%360)+360)%360)/22.5)%16}
function directionName(degrees){return DIRECTIONS[directionIndex(degrees)]}
function speedClass(speed){return speed<2?0:speed<4?1:speed<6?2:speed<8?3:4}
function scentDegrees(degrees){return (degrees+180)%360}

function setMessage(text,kind=''){
  const node=$('windMessage');
  node.textContent=text;
  node.className=`wind-message${kind?` ${kind}`:''}`;
}

function setDefaultPeriod(hours=24){
  const end=new Date();end.setMinutes(0,0,0);
  const start=new Date(end.getTime()-hours*3600000);
  $('windStart').value=localInputValue(start);
  $('windEnd').value=localInputValue(end);
}

function compassControl(){
  const Control=L.Control.extend({
    options:{position:'topright'},
    onAdd(){
      const shell=L.DomUtil.create('div','wind-compass-control is-collapsed');
      shell.innerHTML=`<button type="button" aria-expanded="false" aria-label="Открыть компас" title="Компас"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-2 5-5 2 2-5 5-2Z"/></svg></button><div class="wind-compass-panel"><strong>С</strong><span class="east">В</span><span class="south">Ю</span><span class="west">З</span><i></i><small>Север карты</small></div>`;
      const button=shell.querySelector('button');
      button.addEventListener('click',()=>{
        const collapsed=shell.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded',String(!collapsed));
        button.setAttribute('aria-label',collapsed?'Открыть компас':'Скрыть компас');
      });
      L.DomEvent.disableClickPropagation(shell);
      return shell;
    }
  });
  return new Control();
}

function initMap(){
  if(state.map||!window.L)return;
  state.map=L.map('windMap',{zoomControl:true}).setView([54.3142,48.4031],10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(state.map);
  compassControl().addTo(state.map);
  state.windLayers=L.layerGroup().addTo(state.map);
  state.map.on('click',event=>{if(state.mapTarget==='station')setStationLocation(event.latlng.lat,event.latlng.lng);else setLocation(event.latlng.lat,event.latlng.lng,'Точка на карте')});
  setLocation(54.3142,48.4031,'Ульяновск');
}

function setLocation(latitude,longitude,label=state.place,zoom=true){
  if(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude)))return;
  const lat=Number(latitude),lon=Number(longitude);
  $('windLatitude').value=lat.toFixed(6);$('windLongitude').value=lon.toFixed(6);state.place=label||'Выбранная точка';
  if(state.map){
    if(!state.marker)state.marker=L.marker([lat,lon],{draggable:true}).addTo(state.map).on('dragend',event=>{const point=event.target.getLatLng();setLocation(point.lat,point.lng,'Точка на карте',false)});
    else state.marker.setLatLng([lat,lon]);
    if(zoom)state.map.setView([lat,lon],Math.max(state.map.getZoom(),11));
  }
  updateStationDistance();
}

function stationIcon(){return L.divIcon({className:'wind-station-marker',html:'<span><b>М</b></span>',iconSize:[30,30],iconAnchor:[15,30]})}
function setStationLocation(latitude,longitude){
  if(latitude==null||longitude==null)return;const lat=Number(latitude),lon=Number(longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
  $('windStationLatitude').value=lat.toFixed(6);$('windStationLongitude').value=lon.toFixed(6);
  if(state.map){if(!state.stationMarker)state.stationMarker=L.marker([lat,lon],{draggable:true,icon:stationIcon()}).addTo(state.map).bindTooltip('Метеостанция').on('dragend',event=>{const point=event.target.getLatLng();setStationLocation(point.lat,point.lng)});else state.stationMarker.setLatLng([lat,lon])}
  state.mapTarget='search';$('windPickStationBtn').classList.remove('active');$('windPickStationBtn').querySelector('span').textContent='Изменить станцию на карте';updateStationDistance();setMessage('Метеостанция отмечена синей меткой.','success');
}

function pickStationOnMap(){state.mapTarget='station';$('windPickStationBtn').classList.add('active');$('windPickStationBtn').querySelector('span').textContent='Нажмите на станцию на карте';state.map?.getContainer().classList.add('picking-station');setMessage('Нажмите на карте в месте расположения метеостанции.')}

async function searchPlace(){
  const query=$('windPlaceSearch').value.trim(),results=$('windPlaceResults');
  if(query.length<2){setMessage('Введите не менее двух символов для поиска места.','error');return}
  $('windPlaceSearchBtn').disabled=true;setMessage('Ищу место…');
  try{
    const url='https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:'6',language:'ru',format:'json'});
    const response=await fetch(url);if(!response.ok)throw new Error('geocoding');
    const data=await response.json(),items=data.results||[];results.replaceChildren();
    if(!items.length){results.hidden=true;setMessage('Ничего не найдено. Попробуйте указать соседний населенный пункт.','error');return}
    items.forEach(item=>{
      const button=document.createElement('button');button.type='button';button.innerHTML=`<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml([item.admin1,item.country].filter(Boolean).join(', '))}</small>`;
      button.onclick=()=>{const label=[item.name,item.admin1].filter(Boolean).join(', ');$('windPlaceSearch').value=label;results.hidden=true;setLocation(item.latitude,item.longitude,label);setMessage('Место выбрано.','success')};
      results.append(button);
    });
    results.hidden=false;setMessage('Выберите подходящее место из списка.');
  }catch(error){console.error(error);setMessage('Не удалось выполнить поиск. Проверьте интернет или укажите координаты на карте.','error')}
  finally{$('windPlaceSearchBtn').disabled=false}
}

function locateUser(){
  if(!navigator.geolocation){setMessage('Этот браузер не поддерживает определение местоположения.','error');return}
  setMessage('Определяю местоположение…');
  navigator.geolocation.getCurrentPosition(position=>{setLocation(position.coords.latitude,position.coords.longitude,'Мое местоположение');setMessage('Местоположение определено.','success')},error=>{console.error(error);setMessage('Браузер не дал доступ к геопозиции. Разрешите его в настройках сайта или выберите точку вручную.','error')},{enableHighAccuracy:true,timeout:12000});
}

function sourceChanged(){
  const rp5=document.querySelector('[name="windSource"]:checked').value==='rp5';
  $('windRp5Controls').hidden=!rp5;$('windModelInfo').hidden=rp5;
}

function parseCsvLine(line,delimiter=';'){
  const cells=[];let current='',quoted=false;
  for(let index=0;index<line.length;index+=1){const char=line[index];if(char==='"'){if(quoted&&line[index+1]==='"'){current+='"';index+=1}else quoted=!quoted}else if(char===delimiter&&!quoted){cells.push(current.trim());current=''}else current+=char}
  cells.push(current.trim());return cells;
}

function parseRp5Date(value){
  const match=String(value||'').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\s+(\d{1,2}):(\d{2})/);
  if(!match)return null;
  return `${match[3]}-${pad(match[2])}-${pad(match[1])}T${pad(match[4])}:${match[5]}`;
}

function parseRp5Direction(value){
  const text=String(value||'').trim().toLowerCase();
  if(RP5_DIRECTIONS.has(text))return RP5_DIRECTIONS.get(text);
  const number=finite(text);return number!=null&&number>=0&&number<=360?number:null;
}

async function readRp5(file){
  const buffer=await file.arrayBuffer();let text=new TextDecoder('utf-8').decode(buffer);
  if(text.includes('�')||!/(^|;)"?DD"?(;|$)/m.test(text))text=new TextDecoder('windows-1251').decode(buffer);
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),headerIndex=lines.findIndex(line=>/(^|;)"?DD"?(;|$)/.test(line)&&/(^|;)"?Ff"?(;|$)/.test(line));
  if(headerIndex<0)throw new Error('rp5-columns');
  const headers=parseCsvLine(lines[headerIndex]).map(value=>value.replace(/^"|"$/g,'').trim());
  const dd=headers.findIndex(value=>value==='DD'),ff=headers.findIndex(value=>value==='Ff'),gustIndexes=headers.map((value,index)=>/^ff(?:3|10)$/i.test(value)?index:-1).filter(index=>index>=0),timeIndex=0;
  const rows=[];
  for(const line of lines.slice(headerIndex+1)){
    if(!line.trim())continue;const cells=parseCsvLine(line),dir=parseRp5Direction(cells[dd]),speed=finite(cells[ff]);
    if(dir==null||speed==null)continue;
    const gusts=gustIndexes.map(index=>finite(cells[index])).filter(value=>value!=null);
    rows.push({time:parseRp5Date(cells[timeIndex]),speed,dir,gust:gusts.length?Math.max(...gusts):null});
  }
  if(!rows.length)throw new Error('rp5-empty');
  const first=parseCsvLine(lines[0],',').map(value=>value.replace(/^#+|^"|"$/g,'').trim()),station=first[0]||file.name,country=first[1]||'',stationId=first[2]||'';
  return{rows,station:[station,country].filter(Boolean).join(', '),stationId,fileName:file.name,raw:text};
}

async function rp5Selected(file){
  if(!file)return;$('windRp5FileName').textContent='Читаю файл…';
  try{state.rp5=await readRp5(file);$('windRp5FileName').textContent=`${state.rp5.station}${state.rp5.stationId?` · ${state.rp5.stationId}`:''}`;setMessage(`Загружены данные: ${state.rp5.rows.length} наблюдений.`,'success')}
  catch(error){console.error(error);state.rp5=null;$('windRp5File').value='';$('windRp5FileName').textContent='Файл в кодировке UTF-8';setMessage(error.message==='rp5-columns'?'В CSV не найдены столбцы DD и Ff. На RP5 выберите формат CSV UTF-8.':'Не удалось прочитать данные из CSV RP5.','error')}
}

function haversineKm(lat1,lon1,lat2,lon2){const rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad,a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function updateStationDistance(){
  const lat=finite($('windLatitude').value),lon=finite($('windLongitude').value),stationLat=finite($('windStationLatitude').value),stationLon=finite($('windStationLongitude').value),node=$('windStationDistance');
  node.className='wind-distance-note';
  if([lat,lon,stationLat,stationLon].some(value=>value==null)){node.textContent='Укажите координаты станции, чтобы проверить расстояние до места поиска.';if(state.stationLine){state.stationLine.remove();state.stationLine=null}return null}
  const distance=haversineKm(lat,lon,stationLat,stationLon);node.textContent=`Метеостанция находится примерно в ${round(distance,1)} км от места поиска.`;
  if(state.map){if(state.stationLine)state.stationLine.setLatLngs([[lat,lon],[stationLat,stationLon]]);else state.stationLine=L.polyline([[lat,lon],[stationLat,stationLon]],{color:'#317da0',weight:2,dashArray:'6 6',opacity:.8}).addTo(state.map);state.map.getContainer().classList.remove('picking-station')}
  if(distance>50){node.classList.add('warning');node.textContent+=distance>100?' Данные могут заметно отличаться от условий на местности.':' Учитывайте удаленность при работе с результатом.'}
  return distance;
}

async function fetchOpenMeteoSegment(endpoint,latitude,longitude,start,end){
  const params=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),start_date:dateOnly(start),end_date:dateOnly(end),hourly:'wind_speed_10m,wind_direction_10m,wind_gusts_10m',wind_speed_unit:'ms',timezone:'auto'});
  const response=await fetch(`${endpoint}?${params}`);if(!response.ok)throw new Error(`weather-${response.status}`);const data=await response.json(),hourly=data.hourly||{};
  return (hourly.time||[]).map((time,index)=>({time,speed:finite(hourly.wind_speed_10m?.[index]),dir:finite(hourly.wind_direction_10m?.[index]),gust:finite(hourly.wind_gusts_10m?.[index])})).filter(row=>row.time>=start&&row.time<=end);
}

async function fetchModelRows(start,end,latitude,longitude){
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-5);cutoff.setHours(0,0,0,0);const cutoffText=localInputValue(cutoff),rows=[];let source='';
  if(start<cutoffText){const archiveEnd=end<cutoffText?end:localInputValue(new Date(cutoff.getTime()-3600000));rows.push(...await fetchOpenMeteoSegment('https://archive-api.open-meteo.com/v1/archive',latitude,longitude,start,archiveEnd));source='Исторический архив Open-Meteo'}
  if(end>=cutoffText){const forecastStart=start>cutoffText?start:cutoffText;rows.push(...await fetchOpenMeteoSegment('https://api.open-meteo.com/v1/forecast',latitude,longitude,forecastStart,end));source=source?'Архив и прогноз Open-Meteo':'Прогноз Open-Meteo'}
  return{rows:[...new Map(rows.map(row=>[row.time,row])).values()].sort((a,b)=>a.time.localeCompare(b.time)),source};
}

function analyzeRows(rows){
  const usable=rows.filter(row=>row.dir!=null&&row.speed!=null&&row.speed>0.5),bins=Array.from({length:16},()=>({count:0,speedSum:0,gustMax:0,classes:[0,0,0,0,0]}));
  usable.forEach(row=>{const bin=bins[directionIndex(row.dir)];bin.count+=1;bin.speedSum+=row.speed;bin.gustMax=Math.max(bin.gustMax,row.gust||0);bin.classes[speedClass(row.speed)]+=1});
  if(!usable.length)throw new Error('no-wind-data');
  let dominant=0;bins.forEach((bin,index)=>{if(bin.count>bins[dominant].count)dominant=index});
  const vector=usable.reduce((acc,row)=>{const radians=row.dir*Math.PI/180;acc.x+=Math.sin(radians);acc.y+=Math.cos(radians);return acc},{x:0,y:0}),meanDirection=(Math.atan2(vector.x,vector.y)*180/Math.PI+360)%360;
  return{bins,total:usable.length,ignored:rows.length-usable.length,dominant,dominantDegrees:dominant*22.5,dominantAverage:bins[dominant].speedSum/bins[dominant].count,maxGust:Math.max(...usable.map(row=>row.gust||0)),meanDirection};
}

function polarPoint(cx,cy,radius,degrees){const radians=(degrees-90)*Math.PI/180;return[cx+Math.cos(radians)*radius,cy+Math.sin(radians)*radius]}
function drawSector(ctx,cx,cy,inner,outer,start,end,color){ctx.beginPath();ctx.arc(cx,cy,outer,(start-90)*Math.PI/180,(end-90)*Math.PI/180);ctx.arc(cx,cy,inner,(end-90)*Math.PI/180,(start-90)*Math.PI/180,true);ctx.closePath();ctx.fillStyle=color;ctx.fill()}
function drawArrow(ctx,cx,cy,degrees,radius,color,label,pointsToCenter=false){const [x,y]=polarPoint(cx,cy,radius,degrees),startX=pointsToCenter?x:cx,startY=pointsToCenter?y:cy,endX=pointsToCenter?cx:x,endY=pointsToCenter?cy:y,angle=Math.atan2(endY-startY,endX-startX);ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(endX,endY);ctx.stroke();ctx.beginPath();ctx.moveTo(endX,endY);ctx.lineTo(endX-Math.cos(angle-.45)*18,endY-Math.sin(angle-.45)*18);ctx.lineTo(endX-Math.cos(angle+.45)*18,endY-Math.sin(angle+.45)*18);ctx.closePath();ctx.fill();ctx.font='700 17px Arial';ctx.textAlign='center';ctx.fillText(label,...polarPoint(cx,cy,radius+28,degrees));ctx.restore()}

function drawRose(summary,meta){
  const canvas=$('windRoseCanvas'),ctx=canvas.getContext('2d'),dark=document.documentElement.dataset.theme==='dark';canvas.width=900;canvas.height=900;const bg=dark?'#24272a':'#ffffff',ink=dark?'#edf0f2':'#23272a',grid=dark?'#50585d':'#cfd5d8';ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle=ink;ctx.textAlign='center';ctx.font='700 28px Arial';ctx.fillText('Роза ветров',450,40);ctx.font='16px Arial';ctx.fillStyle=dark?'#b8c0c5':'#667078';ctx.fillText(meta.place,450,68);ctx.fillText(`${formatPeriod(meta.start)} — ${formatPeriod(meta.end)}`,450,93);
  const cx=450,cy=465,radius=310,maxCount=Math.max(...summary.bins.map(bin=>bin.count),1);
  ctx.strokeStyle=grid;ctx.lineWidth=1;for(let ring=1;ring<=5;ring+=1){ctx.beginPath();ctx.arc(cx,cy,radius*ring/5,0,Math.PI*2);ctx.stroke();ctx.fillStyle=dark?'#abb3b8':'#6f777b';ctx.font='12px Arial';ctx.textAlign='left';ctx.fillText(`${Math.round(maxCount/summary.total*ring/5*100)}%`,cx+5,cy-radius*ring/5+15)}
  for(let index=0;index<16;index+=1){const degrees=index*22.5,[x,y]=polarPoint(cx,cy,radius,degrees);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();const bin=summary.bins[index];let inner=0;bin.classes.forEach((count,classIndex)=>{if(!count)return;const outer=inner+radius*count/maxCount;drawSector(ctx,cx,cy,inner,outer,degrees-8.5,degrees+8.5,SPEED_COLORS[classIndex]);inner=outer});const [lx,ly]=polarPoint(cx,cy,radius+30,degrees);ctx.fillStyle=ink;ctx.font=`${index===summary.dominant?'700':'500'} 15px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(DIRECTIONS[index],lx,ly)}
  drawArrow(ctx,cx,cy,summary.dominantDegrees,radius*.72,'#c83d3d','ветер оттуда',true);drawArrow(ctx,cx,cy,scentDegrees(summary.dominantDegrees),radius*.58,'#2f7d66','запах туда');
  ctx.textBaseline='alphabetic';ctx.textAlign='center';ctx.fillStyle=ink;ctx.font='700 20px Arial';ctx.fillText(`Преобладал ${DIRECTIONS[summary.dominant]}: ${Math.round(summary.bins[summary.dominant].count/summary.total*100)}% времени`,450,835);ctx.font='15px Arial';ctx.fillStyle=dark?'#b8c0c5':'#667078';ctx.fillText(`Средняя сила ${round(summary.dominantAverage)} м/с · максимальный порыв ${round(summary.maxGust)} м/с`,450,864);
}

function destination(latitude,longitude,bearing,distanceKm=8){const radius=6371,br=bearing*Math.PI/180,lat1=latitude*Math.PI/180,lon1=longitude*Math.PI/180,lat2=Math.asin(Math.sin(lat1)*Math.cos(distanceKm/radius)+Math.cos(lat1)*Math.sin(distanceKm/radius)*Math.cos(br)),lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(distanceKm/radius)*Math.cos(lat1),Math.cos(distanceKm/radius)-Math.sin(lat1)*Math.sin(lat2));return[lat2*180/Math.PI,lon2*180/Math.PI]}
function drawMapDirections(summary){
  if(!state.map)return;state.windLayers.clearLayers();const lat=finite($('windLatitude').value),lon=finite($('windLongitude').value),from=destination(lat,lon,summary.dominantDegrees,6),to=destination(lat,lon,scentDegrees(summary.dominantDegrees),6);
  L.polyline([from,[lat,lon]],{color:'#c83d3d',weight:5,opacity:.85}).addTo(state.windLayers);L.circleMarker(from,{radius:7,color:'#c83d3d',fillOpacity:1}).bindTooltip(`Ветер приходил с ${DIRECTIONS[summary.dominant]}`,{permanent:false}).addTo(state.windLayers);
  L.polyline([[lat,lon],to],{color:'#2f7d66',weight:5,dashArray:'9 7',opacity:.9}).addTo(state.windLayers);L.circleMarker(to,{radius:7,color:'#2f7d66',fillOpacity:1}).bindTooltip(`Запах переносило на ${directionName(scentDegrees(summary.dominantDegrees))}`,{permanent:false}).addTo(state.windLayers);
  state.map.fitBounds(L.latLngBounds([from,to]).pad(.45));
}

function renderResult(summary,meta){
  state.summary=summary;state.meta=meta;$('windResult').hidden=false;$('windResultPlace').textContent=meta.place;$('windSourceBadge').textContent=meta.source;
  $('windDominantDirection').textContent=`${DIRECTIONS[summary.dominant]} · оттуда`;$('windDominantShare').textContent=`${Math.round(summary.bins[summary.dominant].count/summary.total*100)}% учтенного времени`;
  $('windDominantSpeed').textContent=`${round(summary.dominantAverage)} м/с`;$('windMaxGust').textContent=summary.maxGust?`${round(summary.maxGust)} м/с`:'Нет данных';$('windScentDirection').textContent=`${directionName(scentDegrees(summary.dominantDegrees))} · туда`;
  const distance=meta.distance;$('windResultNote').textContent=`Ветер называется по направлению, откуда он приходит. Запах переносится в противоположную сторону.${distance>50?` Метеостанция удалена на ${round(distance)} км — учитывайте возможные местные отличия.`:''}`;
  $('windDataMeta').innerHTML=`<p><strong>Источник:</strong> ${escapeHtml(meta.source)}</p><p><strong>Место:</strong> ${escapeHtml(meta.place)}</p>${meta.station?`<p><strong>Метеостанция:</strong> ${escapeHtml(meta.station)}</p>`:''}<p><strong>Период:</strong> ${escapeHtml(formatPeriod(meta.start))} — ${escapeHtml(formatPeriod(meta.end))}</p><p><strong>Строк данных:</strong> ${state.rows.length}; учтено ${summary.total}; штиль или неполные строки: ${summary.ignored}.</p><p>Исходные почасовые значения сохраняются в памяти страницы до следующего построения и доступны для скачивания.</p>`;
  drawRose(summary,meta);drawMapDirections(summary);$('windResult').scrollIntoView({behavior:'smooth',block:'start'});
}

async function buildRose(event){
  event.preventDefault();const button=$('windBuildBtn'),start=$('windStart').value,end=$('windEnd').value,latitude=finite($('windLatitude').value),longitude=finite($('windLongitude').value),source=document.querySelector('[name="windSource"]:checked').value;
  if(latitude==null||longitude==null){setMessage('Укажите место поиска на карте или координатами.','error');return}
  if(!start||!end||end<=start){setMessage('Окончание периода должно быть позже его начала.','error');return}
  if((new Date(end)-new Date(start))/86400000>31){setMessage('Для одной розы выберите период не более 31 дня.','error');return}
  button.disabled=true;$('windResult').hidden=true;setMessage(source==='rp5'?'Обрабатываю данные метеостанции…':'Загружаю почасовые данные…');
  try{
    let rows,meta;
    if(source==='rp5'){
      if(!state.rp5)throw new Error('rp5-required');rows=state.rp5.rows.filter(row=>!row.time||(row.time>=start&&row.time<=end));if(!rows.length)throw new Error('rp5-period');const distance=updateStationDistance();meta={source:'Фактические данные RP5',place:state.place,station:`${state.rp5.station}${state.rp5.stationId?` · ${state.rp5.stationId}`:''}`,distance,start,end};
    }else{const result=await fetchModelRows(start,end,latitude,longitude);rows=result.rows;meta={source:result.source,place:state.place,start,end,distance:null}}
    if(!rows.length)throw new Error('period-empty');state.rows=rows;const summary=analyzeRows(rows);renderResult(summary,meta);setMessage('Роза ветров построена.','success');
  }catch(error){console.error(error);const messages={'rp5-required':'Сначала выберите CSV-файл с RP5.','rp5-period':'В файле RP5 нет наблюдений за выбранные часы. Проверьте период.','period-empty':'Источник не вернул данных за выбранный период.','no-wind-data':'За выбранный период нет ветра сильнее 0,5 м/с или отсутствуют направления.'};setMessage(messages[error.message]||'Не удалось получить метеоданные. Проверьте интернет, период и выбранный источник.','error')}
  finally{button.disabled=false}
}

function downloadBlob(blob,fileName){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=fileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
function saveImage(){if(!state.summary)return;const canvas=$('windRoseCanvas');canvas.toBlob(blob=>blob&&downloadBlob(blob,`roza-vetrov-${dateOnly(state.meta.start)}.png`),'image/png')}
function saveData(){
  if(!state.rows.length)return;const lines=['time;wind_direction_deg;wind_direction;wind_speed_ms;wind_gust_ms',...state.rows.map(row=>[row.time||'',row.dir??'',row.dir==null?'':directionName(row.dir),row.speed??'',row.gust??''].join(';'))],text='\uFEFF'+lines.join('\r\n');downloadBlob(new Blob([text],{type:'text/csv;charset=utf-8'}),`wind-data-${dateOnly(state.meta.start)}.csv`);
}

export function initWindRose(){
  setDefaultPeriod();initMap();
  $('windPlaceSearchBtn').onclick=searchPlace;$('windPlaceSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchPlace()}});$('windLocateBtn').onclick=locateUser;
  ['windLatitude','windLongitude'].forEach(id=>$(id).addEventListener('change',()=>setLocation(finite($('windLatitude').value),finite($('windLongitude').value),'Точка по координатам')));
  document.querySelectorAll('[name="windSource"]').forEach(input=>input.onchange=sourceChanged);$('windRp5File').onchange=event=>rp5Selected(event.target.files[0]);$('windPickStationBtn').onclick=pickStationOnMap;['windStationLatitude','windStationLongitude'].forEach(id=>$(id).addEventListener('change',()=>setStationLocation(finite($('windStationLatitude').value),finite($('windStationLongitude').value))));
  document.querySelectorAll('[data-wind-hours]').forEach(button=>button.onclick=()=>setDefaultPeriod(Number(button.dataset.windHours)));$('windRoseForm').onsubmit=buildRose;$('windSaveImageBtn').onclick=saveImage;$('windSaveDataBtn').onclick=saveData;
  return{onShow(){initMap();setTimeout(()=>state.map?.invalidateSize(),0);if(state.summary)drawRose(state.summary,state.meta)},onTheme(){if(state.summary)drawRose(state.summary,state.meta)}};
}
