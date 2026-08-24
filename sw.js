const CACHE='kpc-orientirovka-v25';
const ASSETS=['./','./index.html','./styles.css','./app-v5.js?v=25','./firebase-config.js','./manifest.webmanifest','./template.jpg','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(
    fetch(e.request).then(resp=>{
      const copy=resp.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return resp;
    }).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('./index.html')))
  );
});
