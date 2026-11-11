import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '../styles.css'
import { registrarPwa } from '../pwa.js'
import { carregarModalidades } from '../lib/modalidades.js'

registrarPwa()

carregarModalidades().finally(() => createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
))
