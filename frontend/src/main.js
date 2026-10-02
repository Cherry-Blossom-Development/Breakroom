import './assets/main.css'
import './assets/mobile.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { safeHtmlDirective } from './utilities/sanitizeHtml'

const app = createApp(App)

app.use(createPinia())
app.use(router)
// v-safe-html: v-html for user-written HTML, sanitized (utilities/sanitizeHtml.js)
app.directive('safe-html', safeHtmlDirective)

app.mount('#app')
