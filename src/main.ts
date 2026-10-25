import './lib/theme'
import './assets/app.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

if (import.meta.env.PROD && !window.pineaseDesktop?.isDesktop && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {})
  })
}
