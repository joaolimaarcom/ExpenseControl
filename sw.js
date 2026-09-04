/* Painel — service worker
   Estratégia: shell em cache com revalidação em segundo plano.
   Chamadas para Firebase e Groq nunca são cacheadas.
   Ao publicar uma alteração, suba o VERSAO abaixo. */

const VERSAO = 'painel-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSAO).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const externo = url.origin !== self.location.origin;
  const dinamico = /googleapis|gstatic|firebase|groq/.test(url.hostname);

  // rede direta para APIs e SDKs
  if (dinamico) return;

  // shell e assets próprios: cache primeiro, atualiza depois
  if (!externo) {
    e.respondWith(
      caches.match(req).then(hit => {
        const rede = fetch(req).then(resp => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(VERSAO).then(c => c.put(req, copia));
          }
          return resp;
        }).catch(() => hit);
        return hit || rede;
      })
    );
  }
});
