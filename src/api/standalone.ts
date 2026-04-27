import type {
  BaseBook,
  Book,
  BookChapter,
  BookProgress,
  SeachBook,
} from '@/book'
import type { BookSoure, RssSource, Source } from '@/source'
import type { webReadConfig } from '@/web'
import type { LeagdoApiResponse } from './api'

const DB_NAME = 'legado-web-standalone'
const DB_VERSION = 1
const BOOK_STORE = 'books'
const CHAPTER_STORE = 'chapters'

const CONFIG_KEY = 'legado.standalone.readConfig'
const BOOK_SOURCE_KEY = 'legado.standalone.bookSources'
const RSS_SOURCE_KEY = 'legado.standalone.rssSources'

const STANDALONE_BACKUP_VERSION = 1

const DEFAULT_CONFIG: webReadConfig = {
  theme: 0,
  font: 0,
  fontSize: 18,
  readWidth: 800,
  infiniteLoading: false,
  customFontName: '',
  jumpDuration: 1000,
  spacing: {
    paragraph: 1,
    line: 0.8,
    letter: 0,
  },
}

type ApiResult<T> = Promise<{ data: LeagdoApiResponse<T> }>
export type StandaloneBackupChapter = BookChapter & {
  id: string
  content: string
}
type ChapterRecord = StandaloneBackupChapter

export type StandaloneBackupData = {
  version: 1
  exportedAt: string
  readConfig: webReadConfig
  bookSources: BookSoure[]
  rssSources: RssSource[]
  books: Book[]
  chapters: StandaloneBackupChapter[]
}

type StoreName = typeof BOOK_STORE | typeof CHAPTER_STORE

let dbPromise: Promise<IDBDatabase> | undefined

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const ok = <T>(data: T, errorMsg = ''): { data: LeagdoApiResponse<T> } => ({
  data: { isSuccess: true, errorMsg, data },
})

const fail = <T>(
  errorMsg: string,
  data: T = undefined as T,
): { data: LeagdoApiResponse<T> } => ({
  data: { isSuccess: false, errorMsg, data },
})

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const openDatabase = () => {
  if (dbPromise !== undefined) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(BOOK_STORE)) {
        db.createObjectStore(BOOK_STORE, { keyPath: 'bookUrl' })
      }
      if (!db.objectStoreNames.contains(CHAPTER_STORE)) {
        const chapterStore = db.createObjectStore(CHAPTER_STORE, {
          keyPath: 'id',
        })
        chapterStore.createIndex('bookUrl', 'bookUrl', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

const readonlyStore = async <T>(
  storeName: StoreName,
  run: (store: IDBObjectStore) => Promise<T>,
) => {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readonly')
  const store = tx.objectStore(storeName)
  return run(store)
}

const waitForTransaction = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })

const readwriteStore = async <T>(
  storeName: StoreName,
  run: (store: IDBObjectStore) => Promise<T>,
) => {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const done = waitForTransaction(tx)
  const store = tx.objectStore(storeName)
  try {
    const result = await run(store)
    await done
    return result
  } catch (error) {
    try {
      tx.abort()
    } catch {}
    throw error
  }
}

const transaction = async <T>(
  storeNames: StoreName[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T> | T,
) => {
  const db = await openDatabase()
  const tx = db.transaction(storeNames, mode)
  const done = waitForTransaction(tx)
  try {
    const result = await run(tx)
    await done
    return result
  } catch (error) {
    try {
      if (tx.error === null) tx.abort()
    } catch {}
    throw error
  }
}

const getAllBooks = () =>
  readonlyStore<Book[]>(BOOK_STORE, store => requestToPromise(store.getAll()))

const getBook = (bookUrl: string) =>
  readonlyStore<Book | undefined>(BOOK_STORE, store =>
    requestToPromise(store.get(bookUrl)),
  )

const chapterId = (bookUrl: string, index: number) => `${bookUrl}#${index}`

const getChapterRecords = (bookUrl: string) =>
  readonlyStore<ChapterRecord[]>(CHAPTER_STORE, store =>
    requestToPromise(store.index('bookUrl').getAll(bookUrl)),
  ).then(records => records.sort((a, b) => a.index - b.index))

const getChapterRecord = (bookUrl: string, index: number) =>
  readonlyStore<ChapterRecord | undefined>(CHAPTER_STORE, store =>
    requestToPromise(store.get(chapterId(bookUrl, index))),
  )

const getAllChapterRecords = () =>
  readonlyStore<ChapterRecord[]>(CHAPTER_STORE, store =>
    requestToPromise(store.getAll()),
  ).then(records =>
    records.sort(
      (a, b) => a.bookUrl.localeCompare(b.bookUrl) || a.index - b.index,
    ),
  )

const deleteChapterRecords = (chapterStore: IDBObjectStore, bookUrl: string) =>
  new Promise<void>((resolve, reject) => {
    const cursorRequest = chapterStore
      .index('bookUrl')
      .openCursor(IDBKeyRange.only(bookUrl))

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (cursor === null) {
        resolve()
        return
      }
      cursor.delete()
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error)
  })

const saveBookWithChapters = (book: Book, chapters: ChapterRecord[]) =>
  transaction([BOOK_STORE, CHAPTER_STORE], 'readwrite', async tx => {
    const bookStore = tx.objectStore(BOOK_STORE)
    const chapterStore = tx.objectStore(CHAPTER_STORE)
    await deleteChapterRecords(chapterStore, book.bookUrl)
    bookStore.put(book)
    for (const chapter of chapters) {
      chapterStore.put(chapter)
    }
  })

const readJson = <T>(key: string, fallback: T): T => {
  const raw = localStorage.getItem(key)
  if (raw === null) return clone(fallback)
  try {
    return JSON.parse(raw) as T
  } catch {
    localStorage.removeItem(key)
    return clone(fallback)
  }
}

const writeJson = <T>(key: string, value: T) => {
  localStorage.setItem(key, JSON.stringify(value))
}

const removeJson = (key: string) => {
  localStorage.removeItem(key)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const ensureArray = (value: unknown, fieldName: string): unknown[] => {
  if (!Array.isArray(value)) {
    throw new Error(`备份数据 ${fieldName} 必须是数组`)
  }
  return value
}

const ensureReadConfig = (value: unknown): webReadConfig => {
  if (!isRecord(value) || !isRecord(value.spacing)) {
    throw new Error('备份数据 readConfig 结构不正确')
  }

  const spacing = value.spacing
  const numberFields = [
    'theme',
    'font',
    'fontSize',
    'readWidth',
    'jumpDuration',
  ]
  const spacingFields = ['paragraph', 'line', 'letter']
  const hasInvalidNumber = numberFields.some(
    field => typeof value[field] !== 'number',
  )
  const hasInvalidSpacing = spacingFields.some(
    field => typeof spacing[field] !== 'number',
  )

  if (
    hasInvalidNumber ||
    hasInvalidSpacing ||
    typeof value.infiniteLoading !== 'boolean' ||
    typeof value.customFontName !== 'string'
  ) {
    throw new Error('备份数据 readConfig 字段类型不正确')
  }

  return value as webReadConfig
}

const ensureBookSources = (sources: unknown[]): BookSoure[] => {
  sources.forEach((source, index) => {
    if (
      !isRecord(source) ||
      typeof source.bookSourceUrl !== 'string' ||
      typeof source.bookSourceName !== 'string'
    ) {
      throw new Error(`备份数据 bookSources[${index}] 结构不正确`)
    }
  })
  return sources as BookSoure[]
}

const ensureRssSources = (sources: unknown[]): RssSource[] => {
  sources.forEach((source, index) => {
    if (
      !isRecord(source) ||
      typeof source.sourceUrl !== 'string' ||
      typeof source.sourceName !== 'string'
    ) {
      throw new Error(`备份数据 rssSources[${index}] 结构不正确`)
    }
  })
  return sources as RssSource[]
}

const ensureBooks = (books: unknown[]): Book[] => {
  books.forEach((book, index) => {
    if (
      !isRecord(book) ||
      typeof book.bookUrl !== 'string' ||
      typeof book.name !== 'string' ||
      typeof book.author !== 'string'
    ) {
      throw new Error(`备份数据 books[${index}] 结构不正确`)
    }
  })
  return books as Book[]
}

const ensureChapters = (chapters: unknown[]): StandaloneBackupChapter[] => {
  chapters.forEach((chapter, index) => {
    if (
      !isRecord(chapter) ||
      typeof chapter.id !== 'string' ||
      typeof chapter.bookUrl !== 'string' ||
      typeof chapter.index !== 'number' ||
      typeof chapter.content !== 'string'
    ) {
      throw new Error(`备份数据 chapters[${index}] 结构不正确`)
    }
  })
  return chapters as StandaloneBackupChapter[]
}

const parseStandaloneBackupData = (data: unknown): StandaloneBackupData => {
  if (!isRecord(data)) {
    throw new Error('备份数据必须是对象')
  }
  if (data.version !== STANDALONE_BACKUP_VERSION) {
    throw new Error(`不支持的备份版本：${String(data.version)}`)
  }
  if (typeof data.exportedAt !== 'string') {
    throw new Error('备份数据 exportedAt 必须是字符串')
  }

  const readConfig = ensureReadConfig(data.readConfig)
  const bookSources = ensureBookSources(
    ensureArray(data.bookSources, 'bookSources'),
  )
  const rssSources = ensureRssSources(
    ensureArray(data.rssSources, 'rssSources'),
  )
  const books = ensureBooks(ensureArray(data.books, 'books'))
  const chapters = ensureChapters(ensureArray(data.chapters, 'chapters'))

  return {
    version: STANDALONE_BACKUP_VERSION,
    exportedAt: data.exportedAt,
    readConfig,
    bookSources,
    rssSources,
    books,
    chapters,
  }
}

const replaceIndexedData = (
  books: Book[],
  chapters: StandaloneBackupChapter[],
) =>
  transaction([BOOK_STORE, CHAPTER_STORE], 'readwrite', tx => {
    const bookStore = tx.objectStore(BOOK_STORE)
    const chapterStore = tx.objectStore(CHAPTER_STORE)
    bookStore.clear()
    chapterStore.clear()
    books.forEach(book => bookStore.put(book))
    chapters.forEach(chapter => chapterStore.put(chapter))
  })

const clearIndexedData = () =>
  transaction([BOOK_STORE, CHAPTER_STORE], 'readwrite', tx => {
    tx.objectStore(BOOK_STORE).clear()
    tx.objectStore(CHAPTER_STORE).clear()
  })

const sourceStorageKey = () =>
  /bookSource/i.test(location.href) ? BOOK_SOURCE_KEY : RSS_SOURCE_KEY

const isBookSource = (source: Source): source is BookSoure =>
  'bookSourceUrl' in source

const sourceUniqueKey = (source: Source) =>
  isBookSource(source) ? source.bookSourceUrl : (source as RssSource).sourceUrl

const defaultSourceList = (): Source[] =>
  /bookSource/i.test(location.href)
    ? [
        {
          bookSourceUrl: 'https://example.com',
          bookSourceName: '纯 Web 示例书源',
          bookSourceGroup: '示例',
          bookSourceType: 0,
          customOrder: 0,
          enabled: true,
          enabledExplore: false,
          lastUpdateTime: Date.now(),
          respondTime: 0,
          weight: 0,
          searchUrl: 'https://example.com/search?q={{key}}',
          ruleSearch: {
            checkKeyWord: '示例',
            bookList: '.book',
            name: '.title@text',
            author: '.author@text',
            bookUrl: 'a@href',
          },
          ruleBookInfo: {},
          ruleToc: {},
          ruleContent: {},
          ruleExplore: {},
          bookSourceComment:
            '纯浏览器版会保存书源配置；跨站抓取受浏览器 CORS 限制，完整 Legado 规则引擎需要后续单独实现。',
        } as BookSoure,
      ]
    : [
        {
          sourceUrl: 'https://example.com/rss.xml',
          sourceName: '纯 Web 示例订阅源',
          sourceIcon: '',
          sourceGroup: '示例',
          sourceComment:
            '纯浏览器版会保存订阅源配置；读取远程内容取决于目标站是否允许 CORS。',
          enabled: true,
          singleUrl: true,
          articleStyle: 0,
          enableJs: false,
          loadWithBaseUrl: false,
          lastUpdateTime: Date.now(),
          customOrder: 0,
        } as RssSource,
      ]

const readSources = () => {
  const key = sourceStorageKey()
  const raw = localStorage.getItem(key)
  if (raw !== null) {
    try {
      const sources = JSON.parse(raw)
      if (Array.isArray(sources)) return sources as Source[]
    } catch {}
    localStorage.removeItem(key)
  }

  const initialSources = defaultSourceList()
  writeJson(key, initialSources)
  return initialSources
}

const writeSources = (sources: Source[]) =>
  writeJson(sourceStorageKey(), sources)

const normalizeText = (text: string) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()

const chapterTitlePattern =
  /^\s*((第\s*[\d零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节卷回集部篇].{0,50})|(序章|楔子|引子|前言|后记|终章|番外).{0,50}|(chapter|section)\s+\d+.{0,60})\s*$/i

const isChapterTitle = (line: string) => {
  const title = line.trim()
  return (
    title.length > 0 && title.length <= 80 && chapterTitlePattern.test(title)
  )
}

type ParsedChapter = { title: string; content: string }

const splitTextByLength = (
  text: string,
  maxLength = 12000,
): ParsedChapter[] => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
  const chapters: ParsedChapter[] = []
  let buffer: string[] = []
  let bufferLength = 0

  const flush = () => {
    if (buffer.length === 0) return
    const index = chapters.length + 1
    chapters.push({ title: `第 ${index} 章`, content: buffer.join('\n\n') })
    buffer = []
    bufferLength = 0
  }

  for (const paragraph of paragraphs) {
    if (bufferLength > 0 && bufferLength + paragraph.length > maxLength) {
      flush()
    }
    buffer.push(paragraph)
    bufferLength += paragraph.length
  }
  flush()

  if (chapters.length === 0 && text.length > 0) {
    chapters.push({ title: '正文', content: text })
  }
  return chapters
}

const parseTextChapters = (rawText: string): ParsedChapter[] => {
  const text = normalizeText(rawText)
  const lines = text.split('\n')
  const titles: { lineIndex: number; title: string }[] = []

  lines.forEach((line, lineIndex) => {
    if (isChapterTitle(line)) {
      titles.push({ lineIndex, title: line.trim() })
    }
  })

  if (titles.length < 2) return splitTextByLength(text)

  const chapters: ParsedChapter[] = []
  const preface = lines.slice(0, titles[0].lineIndex).join('\n').trim()
  if (preface.length > 0) {
    chapters.push({ title: '前言', content: preface })
  }

  titles.forEach((current, index) => {
    const next = titles[index + 1]
    const content = lines
      .slice(current.lineIndex + 1, next?.lineIndex ?? lines.length)
      .join('\n')
      .trim()
    chapters.push({ title: current.title, content: content || current.title })
  })

  return chapters
}

const readTextFile = async (file: File) => {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  const brokenChars = utf8.match(/\uFFFD/g)?.length ?? 0
  if (brokenChars <= Math.max(20, utf8.length * 0.001)) return utf8

  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return utf8
  }
}

const bookUrlFromFile = (file: File) =>
  `local-book://${encodeURIComponent(file.name)}/${file.size}/${file.lastModified}`

const bookNameFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '')

const chapterToRecord = (
  bookUrl: string,
  chapter: ParsedChapter,
  index: number,
): ChapterRecord => ({
  id: chapterId(bookUrl, index),
  url: `${bookUrl}/chapter/${index}`,
  title: chapter.title,
  isVolume: false,
  baseUrl: bookUrl,
  bookUrl,
  index,
  isVip: false,
  isPay: true,
  content: chapter.content,
})

const buildBook = (file: File, chapters: ParsedChapter[]): Book => {
  const now = Date.now()
  const bookUrl = bookUrlFromFile(file)
  const latestChapterTitle = chapters.at(-1)?.title ?? '正文'

  return {
    name: bookNameFromFile(file),
    author: '本地导入',
    bookUrl,
    tocUrl: bookUrl,
    origin: 'local',
    originName: file.name,
    type: 0,
    group: 0,
    latestChapterTitle,
    latestChapterTime: now,
    lastCheckTime: now,
    lastCheckCount: 0,
    totalChapterNum: chapters.length,
    durChapterTitle: chapters[0]?.title ?? '正文',
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTime: now,
    canUpdate: false,
    order: now,
    originOrder: 0,
    syncTime: now,
  }
}

const placeholderCover = (label: string) => {
  const safeLabel = label
    .replace(
      /[<>&"]/g,
      char =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[char]!,
    )
    .slice(0, 8)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="224" viewBox="0 0 168 224"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#6b8afd"/><stop offset="1" stop-color="#8f5cf7"/></linearGradient></defs><rect width="168" height="224" rx="14" fill="url(#g)"/><rect x="18" y="22" width="132" height="180" rx="8" fill="rgba(255,255,255,.14)" stroke="rgba(255,255,255,.38)"/><text x="84" y="108" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="22" font-family="serif" font-weight="700">${safeLabel}</text><text x="84" y="142" dominant-baseline="middle" text-anchor="middle" fill="rgba(255,255,255,.75)" font-size="14">Pure Web</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const toSearchBook = (book: Book): SeachBook => ({
  name: book.name,
  author: book.author,
  bookUrl: book.bookUrl,
  kind: book.kind,
  wordCount: book.wordCount,
  variable: book.variable,
  origin: book.origin,
  originName: book.originName,
  type: book.type,
  coverUrl: book.coverUrl,
  intro: book.intro,
  latestChapterTitle: book.latestChapterTitle,
  tocUrl: book.tocUrl,
  time: Date.now(),
  originOrder: book.originOrder,
  chapterWordCountText: book.wordCount,
  // The upstream d.ts keeps the original Android-side field name.
  chapterWordCount: 0,
  respondTime: 0,
})

const sameBook = (book: BaseBook, progress: BookProgress) =>
  progress.bookUrl.length > 0
    ? book.bookUrl === progress.bookUrl
    : book.name === progress.name && book.author === progress.author

const getReadConfig = async (): Promise<webReadConfig | undefined> =>
  readJson(CONFIG_KEY, DEFAULT_CONFIG)

const saveReadConfig = async (config: webReadConfig): ApiResult<string> => {
  writeJson(CONFIG_KEY, config)
  return ok('阅读配置已保存到浏览器')
}

const saveBookProgress = async (
  bookProgress: BookProgress,
): ApiResult<string> => {
  const books = await getAllBooks()
  const book = books.find(item => sameBook(item, bookProgress))
  if (book === undefined) return ok('没有需要保存的本地进度')

  await readwriteStore(BOOK_STORE, async store => {
    store.put({ ...book, ...bookProgress, syncTime: Date.now() })
    return undefined
  })
  return ok('阅读进度已保存到浏览器')
}

const getBookShelf = async (): ApiResult<Book[]> => {
  const books = await getAllBooks()
  books.sort((a, b) => (b.durChapterTime || 0) - (a.durChapterTime || 0))
  return ok(books)
}

const getChapterList = async (bookUrl: string): ApiResult<BookChapter[]> => {
  const chapters = await getChapterRecords(bookUrl)
  if (chapters.length === 0) return fail('这本书还没有章节，请重新导入')
  return ok(
    chapters.map(({ content: _content, id: _id, ...chapter }) => chapter),
  )
}

const getBookContent = async (
  bookUrl: string,
  chapterIndex: number,
): ApiResult<string> => {
  const chapter = await getChapterRecord(bookUrl, chapterIndex)
  if (chapter === undefined) return fail('章节不存在或已被删除')
  return ok(chapter.content)
}

const search = async (
  searchKey: string,
  onReceive: (data: SeachBook[]) => void,
  onFinish: () => void,
) => {
  const key = searchKey.trim().toLocaleLowerCase()
  const books = await getAllBooks()
  const result = books
    .filter(book => {
      const text =
        `${book.name} ${book.author} ${book.kind ?? ''}`.toLocaleLowerCase()
      return text.includes(key)
    })
    .map(toSearchBook)
  onReceive(result)
  onFinish()
}

const saveBook = async (book: BaseBook): ApiResult<string> => {
  const existed = await getBook(book.bookUrl)
  if (existed !== undefined) return ok('书籍已在本地书架')
  return fail('纯 Web 模式只能直接保存已导入到浏览器的书籍')
}

const deleteBook = async (book: BaseBook): ApiResult<string> => {
  await transaction([BOOK_STORE, CHAPTER_STORE], 'readwrite', async tx => {
    const bookStore = tx.objectStore(BOOK_STORE)
    const chapterStore = tx.objectStore(CHAPTER_STORE)
    bookStore.delete(book.bookUrl)
    await deleteChapterRecords(chapterStore, book.bookUrl)
  })
  return ok('书籍已从浏览器删除')
}

const importLocalTextBook = async (file: File): ApiResult<Book> => {
  if (
    !file.name.toLocaleLowerCase().endsWith('.txt') &&
    file.type !== 'text/plain'
  ) {
    return fail('当前纯 Web 版本仅支持导入 TXT 文本书籍')
  }

  const text = await readTextFile(file)
  const parsedChapters = parseTextChapters(text)
  const book = buildBook(file, parsedChapters)
  const chapterRecords = parsedChapters.map((chapter, index) =>
    chapterToRecord(book.bookUrl, chapter, index),
  )

  await saveBookWithChapters(book, chapterRecords)
  return ok(book)
}

const getSources = async (): ApiResult<Source[]> => ok(readSources())

const saveSource = async (source: Source): ApiResult<string> => {
  const map = new Map(readSources().map(item => [sourceUniqueKey(item), item]))
  map.set(sourceUniqueKey(source), source)
  writeSources(Array.from(map.values()))
  return ok('源已保存到浏览器')
}

const saveSources = async (sources: Source[]): ApiResult<Source[]> => {
  writeSources(sources)
  return ok(sources)
}

const deleteSource = async (sources: Source[]): ApiResult<string> => {
  const deleteKeys = new Set(sources.map(sourceUniqueKey))
  writeSources(
    readSources().filter(source => !deleteKeys.has(sourceUniqueKey(source))),
  )
  return ok('源已从浏览器删除')
}

const debug = (
  sourceUrl: string,
  searchKey: string,
  onReceive: (data: string) => void,
  onFinish: () => void,
) => {
  const messages = [
    '纯 Web 模式已接管源编辑器，不再依赖阅读 App。',
    `当前源：${sourceUrl || '未填写'}`,
    searchKey ? `搜索关键字：${searchKey}` : '当前订阅源调试没有搜索关键字。',
    '说明：完整 Legado 规则调试依赖 Android/Rhino 与无 CORS 网络访问能力；浏览器纯前端只能调试允许 CORS 的站点，规则引擎需要后续按 Web 标准单独实现。',
  ]
  messages.forEach((message, index) => {
    window.setTimeout(() => onReceive(message), index * 80)
  })
  window.setTimeout(onFinish, messages.length * 80)
}

const exportStandaloneData = async (): ApiResult<StandaloneBackupData> => {
  const [books, chapters] = await Promise.all([
    getAllBooks(),
    getAllChapterRecords(),
  ])

  return ok({
    version: STANDALONE_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    readConfig: readJson(CONFIG_KEY, DEFAULT_CONFIG),
    bookSources: readJson<BookSoure[]>(BOOK_SOURCE_KEY, []),
    rssSources: readJson<RssSource[]>(RSS_SOURCE_KEY, []),
    books,
    chapters,
  })
}

const importStandaloneData = async (
  data: StandaloneBackupData,
): ApiResult<string> => {
  try {
    const backup = parseStandaloneBackupData(data)
    await replaceIndexedData(backup.books, backup.chapters)
    writeJson(CONFIG_KEY, backup.readConfig)
    writeJson(BOOK_SOURCE_KEY, backup.bookSources)
    writeJson(RSS_SOURCE_KEY, backup.rssSources)
    return ok('浏览器本地数据已从备份导入')
  } catch (error) {
    return fail(error instanceof Error ? error.message : '导入备份失败')
  }
}

const clearStandaloneData = async (): ApiResult<string> => {
  await clearIndexedData()
  removeJson(CONFIG_KEY)
  removeJson(BOOK_SOURCE_KEY)
  removeJson(RSS_SOURCE_KEY)
  return ok('浏览器本地数据已清空')
}

const getProxyCoverUrl = (coverUrl: string) => {
  if (
    coverUrl.startsWith('http') ||
    coverUrl.startsWith('data:') ||
    coverUrl.startsWith('blob:')
  ) {
    return coverUrl
  }
  return placeholderCover(decodeURIComponent(coverUrl.split('/')[2] ?? '阅读'))
}

const getProxyImageUrl = (
  _bookUrl: string,
  src: string,
  _width?: number | `${number}`,
) => src

export default {
  getReadConfig,
  saveReadConfig,
  saveBookProgress,
  saveBookProgressWithBeacon: saveBookProgress,
  getBookShelf,
  getChapterList,
  getBookContent,
  search,
  saveBook,
  deleteBook,
  importLocalTextBook,
  exportStandaloneData,
  importStandaloneData,
  clearStandaloneData,
  getSources,
  saveSource,
  saveSources,
  deleteSource,
  debug,
  getProxyCoverUrl,
  getProxyImageUrl,
}
