import { createWebHashHistory, createRouter } from 'vue-router'
import { bookRoutes } from './bookRouter'
import { sourceRoutes } from './sourceRouter'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [bookRoutes, sourceRoutes].flat(),
})

router.afterEach(to => {
  const routeTitles: Record<string, string> = {
    shelf: '书架',
    chapter: '阅读',
    'book-home': '书源管理',
    'rss-home': '订阅源管理',
  }
  const routeTitle = routeTitles[String(to.name)]
  document.title = routeTitle ? `${routeTitle} - 阅读 Web 端` : '阅读 Web 端'
})

export default router
