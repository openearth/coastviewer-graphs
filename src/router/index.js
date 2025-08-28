import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'

const routes = [
  // optional numeric slug; default is handled inside Home.vue
  { path: String.raw`/:transect(\d+)?`, name: 'Home', component: Home },
  // legacy root redirect (optional)
  { path: '/', redirect: { name: 'Home' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
