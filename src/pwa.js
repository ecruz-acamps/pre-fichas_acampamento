// Registra o service worker (só em produção; em desenvolvimento atrapalharia o recarregamento).
export function registrarPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}) })
}
