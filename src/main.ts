performance.mark('app-start')

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './styles/global.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// ── Global error handlers ──
// Catch unhandled errors in Vue component lifecycle, watchers, and event handlers.
app.config.errorHandler = (err, _instance, info) => {
  console.error('[Vue Error]', info, err)
  // Avoid infinite loop: don't re-throw or trigger reactive updates here
}

// Catch unhandled promise rejections (e.g. fetch failures, async IPC calls).
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Unhandled Promise]', event.reason)
})

app.mount('#app')
