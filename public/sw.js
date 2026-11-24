// Service worker do PWA. Regra de ouro: NADA de dados pessoais fica guardado no aparelho.
//  - /api/* e páginas HTML: sempre da rede (nunca em cache). Sem internet, mostra /offline.html.
//  - /assets/* (arquivos com hash no nome, públicos): cache, para abrir mais rápido.
const VERSAO = 'v2'
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

// Avisos no celular (Web Push). O texto vem do servidor e nunca traz dado pessoal.
self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = {} }
  const titulo = typeof d.titulo === 'string' ? d.titulo.slice(0, 80) : 'Acampamento'
  const texto = typeof d.texto === 'string' ? d.texto.slice(0, 200) : 'Há uma novidade na sua pré-ficha.'
  e.waitUntil(self.registration.showNotification(titulo, { body: texto, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'situacao-prefixa', renotify: true, data: { url: '/' } }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  // só abre páginas do próprio site
  const alvo = new URL('/', self.location.origin).href
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
    for (const j of janelas) if (j.url.startsWith(self.location.origin) && 'focus' in j) { j.navigate?.(alvo); return j.focus() }
    return self.clients.openWindow(alvo)
  }))
})
