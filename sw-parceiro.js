/* Service worker minimo da Area do Parceiro (D104).
 * REGRA DE SEGURANCA: so guarda em cache ARQUIVOS ESTATICOS PUBLICOS do proprio site (/assets/...).
 * NUNCA guarda dado de aluno, resposta do banco (Supabase), resposta autenticada, POST, nem pagina HTML.
 * Tudo que nao for estatico do proprio site passa direto para a rede (o service worker nem responde).
 * Para mudar o que fica em cache, troque o numero da versao em CACHE (os caches antigos sao apagados). */
var CACHE = 'ferafit-parceiros-estaticos-v1';
var OFFLINE_URL = '/offline-parceiro.html';
var ESTATICO = /\.(?:css|js|png|jpe?g|svg|webp|ico|woff2?|json)$/i;

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.add(OFFLINE_URL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n.indexOf('ferafit-parceiros-') === 0 && n !== CACHE; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') { return; }                         // nunca mexe em POST/PUT/DELETE
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) { return; }          // Supabase, ViaCEP, imagens externas: rede direta
  if (req.headers.has('authorization') || req.headers.has('apikey')) { return; } // requisicao autenticada: rede direta
  if (req.mode === 'navigate') {                                // paginas: sempre da rede; sem rede, so a tela offline
    event.respondWith(fetch(req).catch(function () { return caches.match(OFFLINE_URL); }));
    return;
  }
  if (url.pathname.indexOf('/assets/') !== 0 || !ESTATICO.test(url.pathname)) { return; }
  event.respondWith(
    fetch(req).then(function (res) {
      var cc = res.headers.get('cache-control') || '';
      if (res.ok && res.type === 'basic' && !res.headers.has('set-cookie') && !/no-store|private/i.test(cc)) {
        var copia = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copia); });
      }
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
