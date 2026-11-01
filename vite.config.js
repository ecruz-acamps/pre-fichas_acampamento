import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Duas páginas, servidas pelo próprio servidor Node em produção:
//   /        -> formulário público de pré-ficha
//   /admin/  -> painel da fila de espera (somente usuários autorizados)
export default defineConfig({
  plugins: [react()],
  // Em desenvolvimento, o Vite repassa /api para o servidor Node (npm run dev:api).
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
})
