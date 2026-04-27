const SourceEditor = () => import('../views/SourceEditor.vue')

export const sourceRoutes = [
  {
    path: '/bookSource',
    name: 'book-home',
    component: SourceEditor,
  },
  {
    path: '/rssSource',
    name: 'rss-home',
    component: SourceEditor,
  },
]
