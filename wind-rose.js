const DIRECTIONS=['С','ССВ','СВ','ВСВ','В','ВЮВ','ЮВ','ЮЮВ','Ю','ЮЮЗ','ЮЗ','ЗЮЗ','З','ЗСЗ','СЗ','ССЗ'];
const WIND_NAMES=['Северный ветер','Северо-северо-восточный ветер','Северо-восточный ветер','Востоко-северо-восточный ветер','Восточный ветер','Востоко-юго-восточный ветер','Юго-восточный ветер','Юго-юго-восточный ветер','Южный ветер','Юго-юго-западный ветер','Юго-западный ветер','Западо-юго-западный ветер','Западный ветер','Западо-северо-западный ветер','Северо-западный ветер','Северо-северо-западный ветер'];
const FROM_DIRECTIONS=['с севера','с северо-северо-востока','с северо-востока','с востоко-северо-востока','с востока','с востоко-юго-востока','с юго-востока','с юго-юго-востока','с юга','с юго-юго-запада','с юго-запада','с западо-юго-запада','с запада','с западо-северо-запада','с северо-запада','с северо-северо-запада'];
const TO_DIRECTIONS=['на север','на северо-северо-восток','на северо-восток','на востоко-северо-восток','на восток','на востоко-юго-восток','на юго-восток','на юго-юго-восток','на юг','на юго-юго-запад','на юго-запад','на западо-юго-запад','на запад','на западо-северо-запад','на северо-запад','на северо-северо-запад'];
const SPEED_COLORS=['#9bd4df','#386fd8','#42a75b','#e1c832','#e95454'];
const RP5_DIRECTIONS=new Map([
  ['ветер, дующий с севера',0],['ветер, дующий с северо-северо-востока',22.5],['ветер, дующий с северо-востока',45],['ветер, дующий с востоко-северо-востока',67.5],
  ['ветер, дующий с востока',90],['ветер, дующий с востоко-юго-востока',112.5],['ветер, дующий с юго-востока',135],['ветер, дующий с юго-юго-востока',157.5],
  ['ветер, дующий с юга',180],['ветер, дующий с юго-юго-запада',202.5],['ветер, дующий с юго-запада',225],['ветер, дующий с западо-юго-запада',247.5],
  ['ветер, дующий с запада',270],['ветер, дующий с западо-северо-запада',292.5],['ветер, дующий с северо-запада',315],['ветер, дующий с северо-северо-запада',337.5]
]);

const $=id=>document.getElementById(id);
const STATION_RADIUS_KM=300;
const MAX_NEARBY_STATIONS=20;
const state={map:null,marker:null,stationMarker:null,stationLine:null,stationLayers:null,windLayers:null,place:'Выбранная точка',rows:[],meta:null,summary:null,rp5:null,stationCatalog:null,stationsPromise:null,nearbyStations:[],selectedStation:null,compassShell:null,compassHeading:null,compassActive:false,compassAbsoluteSeen:false,placeSearchTimer:null,placeSearchController:null,placeSearchSequence:0,terrainProfile:null,terrainKey:''};

function pad(value){return String(value).padStart(2,'0')}
function localInputValue(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`}
function dateOnly(value){return value.slice(0,10)}
function formatPeriod(value){return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}
function round(value,digits=1){const factor=10**digits;return Math.round(value*factor)/factor}
function finite(value){const text=String(value??'').trim();if(!text)return null;const number=Number(text.replace(',','.'));return Number.isFinite(number)?number:null}
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function directionIndex(degrees){return Math.round((((degrees%360)+360)%360)/22.5)%16}
function directionName(degrees){return DIRECTIONS[directionIndex(degrees)]}
function windName(degrees){return WIND_NAMES[directionIndex(degrees)]}
function directionFrom(degrees){return FROM_DIRECTIONS[directionIndex(degrees)]}
function directionTo(degrees){return TO_DIRECTIONS[directionIndex(degrees)]}
function capitalize(value){return value.charAt(0).toUpperCase()+value.slice(1)}
function speedClass(speed){return speed<2?0:speed<4?1:speed<6?2:speed<8?3:4}
function scentDegrees(degrees){return (degrees+180)%360}
function clamp(value,min,max){return Math.min(max,Math.max(min,value))}

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

function updateCompassVisual(){
  const shell=state.compassShell;if(!shell)return;const heading=state.compassHeading;
  const north=shell.querySelector('.wind-compass-north'),wind=shell.querySelector('.wind-compass-wind'),scent=shell.querySelector('.wind-compass-scent'),readout=shell.querySelector('.wind-compass-readout');
  north.style.transform=`translateX(-50%) rotate(${heading==null?0:-heading}deg)`;
  if(state.summary){wind.hidden=false;scent.hidden=false;wind.style.transform=`translateX(-50%) rotate(${state.summary.dominantDegrees-(heading||0)}deg)`;scent.style.transform=`translateX(-50%) rotate(${scentDegrees(state.summary.dominantDegrees)-(heading||0)}deg)`}else{wind.hidden=true;scent.hidden=true}
  readout.textContent=heading==null?'Датчик направления выключен':`Верх телефона: ${directionName(heading)} · ${Math.round(heading)}°`;
}

function handleDeviceOrientation(event){
  if(event.type==='deviceorientationabsolute')state.compassAbsoluteSeen=true;if(state.compassAbsoluteSeen&&event.type!=='deviceorientationabsolute'&&event.webkitCompassHeading==null)return;
  let heading=finite(event.webkitCompassHeading);if(heading==null&&finite(event.alpha)!=null){const screenAngle=finite(screen.orientation?.angle)||finite(window.orientation)||0;heading=(360-finite(event.alpha)+screenAngle+360)%360}
  if(heading==null)return;state.compassHeading=heading;const status=state.compassShell?.querySelector('.wind-compass-status');if(status)status.textContent='Поворачивайте телефон, пока его верх не будет направлен в нужную сторону.';updateCompassVisual();
}

async function startDynamicCompass(){
  const status=state.compassShell?.querySelector('.wind-compass-status');if(!status||state.compassActive)return;
  if(!window.DeviceOrientationEvent){status.textContent='На этом устройстве нет доступного датчика направления.';return}
  try{
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      let permission;try{permission=await DeviceOrientationEvent.requestPermission(true)}catch(error){permission=await DeviceOrientationEvent.requestPermission()}
      if(permission!=='granted'){status.textContent='Доступ к датчику не разрешен. Разрешите движение и ориентацию в настройках браузера.';return}
    }
    state.compassActive=true;status.textContent='Жду данные компаса…';window.addEventListener('deviceorientationabsolute',handleDeviceOrientation,true);window.addEventListener('deviceorientation',handleDeviceOrientation,true);
  }catch(error){console.error(error);status.textContent='Не удалось включить компас. Проверьте разрешение датчиков для сайта.'}
}

function compassControl(){
  const Control=L.Control.extend({
    options:{position:'topright'},
    onAdd(){
      const shell=L.DomUtil.create('div','wind-compass-control is-collapsed');
      shell.innerHTML=`<button class="wind-compass-toggle" type="button" aria-expanded="false" aria-label="Открыть полевой компас" title="Полевой компас"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15 9-2 5-5 2 2-5 5-2Z"/></svg></button><div class="wind-compass-panel"><div class="wind-compass-face"><span class="north">С</span><span class="east">В</span><span class="south">Ю</span><span class="west">З</span><i class="wind-compass-pointer wind-compass-north"></i><i class="wind-compass-pointer wind-compass-wind" hidden></i><i class="wind-compass-pointer wind-compass-scent" hidden></i><b></b></div><strong class="wind-compass-readout">Датчик направления выключен</strong><small class="wind-compass-status">Нажмите значок компаса и разрешите доступ к датчику.</small><div class="wind-compass-legend"><span><i></i>откуда дул ветер</span><span><i></i>куда несет запах</span></div></div>`;
      const button=shell.querySelector('.wind-compass-toggle');state.compassShell=shell;updateCompassVisual();
      button.addEventListener('click',async()=>{
        const collapsed=shell.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded',String(!collapsed));
        button.setAttribute('aria-label',collapsed?'Открыть полевой компас':'Скрыть полевой компас');
        if(!collapsed)await startDynamicCompass();
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
  state.stationLayers=L.layerGroup().addTo(state.map);
  state.map.on('click',event=>setLocation(event.latlng.lat,event.latlng.lng,'Точка на карте'));
  setLocation(54.3142,48.4031,'Ульяновск');
}

function setLocation(latitude,longitude,label=state.place,zoom=true){
  if(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude)))return;
  const lat=Number(latitude),lon=Number(longitude),previousLat=finite($('windLatitude').value),previousLon=finite($('windLongitude').value);
  if(previousLat!==lat||previousLon!==lon){state.terrainProfile=null;state.terrainKey='';if(state.meta)delete state.meta.terrain}
  $('windLatitude').value=lat.toFixed(6);$('windLongitude').value=lon.toFixed(6);state.place=label||'Выбранная точка';
  if(state.map){
    if(!state.marker)state.marker=L.marker([lat,lon],{draggable:true}).addTo(state.map).on('dragend',event=>{const point=event.target.getLatLng();setLocation(point.lat,point.lng,'Точка на карте',false)});
    else state.marker.setLatLng([lat,lon]);
    if(zoom)state.map.setView([lat,lon],Math.max(state.map.getZoom(),11));
  }
  updateStationDistance();
  if(document.querySelector('[name="windSource"]:checked')?.value==='rp5'&&state.stationCatalog)renderNearbyStations();
}

function stationIcon(){return L.divIcon({className:'wind-station-marker',html:'<span><b>М</b></span>',iconSize:[30,30],iconAnchor:[15,30]})}
function stationLabel(station){return `${station.name}${station.wmo?` · WMO ${station.wmo}`:station.icao?` · ${station.icao}`:''}`}
function setStationLocation(latitude,longitude,station=null){
  if(latitude==null||longitude==null)return;const lat=Number(latitude),lon=Number(longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
  state.selectedStation=station;
  $('windStationLatitude').value=lat.toFixed(6);$('windStationLongitude').value=lon.toFixed(6);
  if(state.map){if(!state.stationMarker)state.stationMarker=L.marker([lat,lon],{icon:stationIcon()}).addTo(state.map);else state.stationMarker.setLatLng([lat,lon]);state.stationMarker.unbindTooltip().bindTooltip(station?stationLabel(station):'Выбранная метеостанция')}
  updateStationDistance();renderNearbyStations();const searchLat=finite($('windLatitude').value),searchLon=finite($('windLongitude').value);if(state.map&&searchLat!=null&&searchLon!=null)state.map.fitBounds([[searchLat,searchLon],[lat,lon]],{padding:[35,35],maxZoom:11});setMessage(station?`Выбрана станция: ${stationLabel(station)}.`:'Метеостанция выбрана.','success');
}

function stationFromRow(row){return{id:row[0],name:row[1],country:row[2],latitude:row[3],longitude:row[4],wmo:row[5],icao:row[6],usaf:row[7]}}
async function loadWeatherStations(){
  if(state.stationCatalog)return state.stationCatalog;
  if(!state.stationsPromise)state.stationsPromise=fetch('./data/weather-stations.json?v=62').then(response=>{if(!response.ok)throw new Error('station-catalog');return response.json()}).then(data=>{state.stationCatalog=data.stations.map(stationFromRow);return state.stationCatalog}).catch(error=>{state.stationsPromise=null;throw error});
  return state.stationsPromise;
}

function renderNearbyStations(){
  const list=$('windNearbyStations');if(!list||!state.stationLayers)return;
  state.stationLayers.clearLayers();list.replaceChildren();
  if(document.querySelector('[name="windSource"]:checked')?.value!=='rp5'||!state.stationCatalog){list.hidden=true;return}
  const lat=finite($('windLatitude').value),lon=finite($('windLongitude').value);if(lat==null||lon==null){list.hidden=true;return}
  state.nearbyStations=state.stationCatalog.map(station=>({...station,distance:haversineKm(lat,lon,station.latitude,station.longitude)})).filter(station=>station.distance<=STATION_RADIUS_KM).sort((a,b)=>a.distance-b.distance).slice(0,MAX_NEARBY_STATIONS);
  if(!state.nearbyStations.length){list.innerHTML='<p>В радиусе 300 км станции с данными о ветре не найдены.</p>';list.hidden=false;return}
  const heading=document.createElement('div');heading.className='wind-nearby-head';heading.innerHTML=`<strong>Ближайшие метеостанции</strong><small>${state.nearbyStations.length} на карте · каталог Meteostat</small>`;list.append(heading);
  state.nearbyStations.forEach(station=>{
    const selected=state.selectedStation?.id===station.id;
    if(!selected)L.circleMarker([station.latitude,station.longitude],{radius:7,color:'#256b87',weight:2,fillColor:'#fff',fillOpacity:.95}).bindTooltip(`${stationLabel(station)} · ${round(station.distance)} км`).on('click',()=>setStationLocation(station.latitude,station.longitude,station)).addTo(state.stationLayers);
    const button=document.createElement('button');button.type='button';button.className=selected?'selected':'';button.innerHTML=`<span><strong>${escapeHtml(station.name)}</strong><small>${escapeHtml([station.country,station.wmo?`WMO ${station.wmo}`:station.icao].filter(Boolean).join(' · '))}</small></span><b>${round(station.distance)} км</b>`;button.onclick=()=>setStationLocation(station.latitude,station.longitude,station);list.append(button);
  });
  list.hidden=false;
}

function fitNearbyStations(){
  if(!state.map||!state.nearbyStations.length)return;const lat=finite($('windLatitude').value),lon=finite($('windLongitude').value);if(lat==null||lon==null)return;
  state.map.fitBounds([[lat,lon],...state.nearbyStations.slice(0,8).map(station=>[station.latitude,station.longitude])],{padding:[28,28],maxZoom:10});
}

function rp5StationCode(value){const match=String(value||'').match(/(?:WMO(?:_ID)?\s*=\s*)?(\d{5})/i);return match?.[1]||''}
function matchRp5Station(){
  const code=rp5StationCode(state.rp5?.stationId);if(!code||!state.stationCatalog)return false;
  const station=state.stationCatalog.find(item=>item.wmo===code||item.id===code||String(item.usaf||'').startsWith(code));
  if(!station)return false;setStationLocation(station.latitude,station.longitude,station);return true;
}

async function refreshNearbyStations(fitMap=false){
  const button=$('windPickStationBtn');button.disabled=true;$('windNearbyStations').hidden=false;$('windNearbyStations').innerHTML='<p>Загружаю каталог метеостанций…</p>';
  try{await loadWeatherStations();if(document.querySelector('[name="windSource"]:checked')?.value!=='rp5')return;if(state.selectedStation)setStationLocation(state.selectedStation.latitude,state.selectedStation.longitude,state.selectedStation);else renderNearbyStations();if(fitMap)fitNearbyStations()}
  catch(error){console.error(error);if(document.querySelector('[name="windSource"]:checked')?.value==='rp5'){$('windNearbyStations').innerHTML='<p class="error">Не удалось загрузить каталог станций. Проверьте подключение к интернету.</p>';setMessage('Не удалось загрузить каталог метеостанций.','error')}}
  finally{button.disabled=false}
}

function photonResultLabel(item){const properties=item.properties||{};return[properties.name,[properties.street,properties.housenumber].filter(Boolean).join(' '),properties.district,properties.city,properties.state,properties.country].filter((value,index,items)=>value&&items.indexOf(value)===index).join(', ')}
async function searchPlace({suggest=false}={}){
  const query=$('windPlaceSearch').value.trim(),results=$('windPlaceResults'),requestId=++state.placeSearchSequence;
  if(query.length<2){results.hidden=true;if(!suggest)setMessage('Введите не менее двух символов для поиска места.','error');return}
  state.placeSearchController?.abort();state.placeSearchController=new AbortController();
  if(suggest){results.innerHTML='<div class="wind-place-loading">Ищу подходящие адреса…</div>';results.hidden=false}else{$('windPlaceSearchBtn').disabled=true;setMessage('Ищу место…')}
  try{
    const params=new URLSearchParams({q:query,limit:'6'}),lat=finite($('windLatitude').value),lon=finite($('windLongitude').value);if(lat!=null&&lon!=null){params.set('lat',String(lat));params.set('lon',String(lon))}
    const response=await fetch(`https://photon.komoot.io/api/?${params}`,{signal:state.placeSearchController.signal});if(!response.ok)throw new Error('geocoding');
    const data=await response.json();if(requestId!==state.placeSearchSequence)return;const items=data.features||[];results.replaceChildren();
    if(!items.length){results.hidden=true;setMessage('Ничего не найдено. Попробуйте указать соседний населенный пункт.','error');return}
    items.forEach(item=>{
      const properties=item.properties||{},coordinates=item.geometry?.coordinates||[],label=photonResultLabel(item),primary=properties.name||properties.street||label;
      const button=document.createElement('button');button.type='button';button.innerHTML=`<strong>${escapeHtml(primary)}</strong><small>${escapeHtml(label)}</small>`;
      button.onclick=()=>{$('windPlaceSearch').value=label;results.hidden=true;state.placeSearchController?.abort();setLocation(coordinates[1],coordinates[0],label);setMessage('Место выбрано.','success')};
      results.append(button);
    });
    results.hidden=false;if(!suggest)setMessage('Выберите подходящее место из списка.');
  }catch(error){if(error.name!=='AbortError'){console.error(error);results.hidden=true;setMessage('Не удалось выполнить поиск. Проверьте интернет или укажите координаты на карте.','error')}}
  finally{if(!suggest)$('windPlaceSearchBtn').disabled=false}
}

function schedulePlaceSuggestions(){
  clearTimeout(state.placeSearchTimer);state.placeSearchController?.abort();const query=$('windPlaceSearch').value.trim();if(query.length<2){$('windPlaceResults').hidden=true;return}
  $('windPlaceResults').innerHTML='<div class="wind-place-loading">Ищу подходящие адреса…</div>';$('windPlaceResults').hidden=false;state.placeSearchTimer=setTimeout(()=>searchPlace({suggest:true}),400);
}

function locateUser(){
  if(!navigator.geolocation){setMessage('Этот браузер не поддерживает определение местоположения.','error');return}
  setMessage('Определяю местоположение…');
  navigator.geolocation.getCurrentPosition(position=>{setLocation(position.coords.latitude,position.coords.longitude,'Мое местоположение');setMessage('Местоположение определено.','success')},error=>{console.error(error);setMessage('Браузер не дал доступ к геопозиции. Разрешите его в настройках сайта или выберите точку вручную.','error')},{enableHighAccuracy:true,timeout:12000});
}

function sourceChanged(){
  const rp5=document.querySelector('[name="windSource"]:checked').value==='rp5';
  $('windRp5Controls').hidden=!rp5;$('windModelInfo').hidden=rp5;
  if(rp5)refreshNearbyStations(true);else{state.stationLayers?.clearLayers();state.stationLine?.remove();state.stationLine=null;state.stationMarker?.remove();state.stationMarker=null;$('windNearbyStations').hidden=true}
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

function parseRp5Number(value,{zeroText=false}={}){const text=String(value??'').trim().replace(',','.');if(zeroText&&/(нет осадков|осадков нет|следы осадков)/i.test(text))return 0;const match=text.match(/-?\d+(?:\.\d+)?/);return match?finite(match[0]):null}

async function readRp5(file){
  const buffer=await file.arrayBuffer();let text=new TextDecoder('utf-8').decode(buffer);
  if(text.includes('�')||!/(^|;)"?DD"?(;|$)/m.test(text))text=new TextDecoder('windows-1251').decode(buffer);
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/),headerIndex=lines.findIndex(line=>/(^|;)"?DD"?(;|$)/.test(line)&&/(^|;)"?Ff"?(;|$)/.test(line));
  if(headerIndex<0)throw new Error('rp5-columns');
  const headers=parseCsvLine(lines[headerIndex]).map(value=>value.replace(/^"|"$/g,'').trim());
  const dd=headers.findIndex(value=>value==='DD'),ff=headers.findIndex(value=>value==='Ff'),tempIndex=headers.findIndex(value=>value==='T'),rhIndex=headers.findIndex(value=>value==='U'),precipIndex=headers.findIndex(value=>value==='RRR'),gustIndexes=headers.map((value,index)=>/^ff(?:3|10)$/i.test(value)?index:-1).filter(index=>index>=0),timeIndex=0;
  const rows=[];
  for(const line of lines.slice(headerIndex+1)){
    if(!line.trim())continue;const cells=parseCsvLine(line),dir=parseRp5Direction(cells[dd]),speed=finite(cells[ff]);
    if(dir==null||speed==null)continue;
    const gusts=gustIndexes.map(index=>finite(cells[index])).filter(value=>value!=null);
    rows.push({time:parseRp5Date(cells[timeIndex]),speed,dir,gust:gusts.length?Math.max(...gusts):null,temp:tempIndex>=0?parseRp5Number(cells[tempIndex]):null,rh:rhIndex>=0?parseRp5Number(cells[rhIndex]):null,precip:precipIndex>=0?parseRp5Number(cells[precipIndex],{zeroText:true}):null});
  }
  if(!rows.length)throw new Error('rp5-empty');
  const first=parseCsvLine(lines[0],',').map(value=>value.replace(/^#+|^"|"$/g,'').trim()),station=first[0]||file.name,country=first[1]||'',stationId=first[2]||'';
  return{rows,station:[station,country].filter(Boolean).join(', '),stationId,fileName:file.name,raw:text};
}

async function rp5Selected(file){
  if(!file)return;$('windRp5FileName').textContent='Читаю файл…';
  try{state.rp5=await readRp5(file);$('windRp5FileName').textContent=`${state.rp5.station}${state.rp5.stationId?` · ${state.rp5.stationId}`:''}`;await loadWeatherStations();const rp5Active=document.querySelector('[name="windSource"]:checked')?.value==='rp5',matched=rp5Active&&matchRp5Station();if(rp5Active&&!matched)renderNearbyStations();setMessage(`Загружены данные: ${state.rp5.rows.length} наблюдений.${matched?' Станция найдена по номеру WMO.':' Выберите станцию на карте или в списке.'}`,'success')}
  catch(error){console.error(error);state.rp5=null;$('windRp5File').value='';$('windRp5FileName').textContent='Файл в кодировке UTF-8';setMessage(error.message==='rp5-columns'?'В CSV не найдены столбцы DD и Ff. На RP5 выберите формат CSV UTF-8.':'Не удалось прочитать данные из CSV RP5.','error')}
}

function haversineKm(lat1,lon1,lat2,lon2){const rad=Math.PI/180,dLat=(lat2-lat1)*rad,dLon=(lon2-lon1)*rad,a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function updateStationDistance(){
  const lat=finite($('windLatitude').value),lon=finite($('windLongitude').value),stationLat=finite($('windStationLatitude').value),stationLon=finite($('windStationLongitude').value),node=$('windStationDistance');
  node.className='wind-distance-note';
  if(document.querySelector('[name="windSource"]:checked')?.value!=='rp5'){if(state.stationLine){state.stationLine.remove();state.stationLine=null}if(state.stationMarker){state.stationMarker.remove();state.stationMarker=null}return null}
  if([lat,lon,stationLat,stationLon].some(value=>value==null)){node.textContent='Выберите реальную станцию на карте или в списке. До выбора соединительный пунктир не показывается.';if(state.stationLine){state.stationLine.remove();state.stationLine=null}if(state.stationMarker){state.stationMarker.remove();state.stationMarker=null}state.selectedStation=null;return null}
  const distance=haversineKm(lat,lon,stationLat,stationLon);node.textContent=`Метеостанция находится примерно в ${round(distance,1)} км от места поиска.`;
  if(state.map){if(state.stationLine)state.stationLine.setLatLngs([[lat,lon],[stationLat,stationLon]]);else state.stationLine=L.polyline([[lat,lon],[stationLat,stationLon]],{color:'#317da0',weight:2,dashArray:'6 6',opacity:.8}).addTo(state.map)}
  if(distance>50){node.classList.add('warning');node.textContent+=distance>100?' Данные могут заметно отличаться от условий на местности.':' Учитывайте удаленность при работе с результатом.'}
  return distance;
}

async function fetchOpenMeteoSegment(endpoint,latitude,longitude,start,end){
  const params=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),start_date:dateOnly(start),end_date:dateOnly(end),hourly:'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,relative_humidity_2m,precipitation',wind_speed_unit:'ms',timezone:'auto'});
  const response=await fetch(`${endpoint}?${params}`);if(!response.ok)throw new Error(`weather-${response.status}`);const data=await response.json(),hourly=data.hourly||{};
  return (hourly.time||[]).map((time,index)=>({time,speed:finite(hourly.wind_speed_10m?.[index]),dir:finite(hourly.wind_direction_10m?.[index]),gust:finite(hourly.wind_gusts_10m?.[index]),temp:finite(hourly.temperature_2m?.[index]),rh:finite(hourly.relative_humidity_2m?.[index]),precip:finite(hourly.precipitation?.[index])})).filter(row=>row.time>=start&&row.time<=end);
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
  const vector=usable.reduce((acc,row)=>{const radians=row.dir*Math.PI/180,weight=Math.max(row.speed,.1);acc.x+=Math.sin(radians)*weight;acc.y+=Math.cos(radians)*weight;acc.weight+=weight;return acc},{x:0,y:0,weight:0}),meanDirection=(Math.atan2(vector.x,vector.y)*180/Math.PI+360)%360,consistency=Math.hypot(vector.x,vector.y)/Math.max(vector.weight,.1);
  return{bins,total:usable.length,ignored:rows.length-usable.length,dominant,dominantDegrees:dominant*22.5,dominantAverage:bins[dominant].speedSum/bins[dominant].count,maxGust:Math.max(...usable.map(row=>row.gust||0)),meanDirection,consistency};
}

function average(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null}
function weatherStats(rows){
  const temperatures=rows.map(row=>finite(row.temp)).filter(value=>value!=null),humidities=rows.map(row=>finite(row.rh)).filter(value=>value!=null),precipitation=rows.map(row=>finite(row.precip)).filter(value=>value!=null);
  return{temperatureAverage:average(temperatures),temperatureMin:temperatures.length?Math.min(...temperatures):null,temperatureMax:temperatures.length?Math.max(...temperatures):null,humidityAverage:average(humidities),humidityMin:humidities.length?Math.min(...humidities):null,humidityMax:humidities.length?Math.max(...humidities):null,precipitationTotal:precipitation.length?precipitation.reduce((sum,value)=>sum+value,0):null,wetHours:precipitation.filter(value=>value>0).length};
}

async function fetchTerrainProfile(latitude,longitude,bearing){
  const point=(name,distance,direction,role)=>{const coordinates=distance?destination(latitude,longitude,direction,distance):[latitude,longitude];return{name,distance,role,latitude:coordinates[0],longitude:coordinates[1]}};
  const points=[point('Точка поиска',0,bearing,'center'),point('1 км по шлейфу',1,bearing,'downwind'),point('3 км по шлейфу',3,bearing,'downwind'),point('6 км по шлейфу',6,bearing,'downwind'),point('2 км против ветра',2,(bearing+180)%360,'upwind'),point('3 км слева от шлейфа',3,(bearing+270)%360,'crosswind'),point('3 км справа от шлейфа',3,(bearing+90)%360,'crosswind')];
  const params=new URLSearchParams({latitude:points.map(item=>item.latitude.toFixed(6)).join(','),longitude:points.map(item=>item.longitude.toFixed(6)).join(',')});
  const response=await fetch(`https://api.open-meteo.com/v1/elevation?${params}`);if(!response.ok)throw new Error(`terrain-${response.status}`);const data=await response.json(),elevations=data.elevation||[];
  const samples=points.map((item,index)=>({...item,elevation:finite(elevations[index])})).filter(item=>item.elevation!=null);if(samples.length!==points.length)throw new Error('terrain-incomplete');
  const center=samples[0].elevation,downwind=samples.filter(item=>item.role==='downwind'),allElevations=samples.map(item=>item.elevation),crosswind=samples.filter(item=>item.role==='crosswind');
  return{samples,center,end:downwind.at(-1).elevation,rise:Math.max(0,...downwind.map(item=>item.elevation-center)),drop:Math.min(0,...downwind.map(item=>item.elevation-center)),range:Math.max(...allElevations)-Math.min(...allElevations),crossDifference:Math.abs(crosswind[0].elevation-crosswind[1].elevation),bearing};
}

async function ensureTerrainProfile(summary){
  const latitude=finite($('windLatitude').value),longitude=finite($('windLongitude').value),bearing=scentDegrees(summary.dominantDegrees);if(latitude==null||longitude==null)return null;const key=`${latitude.toFixed(5)}:${longitude.toFixed(5)}:${Math.round(bearing)}`;
  if(state.terrainKey===key&&state.terrainProfile)return state.terrainProfile;
  try{state.terrainProfile=await fetchTerrainProfile(latitude,longitude,bearing);state.terrainKey=key;return state.terrainProfile}catch(error){console.warn('Terrain profile unavailable',error);state.terrainProfile=null;state.terrainKey='';return null}
}

function describeTerrain(terrain){
  if(!terrain)return'Профиль высот не загрузился, поэтому влияние рельефа в эту оценку не включено.';
  const change=terrain.end-terrain.center,changeText=`за 6 км высота меняется с ${Math.round(terrain.center)} до ${Math.round(terrain.end)} м (${change>=0?'+':''}${Math.round(change)} м)`;
  if(terrain.range<=25&&Math.abs(change)<=20)return`Коридор относительно ровный: ${changeText}. Выраженного рельефного препятствия по цифровой модели не видно.`;
  if(terrain.rise>=45&&change>20)return`Шлейф направлен на заметный подъем: ${changeText}, максимальный подъем по профилю +${Math.round(terrain.rise)} м. Склон способен поднимать и деформировать поток, а за перегибом возможны завихрения.`;
  if(terrain.drop<=-45&&change<-20)return`Шлейф направлен вниз по рельефу: ${changeText}, максимальное снижение ${Math.round(terrain.drop)} м. Местный склоновый поток может усиливать перенос вниз, но ночью способен отличаться от ветра на высоте 10 м.`;
  return`Рельеф неоднородный: ${changeText}, общий перепад в выборке ${Math.round(terrain.range)} м, поперечная разница ${Math.round(terrain.crossDifference)} м. Вероятны локальные отклонения и дробление шлейфа.`;
}

function currentTaskMode(){return document.querySelector('[name="windTask"]:checked')?.value==='ptp'?'ptp':'pss'}
function stabilityLabel(value){if(value>=.75)return{label:'высокая',text:'направления хорошо складываются в один основной шлейф'};if(value>=.5)return{label:'средняя',text:'основной сектор заметен, но ветер частично менялся'};if(value>=.25)return{label:'низкая',text:'ветер был переменным, одной средней стрелки недостаточно'};return{label:'очень низкая',text:'направления заметно компенсировали друг друга'}}
function scentConditionLabel(score){if(score>=70)return'хорошие';if(score>=40)return'средние';if(score>=16)return'низкие';return'очень низкие'}
function assessScentConditions(rows,mode=currentTaskMode()){
  const usable=rows.filter(row=>row.speed!=null),scores=[],weatherRows=usable.filter(row=>row.temp!=null||row.rh!=null||row.precip!=null).length,weather=weatherStats(usable);
  usable.forEach(row=>{
    const speed=Number(row.speed||0),gust=Number(row.gust||0),temp=finite(row.temp),rh=finite(row.rh),precip=finite(row.precip);let score=62;
    if(speed<.5)score-=20;else if(speed<=4)score+=10;else if(speed<=8)score-=8;else score-=24;
    if(gust>0&&gust/Math.max(speed,.2)>=2)score-=10;
    if(rh!=null){if(rh>=55&&rh<=88)score+=8;else if(rh<30)score-=20;else if(rh<45)score-=10;else if(rh>96)score-=5}
    if(temp!=null){if(mode==='ptp'){if(temp<=-15)score-=28;else if(temp<=-5)score-=17;else if(temp>=0&&temp<=18)score+=4;else if(temp>30)score-=15}else{if(temp<=-20)score-=14;else if(temp>=0&&temp<=20)score+=6;else if(temp>30)score-=18}}
    if(precip!=null&&precip>0){const snowLike=temp!=null&&temp<=1;if(snowLike)score-=mode==='ptp'?(precip>=1?24:14):(precip>=1?10:4);else if(precip>=5)score-=24;else if(precip>=1)score-=12;else score-=4}
    scores.push(clamp(score,0,100));
  });
  const score=scores.length?scores.reduce((sum,value)=>sum+value,0)/scores.length:0,coverage=usable.length?weatherRows/usable.length:0,limited=coverage<.5;
  return{mode,score:Math.round(score),label:scentConditionLabel(score),coverage,limited,weather,modeLabel:mode==='ptp'?'ПТП':'ПСС',modeDescription:mode==='ptp'?'для поиска погибшего: мороз и снег сильнее ограничивают выход запаха':'для поиска живого человека на поверхности: учитывается тепловой поток тела'};
}

function describePtpPlume(summary,assessment,terrain){
  const weather=assessment.weather,gustFactor=summary.dominantAverage?summary.maxGust/summary.dominantAverage:0;let shape,shapeText;
  if(summary.consistency>=.72&&gustFactor<1.8){shape='Относительно направленный шлейф';shapeText=`ветер большую часть периода сохранял общий сектор, поэтому основной коридор вероятнее вытягивался ${directionTo(scentDegrees(summary.dominantDegrees))}.`}
  else if(summary.consistency>=.42){shape='Переменный шлейф';shapeText=`основной перенос шел ${directionTo(scentDegrees(summary.dominantDegrees))}, но смена направлений и порывы могли периодически смещать его в соседние секторы.`}
  else{shape='Широкий и разорванный шлейф';shapeText='направления заметно менялись, поэтому ориентироваться только на среднюю стрелку нельзя: следовало проверять несколько соседних секторов.'}
  const weatherParts=[];
  if(weather.humidityAverage!=null)weatherParts.push(`влажность в среднем ${Math.round(weather.humidityAverage)}% (${Math.round(weather.humidityMin)}–${Math.round(weather.humidityMax)}%)`);
  if(weather.temperatureAverage!=null)weatherParts.push(`температура ${round(weather.temperatureAverage)} °C (${round(weather.temperatureMin)}…${round(weather.temperatureMax)} °C)`);
  if(weather.precipitationTotal!=null)weatherParts.push(`осадки ${round(weather.precipitationTotal)} мм за ${weather.wetHours} ч`);
  let moisture='Данных о влажности и осадках недостаточно для отдельного вывода.';
  if(weather.humidityAverage!=null){if(weather.humidityAverage>=70)moisture='Высокая влажность могла дольше удерживать запах у влажной поверхности, но туман и насыщенный воздух способны делать его менее направленным.';else if(weather.humidityAverage<40)moisture='Сухой воздух и поверхность могли ускорять рассеивание и ослаблять устойчивость запахового следа.';else moisture='Умеренная влажность сама по себе не выглядит главным ограничивающим фактором.'}
  if(weather.precipitationTotal>0)moisture+=weather.temperatureAverage!=null&&weather.temperatureAverage<=1?' Снег или холодные осадки могли дополнительно закрывать источник запаха.':' Осадки могли прибивать часть запаха к поверхности и одновременно ослаблять воздушный шлейф.';
  return{shape,shapeText,weatherText:weatherParts.length?weatherParts.join('; '):'температура, влажность и осадки в источнике не представлены',moisture,terrainText:describeTerrain(terrain)};
}

function renderBriefSummary(summary,meta,assessment){
  const share=Math.round(summary.bins[summary.dominant].count/summary.total*100),stability=stabilityLabel(summary.consistency),distance=meta.distance;
  const ptp=assessment.mode==='ptp'?describePtpPlume(summary,assessment,meta.terrain):null;
  $('windBriefSummary').innerHTML=`<ul><li><strong>${escapeHtml(windName(summary.dominantDegrees))}</strong> преобладал ${share}% учтенного времени: воздух двигался ${escapeHtml(directionFrom(summary.dominantDegrees))} ${escapeHtml(directionTo(scentDegrees(summary.dominantDegrees)))}.</li><li>Средняя скорость в основном секторе — <strong>${round(summary.dominantAverage)} м/с</strong>, максимальный порыв — <strong>${round(summary.maxGust)} м/с</strong>.</li><li>Вероятный основной перенос запаха — <strong>${escapeHtml(directionTo(scentDegrees(summary.dominantDegrees)))}.</strong></li><li>Устойчивость направления — <strong>${stability.label}</strong>: ${stability.text}.</li><li>Оценка условий ${assessment.modeLabel} — <strong>${assessment.label}, ${assessment.score}/100</strong>: ${assessment.modeDescription}.${assessment.limited?' Температура, влажность или осадки доступны не для большинства строк, поэтому оценка ограничена данными ветра.':''}</li>${distance>50?`<li>Метеостанция удалена примерно на <strong>${round(distance)} км</strong>; местный ветер может отличаться.</li>`:''}</ul>${ptp?`<section class="wind-ptp-analysis"><h4>Как предположительно распространялся запах для ПТП</h4><p><strong>${escapeHtml(ptp.shape)}.</strong> ${escapeHtml(capitalize(ptp.shapeText))}</p><ul><li><strong>Погода:</strong> ${escapeHtml(ptp.weatherText)}.</li><li><strong>Влажность и осадки:</strong> ${escapeHtml(ptp.moisture)}</li><li><strong>Рельеф:</strong> ${escapeHtml(ptp.terrainText)}</li></ul><p class="wind-analysis-warning">Расчет использует погоду на высоте 10 м и цифровой рельеф 90 м. Лес, здания, овраги меньшего масштаба, состояние тела и реальный ветер у земли модель не видит.</p></section>`:''}<p>Это ориентировочная рабочая сводка. На месте проверьте ветер у земли, рельеф, лес, застройку и показания собаки.</p>`;
}

function polarPoint(cx,cy,radius,degrees){const radians=(degrees-90)*Math.PI/180;return[cx+Math.cos(radians)*radius,cy+Math.sin(radians)*radius]}
function drawSector(ctx,cx,cy,inner,outer,start,end,color){ctx.beginPath();ctx.arc(cx,cy,outer,(start-90)*Math.PI/180,(end-90)*Math.PI/180);ctx.arc(cx,cy,inner,(end-90)*Math.PI/180,(start-90)*Math.PI/180,true);ctx.closePath();ctx.fillStyle=color;ctx.fill()}
function drawOutlinedText(ctx,text,x,y,color){ctx.save();ctx.font='700 15px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.strokeStyle='#fff';ctx.lineWidth=4;ctx.strokeText(text,x,y);ctx.fillStyle=color;ctx.fillText(text,x,y);ctx.restore()}
function drawArrow(ctx,cx,cy,degrees,radius,color,label,pointsToCenter=false){const [x,y]=polarPoint(cx,cy,radius,degrees),startX=pointsToCenter?x:cx,startY=pointsToCenter?y:cy,endX=pointsToCenter?cx:x,endY=pointsToCenter?cy:y,angle=Math.atan2(endY-startY,endX-startX);ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(endX,endY);ctx.stroke();ctx.beginPath();ctx.moveTo(endX,endY);ctx.lineTo(endX-Math.cos(angle-.45)*18,endY-Math.sin(angle-.45)*18);ctx.lineTo(endX-Math.cos(angle+.45)*18,endY-Math.sin(angle+.45)*18);ctx.closePath();ctx.fill();ctx.restore();const labelAngle=(degrees-90)*Math.PI/180,[labelX,labelY]=polarPoint(cx,cy,radius*.62,degrees),offset=19;drawOutlinedText(ctx,label,labelX-Math.sin(labelAngle)*offset,labelY+Math.cos(labelAngle)*offset,color)}

function drawRose(summary,meta){
  const canvas=$('windRoseCanvas'),ctx=canvas.getContext('2d'),dark=document.documentElement.dataset.theme==='dark';canvas.width=900;canvas.height=900;const bg=dark?'#24272a':'#ffffff',ink=dark?'#edf0f2':'#23272a',grid=dark?'#50585d':'#cfd5d8';ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle=ink;ctx.textAlign='center';ctx.font='700 28px Arial';ctx.fillText('Роза ветров',450,40);ctx.font='16px Arial';ctx.fillStyle=dark?'#b8c0c5':'#667078';ctx.fillText(`${meta.place} · ${currentTaskMode()==='ptp'?'ПТП':'ПСС'}`,450,68);ctx.fillText(`${formatPeriod(meta.start)} — ${formatPeriod(meta.end)}`,450,93);
  const cx=450,cy=465,radius=310,maxCount=Math.max(...summary.bins.map(bin=>bin.count),1);
  ctx.strokeStyle=grid;ctx.lineWidth=1;for(let ring=1;ring<=5;ring+=1){ctx.beginPath();ctx.arc(cx,cy,radius*ring/5,0,Math.PI*2);ctx.stroke();ctx.fillStyle=dark?'#abb3b8':'#6f777b';ctx.font='12px Arial';ctx.textAlign='left';ctx.fillText(`${Math.round(maxCount/summary.total*ring/5*100)}%`,cx+5,cy-radius*ring/5+15)}
  for(let index=0;index<16;index+=1){const degrees=index*22.5,[x,y]=polarPoint(cx,cy,radius,degrees);ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();const bin=summary.bins[index];let inner=0;bin.classes.forEach((count,classIndex)=>{if(!count)return;const outer=inner+radius*count/maxCount;drawSector(ctx,cx,cy,inner,outer,degrees-8.5,degrees+8.5,SPEED_COLORS[classIndex]);inner=outer});const [lx,ly]=polarPoint(cx,cy,radius+30,degrees);ctx.fillStyle=ink;ctx.font=`${index===summary.dominant?'700':'500'} 15px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(DIRECTIONS[index],lx,ly)}
  drawArrow(ctx,cx,cy,summary.dominantDegrees,radius*.72,'#c83d3d',`Ветер ${directionFrom(summary.dominantDegrees)}`,true);drawArrow(ctx,cx,cy,scentDegrees(summary.dominantDegrees),radius*.58,'#2f7d66',`Запах ${directionTo(scentDegrees(summary.dominantDegrees))}`);
  ctx.textBaseline='alphabetic';ctx.textAlign='center';ctx.fillStyle=ink;ctx.font='700 20px Arial';ctx.fillText(`${windName(summary.dominantDegrees)}: ${Math.round(summary.bins[summary.dominant].count/summary.total*100)}% времени`,450,835);ctx.font='15px Arial';ctx.fillStyle=dark?'#b8c0c5':'#667078';ctx.fillText(`Средняя сила ${round(summary.dominantAverage)} м/с · максимальный порыв ${round(summary.maxGust)} м/с`,450,864);
}

function destination(latitude,longitude,bearing,distanceKm=8){const radius=6371,br=bearing*Math.PI/180,lat1=latitude*Math.PI/180,lon1=longitude*Math.PI/180,lat2=Math.asin(Math.sin(lat1)*Math.cos(distanceKm/radius)+Math.cos(lat1)*Math.sin(distanceKm/radius)*Math.cos(br)),lon2=lon1+Math.atan2(Math.sin(br)*Math.sin(distanceKm/radius)*Math.cos(lat1),Math.cos(distanceKm/radius)-Math.sin(lat1)*Math.sin(lat2));return[lat2*180/Math.PI,lon2*180/Math.PI]}
function drawMapDirections(summary,meta){
  if(!state.map)return;state.windLayers.clearLayers();const lat=finite($('windLatitude').value),lon=finite($('windLongitude').value),from=destination(lat,lon,summary.dominantDegrees,6),to=destination(lat,lon,scentDegrees(summary.dominantDegrees),6);
  L.polyline([from,[lat,lon]],{color:'#c83d3d',weight:5,opacity:.85}).addTo(state.windLayers);L.circleMarker(from,{radius:7,color:'#c83d3d',fillOpacity:1}).bindTooltip(`Ветер приходил ${directionFrom(summary.dominantDegrees)}`,{permanent:false}).addTo(state.windLayers);
  L.polyline([[lat,lon],to],{color:'#2f7d66',weight:5,dashArray:'9 7',opacity:.9}).addTo(state.windLayers);L.circleMarker(to,{radius:7,color:'#2f7d66',fillOpacity:1}).bindTooltip(`Запах переносило ${directionTo(scentDegrees(summary.dominantDegrees))}`,{permanent:false}).addTo(state.windLayers);
  if(currentTaskMode()==='ptp'&&meta?.terrain){const center=meta.terrain.center;meta.terrain.samples.filter(item=>item.role==='downwind').forEach(item=>{const delta=Math.round(item.elevation-center);L.circleMarker([item.latitude,item.longitude],{radius:4,color:'#fff',weight:2,fillColor:'#286f63',fillOpacity:1}).bindTooltip(`${item.name}: ${Math.round(item.elevation)} м (${delta>=0?'+':''}${delta} м от точки поиска)`).addTo(state.windLayers)})}
  state.map.fitBounds(L.latLngBounds([from,to]).pad(.45));
}

function renderResult(summary,meta,{scroll=true}={}){
  state.summary=summary;state.meta=meta;$('windResult').hidden=false;$('windResultPlace').textContent=meta.place;$('windSourceBadge').textContent=meta.source;
  const mode=currentTaskMode(),assessment=assessScentConditions(state.rows,mode),share=Math.round(summary.bins[summary.dominant].count/summary.total*100);
  $('windDominantDirection').textContent=windName(summary.dominantDegrees);$('windDominantShare').textContent=`Дул ${directionFrom(summary.dominantDegrees)} · ${share}% учтенного времени`;
  $('windDominantSpeed').textContent=`${round(summary.dominantAverage)} м/с`;$('windMaxGust').textContent=summary.maxGust?`${round(summary.maxGust)} м/с`:'Нет данных';$('windScentDirection').textContent=capitalize(directionTo(scentDegrees(summary.dominantDegrees)));
  $('windTaskResultLabel').textContent=`Условия ${assessment.modeLabel}`;$('windScentCondition').textContent=`${capitalize(assessment.label)} · ${assessment.score}/100`;$('windScentConditionNote').textContent=assessment.limited?'оценка ограничена доступными полями':'для запахового шлейфа';
  const distance=meta.distance;$('windResultNote').textContent=`${windName(summary.dominantDegrees)} приходил ${directionFrom(summary.dominantDegrees)}, поэтому основной перенос запаха показан ${directionTo(scentDegrees(summary.dominantDegrees))}.${distance>50?` Метеостанция удалена на ${round(distance)} км — учитывайте возможные местные отличия.`:''}`;
  renderBriefSummary(summary,meta,assessment);$('windDataMeta').innerHTML=`<p><strong>Источник:</strong> ${escapeHtml(meta.source)}</p><p><strong>Место:</strong> ${escapeHtml(meta.place)}</p><p><strong>Тип поиска:</strong> ${assessment.modeLabel}</p>${meta.station?`<p><strong>Метеостанция:</strong> ${escapeHtml(meta.station)}</p>`:''}<p><strong>Период:</strong> ${escapeHtml(formatPeriod(meta.start))} — ${escapeHtml(formatPeriod(meta.end))}</p><p><strong>Строк данных:</strong> ${state.rows.length}; учтено ${summary.total}; штиль или неполные строки: ${summary.ignored}.</p>${meta.terrain&&assessment.mode==='ptp'?'<p><strong>Рельеф:</strong> Copernicus DEM GLO-90 через Open-Meteo Elevation API; высоты рассчитаны в точке поиска и вдоль шлейфа.</p>':''}<p>Исходные почасовые значения сохраняются в памяти страницы до следующего построения и доступны для скачивания.</p>`;
  drawRose(summary,meta);drawMapDirections(summary,meta);updateCompassVisual();if(scroll)$('windResult').scrollIntoView({behavior:'smooth',block:'start'});
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
    if(!rows.length)throw new Error('period-empty');state.rows=rows;const summary=analyzeRows(rows);if(currentTaskMode()==='ptp'){setMessage('Анализирую рельеф по направлению запаха…');meta.terrain=await ensureTerrainProfile(summary)}renderResult(summary,meta);setMessage(meta.terrain?'Роза ветров и профиль рельефа построены.':'Роза ветров построена.','success');
  }catch(error){console.error(error);const messages={'rp5-required':'Сначала выберите CSV-файл с RP5.','rp5-period':'В файле RP5 нет наблюдений за выбранные часы. Проверьте период.','period-empty':'Источник не вернул данных за выбранный период.','no-wind-data':'За выбранный период нет ветра сильнее 0,5 м/с или отсутствуют направления.'};setMessage(messages[error.message]||'Не удалось получить метеоданные. Проверьте интернет, период и выбранный источник.','error')}
  finally{button.disabled=false}
}

function downloadBlob(blob,fileName){const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=fileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
function saveImage(){if(!state.summary)return;const canvas=$('windRoseCanvas');canvas.toBlob(blob=>blob&&downloadBlob(blob,`roza-vetrov-${dateOnly(state.meta.start)}.png`),'image/png')}
function saveData(){
  if(!state.rows.length)return;const lines=['time;wind_direction_deg;wind_direction;wind_speed_ms;wind_gust_ms;temperature_c;humidity_percent;precipitation_mm',...state.rows.map(row=>[row.time||'',row.dir??'',row.dir==null?'':directionName(row.dir),row.speed??'',row.gust??'',row.temp??'',row.rh??'',row.precip??''].join(';'))],text='\uFEFF'+lines.join('\r\n');downloadBlob(new Blob([text],{type:'text/csv;charset=utf-8'}),`wind-data-${dateOnly(state.meta.start)}.csv`);
}

export function initWindRose(){
  setDefaultPeriod();initMap();
  $('windPlaceSearchBtn').onclick=searchPlace;$('windPlaceSearch').addEventListener('input',schedulePlaceSuggestions);$('windPlaceSearch').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();searchPlace()}});$('windLocateBtn').onclick=locateUser;
  ['windLatitude','windLongitude'].forEach(id=>$(id).addEventListener('change',()=>setLocation(finite($('windLatitude').value),finite($('windLongitude').value),'Точка по координатам')));
  document.querySelectorAll('[name="windSource"]').forEach(input=>input.onchange=sourceChanged);$('windRp5File').onchange=event=>rp5Selected(event.target.files[0]);$('windPickStationBtn').onclick=()=>refreshNearbyStations(true);
  document.querySelectorAll('[name="windTask"]').forEach(input=>input.onchange=async()=>{if(!state.summary||!state.meta)return;if(currentTaskMode()==='ptp'&&!state.meta.terrain){setMessage('Добавляю профиль рельефа для ПТП…');state.meta.terrain=await ensureTerrainProfile(state.summary)}renderResult(state.summary,state.meta,{scroll:false});setMessage(state.meta.terrain&&currentTaskMode()==='ptp'?'Профиль рельефа добавлен.':'Тип поиска изменен.','success')});
  document.querySelectorAll('[data-wind-hours]').forEach(button=>button.onclick=()=>setDefaultPeriod(Number(button.dataset.windHours)));$('windRoseForm').onsubmit=buildRose;$('windSaveImageBtn').onclick=saveImage;$('windSaveDataBtn').onclick=saveData;
  return{onShow(){initMap();setTimeout(()=>state.map?.invalidateSize(),0);if(state.summary)drawRose(state.summary,state.meta)},onTheme(){if(state.summary)drawRose(state.summary,state.meta)}};
}
