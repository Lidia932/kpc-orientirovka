const TRACK_COLORS=['#d43d3d','#2878c8','#15956d','#8b52b8','#e07a1f','#177f91','#bd4e91','#5d7d29','#5b61cf','#9b6426'];
const DEFAULT_CENTER=[54.32,48.4];

const byLocalName=(root,name)=>[...root.getElementsByTagName('*')].filter(node=>node.localName===name);
const finiteCoordinate=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;
const point=(lat,lng,time='',elevation=null)=>({lat:Number(lat),lng:Number(lng),time,elevation:Number.isFinite(Number(elevation))?Number(elevation):null});

function parseXml(text){
  const documentNode=new DOMParser().parseFromString(text,'application/xml');
  if(documentNode.querySelector('parsererror'))throw new Error('track-map-invalid');
  return documentNode;
}

function nodeText(node,name){return byLocalName(node,name)[0]?.textContent?.trim()||''}

function parseGpx(documentNode){
  const segments=[];
  byLocalName(documentNode,'trkseg').forEach(segment=>{
    const points=byLocalName(segment,'trkpt').map(node=>point(Number(node.getAttribute('lat')),Number(node.getAttribute('lon')),nodeText(node,'time'),nodeText(node,'ele'))).filter(item=>finiteCoordinate(item.lat,item.lng));
    if(points.length)segments.push(points);
  });
  byLocalName(documentNode,'rte').forEach(route=>{
    const points=byLocalName(route,'rtept').map(node=>point(Number(node.getAttribute('lat')),Number(node.getAttribute('lon')),nodeText(node,'time'),nodeText(node,'ele'))).filter(item=>finiteCoordinate(item.lat,item.lng));
    if(points.length)segments.push(points);
  });
  if(!segments.length){
    const points=byLocalName(documentNode,'wpt').map(node=>point(Number(node.getAttribute('lat')),Number(node.getAttribute('lon')),nodeText(node,'time'),nodeText(node,'ele'))).filter(item=>finiteCoordinate(item.lat,item.lng));
    if(points.length)segments.push(points);
  }
  return segments;
}

function parseKml(documentNode){
  const segments=[];
  byLocalName(documentNode,'LineString').forEach(line=>{
    const raw=nodeText(line,'coordinates');
    const points=raw.split(/\s+/).map(value=>{
      const [lng,lat,elevation]=value.split(',').map(Number);
      return point(lat,lng,'',elevation);
    }).filter(item=>finiteCoordinate(item.lat,item.lng));
    if(points.length)segments.push(points);
  });
  byLocalName(documentNode,'Track').forEach(track=>{
    const times=byLocalName(track,'when').map(node=>node.textContent.trim());
    const points=byLocalName(track,'coord').map((node,index)=>{
      const [lng,lat,elevation]=node.textContent.trim().split(/\s+/).map(Number);
      return point(lat,lng,times[index]||'',elevation);
    }).filter(item=>finiteCoordinate(item.lat,item.lng));
    if(points.length)segments.push(points);
  });
  return segments;
}

function parseTcx(documentNode){
  const segments=[];
  byLocalName(documentNode,'Track').forEach(track=>{
    const points=byLocalName(track,'Trackpoint').map(node=>point(Number(nodeText(node,'LatitudeDegrees')),Number(nodeText(node,'LongitudeDegrees')),nodeText(node,'Time'),nodeText(node,'AltitudeMeters'))).filter(item=>finiteCoordinate(item.lat,item.lng));
    if(points.length)segments.push(points);
  });
  return segments;
}

async function parseKmz(file){
  const {unzipSync,strFromU8}=await import('./vendor/fflate.js');
  const entries=unzipSync(new Uint8Array(await file.arrayBuffer()));
  const name=Object.keys(entries).find(entry=>entry.toLowerCase().endsWith('.kml'));
  if(!name)throw new Error('track-map-invalid');
  return parseKml(parseXml(strFromU8(entries[name])));
}

async function parseFit(file){
  const [{default:Decoder},{default:Stream}]=await Promise.all([import('./vendor/fitsdk/src/decoder.js'),import('./vendor/fitsdk/src/stream.js')]);
  const stream=Stream.fromArrayBuffer(await file.arrayBuffer());
  if(!Decoder.isFIT(stream))throw new Error('track-map-invalid');
  const decoder=new Decoder(stream),result=decoder.read();
  const records=result.messages?.recordMesgs||[];
  const toDegrees=value=>Math.abs(value)>180?value*180/2147483648:value;
  const points=records.map(record=>point(toDegrees(Number(record.positionLat)),toDegrees(Number(record.positionLong)),record.timestamp instanceof Date?record.timestamp.toISOString():String(record.timestamp||''),record.altitude)).filter(item=>finiteCoordinate(item.lat,item.lng));
  return points.length?[points]:[];
}

async function parseTrack(file,extension){
  if(extension==='kmz')return parseKmz(file);
  if(extension==='fit')return parseFit(file);
  if(extension==='gpx.bin'){
    const bytes=new Uint8Array(await file.arrayBuffer()),start=new TextDecoder().decode(bytes.slice(0,100)).trimStart();
    if(!start.startsWith('<'))return parseFit(file);
    return parseGpx(parseXml(new TextDecoder().decode(bytes)));
  }
  const documentNode=parseXml(await file.text());
  if(extension==='gpx')return parseGpx(documentNode);
  if(extension==='kml')return parseKml(documentNode);
  if(extension==='tcx')return parseTcx(documentNode);
  throw new Error('track-map-format');
}

function distanceBetween(a,b){
  const radius=6371000,toRadians=value=>value*Math.PI/180;
  const dLat=toRadians(b.lat-a.lat),dLng=toRadians(b.lng-a.lng),lat1=toRadians(a.lat),lat2=toRadians(b.lat);
  const value=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*radius*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));
}

function trackDistance(segments){
  return segments.reduce((total,segment)=>total+segment.slice(1).reduce((sum,item,index)=>sum+distanceBetween(segment[index],item),0),0);
}

function distanceText(meters){return meters>=1000?`${(meters/1000).toFixed(meters>=10000?1:2)} км`:`${Math.round(meters)} м`}

export function initTrackMap({getTracks,fetchTrackFile,trackExtension,getAuthorName}){
  const $=id=>document.getElementById(id),dialog=$('trackMapDialog'),button=$('openTrackMapBtn');
  let map=null,baseLayer=null,currentBasemap='street',tracks=[],selected=new Set(),layers=new Map(),cache=new Map(),loading=new Map();

  const baseMaps={
    street:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',options:{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}},
    topo:{url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',options:{maxZoom:17,attribution:'Карта: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, <a href="https://opentopomap.org">OpenTopoMap</a>'}},
    satellite:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',options:{maxZoom:19,attribution:'Sources: Esri and the GIS User Community'}}
  };

  function ensureMap(){
    if(map)return;
    map=L.map('trackMapCanvas',{center:DEFAULT_CENTER,zoom:11,zoomControl:true});
    setBasemap(currentBasemap);
  }

  function setBasemap(name){
    currentBasemap=baseMaps[name]?name:'street';
    if(!map)return;
    if(baseLayer)map.removeLayer(baseLayer);
    const config=baseMaps[currentBasemap];
    baseLayer=L.tileLayer(config.url,config.options).addTo(map);
  }

  function selectedLayers(){return [...selected].map(id=>layers.get(id)).filter(Boolean)}

  function fitVisible(){
    if(!map)return;
    const visible=selectedLayers();
    if(!visible.length)return;
    const bounds=L.featureGroup(visible).getBounds();
    if(bounds.isValid())map.fitBounds(bounds.pad(.12),{maxZoom:16});
  }

  function setMessage(text,error=false){$('trackMapMessage').textContent=text;$('trackMapMessage').classList.toggle('error',error)}

  function updateCount(){
    const ready=[...selected].filter(id=>layers.has(id)).length,total=selected.size;
    $('trackMapSelectedCount').textContent=total?ready===total?`На карте: ${total}`:`Загружено: ${ready} из ${total}`:'Не выбраны';
  }

  function popupContent(track,segments){
    const root=document.createElement('div');root.className='track-map-popup';
    const name=document.createElement('strong');name.textContent=track.fileName;
    const author=document.createElement('span');author.textContent=getAuthorName(track);
    const distance=document.createElement('span');distance.textContent=`Длина: ${distanceText(trackDistance(segments))}`;
    root.append(name,author,distance);return root;
  }

  function createLayer(track,segments,color){
    const group=L.featureGroup(),popup=popupContent(track,segments);
    segments.forEach(segment=>{
      const coordinates=segment.map(item=>[item.lat,item.lng]);
      if(coordinates.length===1)L.circleMarker(coordinates[0],{radius:6,color,fillColor:color,fillOpacity:.85,weight:2}).bindPopup(popup.cloneNode(true)).addTo(group);
      else L.polyline(coordinates,{color,weight:5,opacity:.9,lineCap:'round',lineJoin:'round'}).bindPopup(popup.cloneNode(true)).addTo(group);
    });
    return group;
  }

  function rowFor(id){return $('trackMapList').querySelector(`[data-track-id="${CSS.escape(id)}"]`)}

  function setRowState(id,state,text=''){
    const row=rowFor(id);if(!row)return;
    row.dataset.state=state;row.querySelector('.track-map-row-state').textContent=text;
  }

  async function showTrack(track,index,fitAfter=true){
    if(layers.has(track.id)){layers.get(track.id).addTo(map);updateCount();if(fitAfter)fitVisible();return}
    if(loading.has(track.id))return loading.get(track.id);
    setRowState(track.id,'loading','Загружаю…');setMessage(`Загружаю «${track.fileName}»…`);
    const promise=(async()=>{
      try{
        let segments=cache.get(track.id);
        if(!segments){const file=await fetchTrackFile(track);segments=await parseTrack(file,trackExtension(track.fileName));if(!segments.length)throw new Error('track-map-empty');cache.set(track.id,segments)}
        if(!selected.has(track.id))return;
        const layer=createLayer(track,segments,TRACK_COLORS[index%TRACK_COLORS.length]);layers.set(track.id,layer);layer.addTo(map);
        setRowState(track.id,'ready',distanceText(trackDistance(segments)));setMessage('Отмеченные маршруты показаны на карте.');
        updateCount();if(fitAfter)fitVisible();
      }catch(error){
        console.error(error);selected.delete(track.id);const input=rowFor(track.id)?.querySelector('input');if(input)input.checked=false;
        setRowState(track.id,'error','Не удалось прочитать');setMessage(`Не удалось показать «${track.fileName}». Файл повреждён или не содержит координат.`,true);updateCount();
      }finally{loading.delete(track.id)}
    })();loading.set(track.id,promise);return promise;
  }

  function hideTrack(id){const layer=layers.get(id);if(layer&&map.hasLayer(layer))map.removeLayer(layer);updateCount();if(selected.size)fitVisible();else setMessage('Отметьте треки, которые нужно показать.')}

  async function toggleTrack(track,index,checked){
    if(checked){selected.add(track.id);await showTrack(track,index)}else{selected.delete(track.id);hideTrack(track.id)}
  }

  function renderList(){
    const list=$('trackMapList');list.replaceChildren();
    tracks.forEach((track,index)=>{
      const label=document.createElement('label');label.className='track-map-row';label.dataset.trackId=track.id;
      const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(track.id);
      const swatch=document.createElement('i');swatch.style.setProperty('--track-color',TRACK_COLORS[index%TRACK_COLORS.length]);
      const text=document.createElement('span');const name=document.createElement('strong'),meta=document.createElement('small'),state=document.createElement('small');
      name.textContent=track.fileName;meta.textContent=getAuthorName(track);state.className='track-map-row-state';state.textContent=cache.has(track.id)?distanceText(trackDistance(cache.get(track.id))):'';
      text.append(name,meta,state);label.append(input,swatch,text);input.onchange=()=>toggleTrack(track,index,input.checked);list.append(label);
    });
  }

  function open(){
    tracks=getTracks();if(!tracks.length)return;
    const ids=new Set(tracks.map(track=>track.id));selected=new Set([...selected].filter(id=>ids.has(id)));
    renderList();dialog.showModal();ensureMap();requestAnimationFrame(()=>{map.invalidateSize();fitVisible()});updateCount();
  }

  function close(){dialog.close()}

  async function selectAll(){
    tracks.forEach(track=>selected.add(track.id));renderList();updateCount();setMessage(`Загружаю треки: 0 из ${tracks.length}.`);
    for(let index=0;index<tracks.length;index+=1){if(!selected.has(tracks[index].id))continue;await showTrack(tracks[index],index,false);setMessage(`Загружаю треки: ${index+1} из ${tracks.length}.`)}
    fitVisible();if(selected.size)setMessage('Все доступные маршруты показаны на карте.');
  }

  function clear(){selected.forEach(id=>hideTrack(id));selected.clear();renderList();updateCount();setMessage('Отметьте треки, которые нужно показать.')}

  function render(){
    tracks=getTracks();button.disabled=!tracks.length;button.hidden=!tracks.length;
    const ids=new Set(tracks.map(track=>track.id));
    [...layers].forEach(([id,layer])=>{if(ids.has(id))return;if(map&&map.hasLayer(layer))map.removeLayer(layer);layers.delete(id);cache.delete(id);selected.delete(id)});
    if(dialog.open){renderList();updateCount()}
  }

  button.onclick=open;$('trackMapCloseBtn').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
  document.querySelectorAll('input[name="trackBasemap"]').forEach(input=>input.onchange=()=>{if(input.checked)setBasemap(input.value)});
  $('trackMapSelectAllBtn').onclick=selectAll;$('trackMapClearBtn').onclick=clear;
  $('trackMapPanelToggle').onclick=()=>{const body=$('trackMapPanelBody'),expanded=!body.hidden;body.hidden=expanded;$('trackMapPanelToggle').setAttribute('aria-expanded',String(!expanded));$('trackMapPanelToggle').textContent=expanded?'⌃':'⌄';setTimeout(()=>map?.invalidateSize(),50)};
  return{render,open,close};
}
