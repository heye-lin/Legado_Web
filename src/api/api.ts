/** https://github.com/gedoor/legado/tree/master/app/src/main/java/io/legado/app/api */
/** https://github.com/gedoor/legado/tree/master/app/src/main/java/io/legado/app/web */

import type { webReadConfig } from '@/web'
import ajax from './axios'
import standaloneApi, { type StandaloneBackupData } from './standalone'
import type {
  BaseBook,
  Book,
  BookChapter,
  BookProgress,
  SeachBook,
} from '@/book'
import type { Source } from '@/source'
import {
  type SourceKind,
  getCurrentSourceKind,
  isBookSourceKind,
} from '@/utils/sourceKind'

export type LeagdoApiResponse<T> = {
  isSuccess: boolean
  errorMsg: string
  data: T
}

type ApiResult<T> = Promise<{ data: LeagdoApiResponse<T> }>

const standaloneFlag = import.meta.env.VITE_STANDALONE
export const isStandaloneMode =
  standaloneFlag === 'true' ||
  (standaloneFlag !== 'false' && !import.meta.env.VITE_API)
export const apiTargetName = isStandaloneMode ? '浏览器本地' : '阅读3.0APP'

export let legado_http_entry_point = ''
export let legado_webSocket_entry_point = ''

let wsOnError: typeof WebSocket.prototype.onerror = () => {}
let wsOnMessage: typeof WebSocket.prototype.onmessage = () => {}
export const setWebsocketOnMessage = (callback: typeof wsOnMessage) =>
  (wsOnMessage = callback)
export const setWebsocketOnError = (callback: typeof wsOnError) => {
  //WebSocket.prototype.onerror = callback
  wsOnError = callback
}

export const setApiEntryPoint = (
  http_entry_point: string,
  webSocket_entry_point: string,
) => {
  legado_http_entry_point = new URL(http_entry_point).toString()
  legado_webSocket_entry_point = new URL(webSocket_entry_point).toString()
  ajax.defaults.baseURL = legado_http_entry_point
}

// 书架API
// Http
const appGetReadConfig = async (http_url = legado_http_entry_point) => {
  const { data } = await ajax.get<LeagdoApiResponse<string>>('getReadConfig', {
    baseURL: http_url.toString(),
    timeout: 3000,
  })
  if (data.isSuccess) {
    try {
      return JSON.parse(data.data) as webReadConfig
    } catch {}
  }
}
const getReadConfig = (http_url = legado_http_entry_point) =>
  isStandaloneMode ? standaloneApi.getReadConfig() : appGetReadConfig(http_url)

const appSaveReadConfig = (config: webReadConfig) =>
  ajax.post<LeagdoApiResponse<string>>('saveReadConfig', config)
const saveReadConfig = (config: webReadConfig) =>
  isStandaloneMode
    ? standaloneApi.saveReadConfig(config)
    : appSaveReadConfig(config)

/** @deprecated: 使用`API.saveBookProgressWithBeacon`以确保在页面或者直接关闭的情况下保存进度 */
const appSaveBookProgress = (bookProgress: BookProgress) =>
  ajax.post('saveBookProgress', bookProgress)
const saveBookProgress = (bookProgress: BookProgress) =>
  isStandaloneMode
    ? standaloneApi.saveBookProgress(bookProgress)
    : appSaveBookProgress(bookProgress)

/**主要在直接关闭浏览器情况下可靠发送书籍进度 */
const appSaveBookProgressWithBeacon = (bookProgress: BookProgress) => {
  if (!bookProgress) return
  // 常规请求可能会被取消 使用Fetch keep-alive 或者 navigator.sendBeacon
  navigator.sendBeacon(
    new URL('saveBookProgress', legado_http_entry_point),
    JSON.stringify(bookProgress),
  )
}
const saveBookProgressWithBeacon = (bookProgress: BookProgress) =>
  isStandaloneMode
    ? standaloneApi.saveBookProgressWithBeacon(bookProgress)
    : appSaveBookProgressWithBeacon(bookProgress)

const appGetBookShelf = () =>
  ajax.get<LeagdoApiResponse<Book[]>>('getBookshelf')
const getBookShelf = () =>
  isStandaloneMode ? standaloneApi.getBookShelf() : appGetBookShelf()

const appGetChapterList = (/** @type {string} */ bookUrl: string) =>
  ajax.get<LeagdoApiResponse<BookChapter[]>>(
    'getChapterList?url=' + encodeURIComponent(bookUrl),
  )
const getChapterList = (bookUrl: string) =>
  isStandaloneMode
    ? standaloneApi.getChapterList(bookUrl)
    : appGetChapterList(bookUrl)

const appGetBookContent = (
  /** @type {string} */ bookUrl: string,
  /** @type {number} */ chapterIndex: number,
) =>
  ajax.get<LeagdoApiResponse<string>>(
    'getBookContent?url=' +
      encodeURIComponent(bookUrl) +
      '&index=' +
      chapterIndex,
  )
const getBookContent = (bookUrl: string, chapterIndex: number) =>
  isStandaloneMode
    ? standaloneApi.getBookContent(bookUrl, chapterIndex)
    : appGetBookContent(bookUrl, chapterIndex)

// webSocket
const appSearch = (
  searchKey: string,
  onReceive: (data: SeachBook[]) => void,
  onFinish: () => void,
) => {
  const socket = new WebSocket(
    new URL('searchBook', legado_webSocket_entry_point),
  )
  socket.onerror = wsOnError

  socket.onopen = () => {
    socket.send(JSON.stringify({ key: searchKey }))
  }
  socket.onmessage = event => {
    try {
      onReceive(JSON.parse(event.data))
      wsOnMessage?.call(socket, event)
    } catch {
      onFinish()
    }
  }

  socket.onclose = () => {
    onFinish()
  }
}
const search = (
  searchKey: string,
  onReceive: (data: SeachBook[]) => void,
  onFinish: () => void,
) =>
  isStandaloneMode
    ? standaloneApi.search(searchKey, onReceive, onFinish)
    : appSearch(searchKey, onReceive, onFinish)

const appSaveBook = (book: BaseBook) =>
  ajax.post<LeagdoApiResponse<string>>('saveBook', book)
const saveBook = (book: BaseBook) =>
  isStandaloneMode ? standaloneApi.saveBook(book) : appSaveBook(book)

const appDeleteBook = (book: BaseBook) =>
  ajax.post<LeagdoApiResponse<string>>('deleteBook', book)
const deleteBook = (book: BaseBook) =>
  isStandaloneMode ? standaloneApi.deleteBook(book) : appDeleteBook(book)

const importLocalTextBook = (file: File) =>
  standaloneApi.importLocalTextBook(file)

const standaloneOnly = <T>(): ApiResult<T> =>
  Promise.resolve({
    data: {
      isSuccess: false,
      errorMsg: '浏览器本地数据备份仅支持纯 Web 模式',
      data: undefined as T,
    },
  })

const exportStandaloneData = () =>
  isStandaloneMode
    ? standaloneApi.exportStandaloneData()
    : standaloneOnly<StandaloneBackupData>()

const importStandaloneData = (data: StandaloneBackupData) =>
  isStandaloneMode
    ? standaloneApi.importStandaloneData(data)
    : standaloneOnly<string>()

const clearStandaloneData = () =>
  isStandaloneMode
    ? standaloneApi.clearStandaloneData()
    : standaloneOnly<string>()

// 源编辑API
// Http
const appGetSources = (kind: SourceKind) =>
  isBookSourceKind(kind)
    ? ajax.get('getBookSources')
    : ajax.get('getRssSources')
const getSources = (kind: SourceKind = getCurrentSourceKind()) =>
  isStandaloneMode ? standaloneApi.getSources(kind) : appGetSources(kind)

const appSaveSource = (data: Source, kind: SourceKind) =>
  isBookSourceKind(kind)
    ? ajax.post<LeagdoApiResponse<string>>('saveBookSource', data)
    : ajax.post<LeagdoApiResponse<string>>('saveRssSource', data)
const saveSource = (data: Source, kind: SourceKind = getCurrentSourceKind()) =>
  isStandaloneMode
    ? standaloneApi.saveSource(data, kind)
    : appSaveSource(data, kind)

const appSaveSources = (data: Source[], kind: SourceKind) =>
  isBookSourceKind(kind)
    ? ajax.post<LeagdoApiResponse<Source[]>>('saveBookSources', data)
    : ajax.post<LeagdoApiResponse<Source[]>>('saveRssSources', data)
const saveSources = (
  data: Source[],
  kind: SourceKind = getCurrentSourceKind(),
) =>
  isStandaloneMode
    ? standaloneApi.saveSources(data, kind)
    : appSaveSources(data, kind)

const appDeleteSource = (data: Source[], kind: SourceKind) =>
  isBookSourceKind(kind)
    ? ajax.post<LeagdoApiResponse<string>>('deleteBookSources', data)
    : ajax.post<LeagdoApiResponse<string>>('deleteRssSources', data)
const deleteSource = (
  data: Source[],
  kind: SourceKind = getCurrentSourceKind(),
) =>
  isStandaloneMode
    ? standaloneApi.deleteSource(data, kind)
    : appDeleteSource(data, kind)

// webSocket
const appDebug = (
  /** @type {string} */ sourceUrl: string,
  /** @type {string} */ searchKey: string,
  /** @type {(data: string) => void} */ onReceive: (data: string) => void,
  /** @type {() => void} */ onFinish: () => void,
  kind: SourceKind,
) => {
  const url = new URL(
    `${isBookSourceKind(kind) ? 'bookSource' : 'rssSource'}Debug`,
    legado_webSocket_entry_point,
  )

  const socket = new WebSocket(url)
  socket.onerror = wsOnError
  socket.onopen = () => {
    socket.send(JSON.stringify({ tag: sourceUrl, key: searchKey }))
  }
  socket.onmessage = event => {
    onReceive(event.data)
    wsOnMessage?.call(socket, event)
  }

  socket.onclose = () => {
    onFinish()
  }
}
const debug = (
  sourceUrl: string,
  searchKey: string,
  onReceive: (data: string) => void,
  onFinish: () => void,
  kind: SourceKind = getCurrentSourceKind(),
) =>
  isStandaloneMode
    ? standaloneApi.debug(sourceUrl, searchKey, onReceive, onFinish, kind)
    : appDebug(sourceUrl, searchKey, onReceive, onFinish, kind)

/**
 * 从阅读获取需要特定处理的书籍封面
 * @param {string} coverUrl
 */
const appGetProxyCoverUrl = (coverUrl: string) => {
  if (coverUrl.startsWith(legado_http_entry_point)) return coverUrl
  return new URL(
    'cover?path=' + encodeURIComponent(coverUrl),
    legado_http_entry_point,
  ).toString()
}
const getProxyCoverUrl = (coverUrl: string) =>
  isStandaloneMode
    ? standaloneApi.getProxyCoverUrl(coverUrl)
    : appGetProxyCoverUrl(coverUrl)

/**
 * 从阅读获取需要特定处理的图片
 * @param {string} bookUrl
 * @param {string} src
 * @param {number|`${number}`} width
 */
const appGetProxyImageUrl = (
  bookUrl: string,
  src: string,
  width: number | `${number}`,
) => {
  if (src.startsWith(legado_http_entry_point)) return src
  return new URL(
    'image?path=' +
      encodeURIComponent(src) +
      '&url=' +
      encodeURIComponent(bookUrl) +
      '&width=' +
      width,
    legado_http_entry_point,
  ).toString()
}
const getProxyImageUrl = (
  bookUrl: string,
  src: string,
  width: number | `${number}`,
) =>
  isStandaloneMode
    ? standaloneApi.getProxyImageUrl(bookUrl, src, width)
    : appGetProxyImageUrl(bookUrl, src, width)

export default {
  getReadConfig,
  saveReadConfig,
  saveBookProgress,
  saveBookProgressWithBeacon,
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
