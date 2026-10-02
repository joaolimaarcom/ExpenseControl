/* Painel — service worker
   A página vem da rede primeiro, com o cache como rede de segurança;
   ícones e manifesto vêm do cache, com atualização em segundo plano.
   Chamadas para Firebase e para o proxy da IA nunca são cacheadas.
   Ao publicar uma alteração, suba o VERSAO abaixo. */

const VERSAO = 'painel-v13';
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
  const dinamico = /googleapis|gstatic|firebase|workers\.dev/.test(url.hostname);

  // rede direta para APIs e SDKs
  if (dinamico) return;

  /* A página em si vem da rede quando dá. Servi-la do cache fazia o app
     abrir com o código da versão anterior depois de cada publicação — e
     código velho calculando saldo mostra número errado, que é pior do que
     demorar um instante a mais. Sem rede, o cache assume e o app abre
     igual. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(resp => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(VERSAO).then(c => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // ícones e manifesto: cache primeiro, atualiza depois
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
