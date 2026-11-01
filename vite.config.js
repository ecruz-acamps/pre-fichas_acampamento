import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Duas páginas independentes, para funcionar em qualquer hospedagem estática
// sem precisar configurar rewrites:
//   /        -> formulário público de pré-ficha
//   /admin/  -> painel da fila de espera (somente usuários autorizados)
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
})
