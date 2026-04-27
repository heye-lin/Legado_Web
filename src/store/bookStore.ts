import { defineStore } from 'pinia'
import API from '@api'
import type { BaseBook, Book, BookChapter, BookProgress } from '@/book'
import type { webReadConfig } from '@/web'
import {
  createDefaultReadConfig,
  normalizeReadConfig,
} from '@/config/readConfig'
import { ElMessage } from 'element-plus/es'

let webReadConfigLoaded = false

export const useBookStore = defineStore('book', {
  state: () => {
    return {
      shelf: [] as Book[],
      catalog: [] as BookChapter[],
      readingBook: { chapterPos: 0, chapterIndex: 0 } as BaseBook & {
        chapterPos: number
        chapterIndex: number
        isSearchBook?: boolean
      },
      popCataVisible: false,
      contentLoading: true,
      showContent: false,
      config: createDefaultReadConfig(),
      miniInterface: false,
      readSettingsVisible: false,
    }
  },
  getters: {
    bookProgress: (state): BookProgress | undefined => {
      if (state.catalog.length === 0) return
      const { bookUrl, chapterIndex, chapterPos, name, author } =
        state.readingBook
      const title = state.catalog[chapterIndex]?.title
      if (!title || !bookUrl) return
      return {
        name,
        author,
        bookUrl,
        durChapterIndex: chapterIndex,
        durChapterPos: chapterPos,
        durChapterTime: Date.now(),
        durChapterTitle: title,
      }
    },
    theme: state => {
      return state.config.theme
    },
    isNight: state => state.config.theme === 6,
  },
  actions: {
    /** 从本地数据源强制刷新书架书籍 */
    async refreshBookShelf(): Promise<Book[]> {
      const resp = await API.getBookShelf()
      const { isSuccess, data, errorMsg } = resp.data
      if (isSuccess === true) {
        if (
          this.shelf.length !== data.length &&
          this.shelf.length > 0 &&
          data.length > 0
        ) {
          ElMessage.info(`书架数据已更新`)
        }
        this.shelf = data.sort((a, b) => {
          const x = a.durChapterTime || 0
          const y = b.durChapterTime || 0
          return y - x
        })
      } else if (errorMsg?.includes('还没有添加小说') && this.shelf.length > 0) {
        ElMessage.info('当前书架上的书籍已经被删除')
        this.shelf = []
      } else {
        ElMessage.error(errorMsg ?? '本地书架数据格式错误！')
      }
      return this.shelf
    },
    /** 从本地数据源加载书架书籍，默认优先返回内存缓存 */
    async loadBookShelf(force = false): Promise<Book[]> {
      if (this.shelf.length > 0 && !force) {
        void this.refreshBookShelf()
        return this.shelf
      }
      return this.refreshBookShelf()
    },
    /** 从本地数据源加载书籍目录，优先返回内存缓存 */
    async loadWebCatalog(
      book: typeof this.readingBook,
    ): Promise<BookChapter[]> {
      const { bookUrl, name, chapterIndex } = book
      const fetchChapterList = API.getChapterList(bookUrl).then(res => {
        const { isSuccess, data, errorMsg } = res.data
        if (isSuccess === false) {
          ElMessage.error(errorMsg)
          throw new Error(errorMsg)
        }
        if (
          bookUrl === this.readingBook.bookUrl &&
          data.length !== this.catalog.length &&
          data.length > 0 &&
          this.catalog.length > 0
        ) {
          ElMessage.info(`书籍${name}: 章节目录已更新`)
        }
        this.catalog = data
        return this.catalog
      })
      if (
        bookUrl === this.readingBook.bookUrl &&
        this.catalog.length > 0 &&
        this.catalog.length - 1 >= chapterIndex
      ) {
        return this.catalog
      }
      return fetchChapterList
    },
    setPopCataVisible(visible: boolean) {
      this.popCataVisible = visible
    },
    setContentLoading(loading: boolean) {
      this.contentLoading = loading
    },
    setReadingBook(readingBook: typeof this.readingBook) {
      this.readingBook = readingBook
    },
    /** 只加载一次 Web 阅读配置 */
    async loadWebConfig() {
      if (!webReadConfigLoaded) {
        const config = await API.getReadConfig()
        webReadConfigLoaded = true
        return this.setConfig(config)
      }
    },
    setConfig(config?: webReadConfig) {
      this.config = normalizeReadConfig(config)
    },
    setReadSettingsVisible(visible: boolean) {
      this.readSettingsVisible = visible
    },
    setShowContent(visible: boolean) {
      this.showContent = visible
    },
    setMiniInterface(mini: boolean) {
      this.miniInterface = mini
    },
    /** 1.保存进度到浏览器本地 2.修改内存中的数据 */
    async saveBookProgress() {
      const progress = this.bookProgress
      if (progress === undefined) return

      const { bookUrl } = this.readingBook
      const shelfRaw = toRaw(this.shelf)
      const findIndex = shelfRaw.findIndex(book => book.bookUrl === bookUrl)
      if (findIndex > -1) {
        this.shelf[findIndex] = { ...shelfRaw[findIndex], ...progress }
      }
      return API.saveBookProgressWithBeacon(progress)
    },
  },
})
