import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'

const routes = [
  // slug is the *transect number value*, not the index
  { path: String.raw`/:transectNum(\d+)?`, name: 'Home', component: Home },
  // ensure root works too
  { path: '/', redirect: { name: 'Home' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
