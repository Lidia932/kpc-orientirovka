const CACHE='kpc-orientirovka-v70-separated-menu-and-home-photos';
const SHARE_CACHE='kpc-shared-tracks-v1';
const ASSETS=['./','./index.html','./styles.css?v=70','./app-v5.js?v=70','./archive-result.js?v=65','./track-map.js?v=65','./wind-rose.js?v=65','./data/weather-stations.json?v=65','./firebase-config.js','./manifest.webmanifest?v=58','./template.jpg','./icon.svg','./icon-192.png','./icon-512.png','./assets/home/hero-day.webp','./assets/home/hero-night.webp','./assets/home/tile-active.webp','./assets/home/tile-info.webp','./assets/home/tile-archive.webp','./assets/home/tile-wind.webp','./assets/home/menu/home-day.webp','./assets/home/menu/create-day.webp','./assets/home/menu/wind-day.webp','./assets/home/menu/active-day.webp','./assets/home/menu/info-day.webp','./assets/home/menu/archive-day.webp','./assets/home/menu/home-night.webp','./assets/home/menu/create-night.webp','./assets/home/menu/wind-night.webp','./assets/home/menu/active-night.webp','./assets/home/menu/info-night.webp','./assets/home/menu/archive-night.webp','./assets/home/tiles/active-day.webp','./assets/home/tiles/info-day.webp','./assets/home/tiles/archive-day.webp','./assets/home/tiles/wind-day.webp','./assets/home/tiles/active-night.webp','./assets/home/tiles/info-night.webp','./assets/home/tiles/archive-night.webp','./assets/home/tiles/wind-night.webp','./vendor/jspdf.umd.min.js','./vendor/fflate.js','./vendor/fitsdk/src/accumulator.js','./vendor/fitsdk/src/bit-stream.js','./vendor/fitsdk/src/crc-calculator.js','./vendor/fitsdk/src/decoder.js','./vendor/fitsdk/src/fit.js','./vendor/fitsdk/src/profile.js','./vendor/fitsdk/src/stream.js','./vendor/fitsdk/src/utils-hr-mesg.js','./vendor/fitsdk/src/utils-internal.js','./vendor/fitsdk/src/utils-memo-glob.js','./vendor/fitsdk/src/utils.js'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==SHARE_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method==='POST'&&url.pathname.endsWith('/share-target')){
    e.respondWith(storeSharedTracks(e.request));
    return;
  }
  if(e.request.method!=='GET') return;
  if(url.pathname.includes('/shared-tracks/')){
    e.respondWith(caches.match(e.request).then(cached=>cached||new Response('Not found',{status:404})));
    return;
  }
  e.respondWith(
    fetch(e.request).then(resp=>{
      const copy=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return resp;
    }).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('./index.html')))
  );
});

async function storeSharedTracks(request){
  const formData=await request.formData();
  const files=formData.getAll('tracks').filter(file=>file&&typeof file.name==='string'&&file.size>0);
  const batchId=self.crypto.randomUUID?self.crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cache=await caches.open(SHARE_CACHE);
  const metadata=[];
  for(let index=0;index<files.length;index+=1){
    const file=files[index];
    const fileUrl=new URL(`shared-tracks/${batchId}/${index}`,self.registration.scope).href;
    await cache.put(fileUrl,new Response(file,{headers:{'Content-Type':file.type||'application/octet-stream'}}));
    metadata.push({name:file.name,type:file.type||'application/octet-stream',size:file.size,url:fileUrl});
  }
  const metaUrl=new URL(`shared-tracks/${batchId}/meta`,self.registration.scope).href;
  await cache.put(metaUrl,new Response(JSON.stringify({files:metadata}),{headers:{'Content-Type':'application/json'}}));
  const target=new URL(`./?sharedTracks=${encodeURIComponent(batchId)}`,self.registration.scope).href;
  return Response.redirect(target,303);
}
