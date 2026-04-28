import standaloneApi from './standalone'
import type { LegadoApiResponse } from './api'
import type {
  BaseBook,
  Book,
  BookChapter,
  BookProgress,
  SourceSearchResult,
} from '@/book'
import type { Source } from '@/source'
import type { webReadConfig } from '@/web'
import type { StandaloneBackupData } from '@/api/standalone'
import { normalizeReadConfig } from '@/config/readConfig'
import { getSourceUniqueKey } from '@/utils/source'
import { type SourceKind, getCurrentSourceKind } from '@/utils/sourceKind'

type ApiResult<T> = Promise<{ data: LegadoApiResponse<T> }>
type RequestOptions = RequestInit & { fallbackLabel?: string }

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const SERVER_SOURCE_SYNC_KEY = 'legado.pg.serverSourceSynced'

let serverAvailable: boolean | undefined
const serverAvailabilityListeners = new Set<
  (available: boolean | undefined) => void
>()

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError'

const apiPath = (path: string, params?: Record<string, string | number>) => {
  const url = new URL(path, window.location.origin)
  Object.entries(params ?? {}).forEach(([key, value]) =>
    url.searchParams.set(key, String(value)),
  )
  return `${url.pathname}${url.search}`
}

const setServerAvailable = (available: boolean | undefined) => {
  if (serverAvailable === available) return
  serverAvailable = available
  serverAvailabilityListeners.forEach(listener => listener(available))
}

const request = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : JSON_HEADERS),
      ...options.headers,
    },
  })
  const payload = (await response.json()) as LegadoApiResponse<T>
  if (!response.ok || !payload.isSuccess) {
    throw new Error(payload.errorMsg || `HTTP ${response.status}`)
  }
  setServerAvailable(true)
  return payload.data
}

const withFallback = async <T>(
  run: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> => {
  try {
    return await run()
  } catch {
    setServerAvailable(false)
    return fallback()
  }
}

const withApiFallback = async <T>(
  run: () => ApiResult<T>,
  fallback: () => ApiResult<T>,
): ApiResult<T> => withFallback(run, fallback)

const sourceIsExample = (source: Source) =>
  getSourceUniqueKey(source) === 'https://example.com' ||
  getSourceUniqueKey(source) === 'https://example.com/rss.xml'

const getLocalRealSources = async (kind: SourceKind) => {
  const result = await standaloneApi.getSources(kind)
  return result.data.data.filter(source => !sourceIsExample(source))
}

const saveLocalSources = async (sources: Source[], kind: SourceKind) => {
  await standaloneApi.saveSources(sources, kind)
}

const syncSourcesFromServer = async <T extends Source>(
  kind: SourceKind,
  sources: T[],
) => {
  if (sources.length > 0) {
    await saveLocalSources(sources, kind)
    localStorage.setItem(`${SERVER_SOURCE_SYNC_KEY}.${kind}`, '1')
    return sources
  }

  const hasSynced = localStorage.getItem(`${SERVER_SOURCE_SYNC_KEY}.${kind}`)
  if (hasSynced === '1') {
    await saveLocalSources([], kind)
    return sources
  }

  const localSources = await getLocalRealSources(kind)
  if (localSources.length === 0) {
    await saveLocalSources([], kind)
    localStorage.setItem(`${SERVER_SOURCE_SYNC_KEY}.${kind}`, '1')
    return sources
  }

  const uploaded = await request<T[]>(apiPath('/api/sources', { kind }), {
    method: 'PUT',
    body: JSON.stringify(localSources),
  })
  await saveLocalSources(uploaded, kind)
  localStorage.setItem(`${SERVER_SOURCE_SYNC_KEY}.${kind}`, '1')
  return uploaded
}

const decodeTextFile = async (file: File) => {
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

const getReadConfig = async (): Promise<webReadConfig | undefined> =>
  withFallback(
    async () =>
      normalizeReadConfig(await request<webReadConfig>('/api/read-config')),
    () => standaloneApi.getReadConfig(),
  )

const saveReadConfig = async (config: webReadConfig): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>('/api/read-config', {
        method: 'PUT',
        body: JSON.stringify(normalizeReadConfig(config)),
      })
      await standaloneApi.saveReadConfig(config)
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.saveReadConfig(config),
  )

const saveBookProgress = async (
  bookProgress: BookProgress,
): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>('/api/book-progress', {
        method: 'POST',
        body: JSON.stringify(bookProgress),
      })
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.saveBookProgress(bookProgress),
  )

const getBookShelf = async (): ApiResult<Book[]> =>
  withApiFallback(
    async () => ({
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<Book[]>('/api/books'),
      },
    }),
    () => standaloneApi.getBookShelf(),
  )

const getChapterList = async (bookUrl: string): ApiResult<BookChapter[]> =>
  withApiFallback(
    async () => ({
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<BookChapter[]>(
          apiPath('/api/chapters', { bookUrl }),
        ),
      },
    }),
    () => standaloneApi.getChapterList(bookUrl),
  )

const getBookContent = async (
  bookUrl: string,
  chapterIndex: number,
): ApiResult<string> =>
  withApiFallback(
    async () => ({
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<string>(
          apiPath('/api/chapter-content', { bookUrl, index: chapterIndex }),
        ),
      },
    }),
    () => standaloneApi.getBookContent(bookUrl, chapterIndex),
  )

const searchBookSources = async (
  searchKey: string,
  options: { signal?: AbortSignal } = {},
): ApiResult<SourceSearchResult> => {
  const keyword = searchKey.trim()
  if (keyword === '') {
    return {
      data: {
        isSuccess: true,
        errorMsg: '',
        data: { books: [], reports: [] },
      },
    }
  }

  try {
    await getSources('bookSource')
    return {
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<SourceSearchResult>('/api/book-source-search', {
          method: 'POST',
          body: JSON.stringify({ keyword }),
          signal: options.signal,
        }),
      },
    }
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) throw error
    setServerAvailable(false)
    return {
      data: {
        isSuccess: false,
        errorMsg: `服务端书源搜索接口不可用：${getErrorMessage(error)}。请确认当前页面通过生产服务启动且 /api/health 正常。`,
        data: { books: [], reports: [] },
      },
    }
  }
}

const deleteBook = async (book: BaseBook): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>(
        apiPath('/api/book', { bookUrl: book.bookUrl }),
        { method: 'DELETE' },
      )
      await standaloneApi.deleteBook(book).catch(() => undefined)
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.deleteBook(book),
  )

const importLocalTextBook = async (file: File): ApiResult<Book> =>
  withApiFallback(
    async () => {
      const book = await request<Book>('/api/books/import-text', {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          text: await decodeTextFile(file),
        }),
      })
      return { data: { isSuccess: true, errorMsg: '', data: book } }
    },
    () => standaloneApi.importLocalTextBook(file),
  )

const exportStandaloneData = async (): ApiResult<StandaloneBackupData> =>
  withApiFallback(
    async () => ({
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<StandaloneBackupData>('/api/backup'),
      },
    }),
    () => standaloneApi.exportStandaloneData(),
  )

const importStandaloneData = async (
  backup: StandaloneBackupData,
): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>('/api/backup', {
        method: 'PUT',
        body: JSON.stringify(backup),
      })
      await standaloneApi.importStandaloneData(backup).catch(() => undefined)
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.importStandaloneData(backup),
  )

const clearStandaloneData = async (): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>('/api/standalone', {
        method: 'DELETE',
      })
      await standaloneApi.clearStandaloneData().catch(() => undefined)
      localStorage.removeItem(`${SERVER_SOURCE_SYNC_KEY}.bookSource`)
      localStorage.removeItem(`${SERVER_SOURCE_SYNC_KEY}.rssSource`)
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.clearStandaloneData(),
  )

const getSources = async (
  kind: SourceKind = getCurrentSourceKind(),
): ApiResult<Source[]> =>
  withApiFallback(
    async () => {
      const sources = await request<Source[]>(apiPath('/api/sources', { kind }))
      return {
        data: {
          isSuccess: true,
          errorMsg: '',
          data: await syncSourcesFromServer(kind, sources),
        },
      }
    },
    () => standaloneApi.getSources(kind),
  )

const saveSource = async (
  source: Source,
  kind: SourceKind = getCurrentSourceKind(),
): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>(apiPath('/api/source', { kind }), {
        method: 'POST',
        body: JSON.stringify(source),
      })
      await standaloneApi.saveSource(source, kind)
      localStorage.setItem(`${SERVER_SOURCE_SYNC_KEY}.${kind}`, '1')
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.saveSource(source, kind),
  )

const saveSources = async (
  sources: Source[],
  kind: SourceKind = getCurrentSourceKind(),
): ApiResult<Source[]> =>
  withApiFallback(
    async () => {
      const savedSources = await request<Source[]>(
        apiPath('/api/sources', { kind }),
        {
          method: 'PUT',
          body: JSON.stringify(sources),
        },
      )
      await standaloneApi.saveSources(savedSources, kind)
      localStorage.setItem(`${SERVER_SOURCE_SYNC_KEY}.${kind}`, '1')
      return { data: { isSuccess: true, errorMsg: '', data: savedSources } }
    },
    () => standaloneApi.saveSources(sources, kind),
  )

const deleteSource = async (
  sources: Source[],
  kind: SourceKind = getCurrentSourceKind(),
): ApiResult<string> =>
  withApiFallback(
    async () => {
      const message = await request<string>(apiPath('/api/sources', { kind }), {
        method: 'DELETE',
        body: JSON.stringify(sources),
      })
      await standaloneApi.deleteSource(sources, kind)
      return { data: { isSuccess: true, errorMsg: '', data: message } }
    },
    () => standaloneApi.deleteSource(sources, kind),
  )

const getProxyCoverUrl = (coverUrl: string) =>
  standaloneApi.getProxyCoverUrl(coverUrl)

const getProxyImageUrl = (
  bookUrl: string,
  src: string,
  width?: number | `${number}`,
) => standaloneApi.getProxyImageUrl(bookUrl, src, width)

export const getApiTargetName = () =>
  serverAvailable === false ? '浏览器本地' : 'PostgreSQL 持久化'

export const subscribeApiAvailability = (
  listener: (available: boolean | undefined) => void,
) => {
  serverAvailabilityListeners.add(listener)
  return () => {
    serverAvailabilityListeners.delete(listener)
  }
}

export default {
  getReadConfig,
  saveReadConfig,
  saveBookProgress,
  saveBookProgressWithBeacon: saveBookProgress,
  getBookShelf,
  getChapterList,
  getBookContent,
  searchBookSources,
  deleteBook,
  importLocalTextBook,
  exportStandaloneData,
  importStandaloneData,
  clearStandaloneData,
  getSources,
  saveSource,
  saveSources,
  deleteSource,
  debug: standaloneApi.debug,
  getProxyCoverUrl,
  getProxyImageUrl,
}
