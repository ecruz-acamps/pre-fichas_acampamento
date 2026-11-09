// Service worker do PWA. Regra de ouro: NADA de dados pessoais fica guardado no aparelho.
//  - /api/* e páginas HTML: sempre da rede (nunca em cache). Sem internet, mostra /offline.html.
//  - /assets/* (arquivos com hash no nome, públicos): cache, para abrir mais rápido.
const VERSAO = 'v1'
const CACHE = `prefichas-${VERSAO}`
const OFFLINE = '/offline.html'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/offline.css', '/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return   // rede direta, sem cache

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)))
    return
  }
  if (url.pathname.startsWith('/assets/') || url.pathname === '/offline.css') {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const guardado = await c.match(req)
      if (guardado) return guardado
      const resp = await fetch(req)
      if (resp.ok) c.put(req, resp.clone())
      return resp
    }))
  }
})
