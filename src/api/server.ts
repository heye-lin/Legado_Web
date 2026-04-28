import standaloneApi from './standalone'
import type { LegadoApiResponse } from './api'
import type {
  BaseBook,
  Book,
  BookChapter,
  BookProgress,
  SourceBookImportResult,
  SourceBookPreviewResult,
  SourceSearchBook,
  SourceSearchResult,
} from '@/book'
import type { Source } from '@/source'
import type { webReadConfig } from '@/web'
import type { StandaloneBackupData } from '@/api/standalone'
import { normalizeReadConfig } from '@/config/readConfig'
import { getSourceUniqueKey } from '@/utils/source'
import { type SourceKind, getCurrentSourceKind } from '@/utils/sourceKind'

type ApiResult<T> = Promise<{ data: LegadoApiResponse<T> }>
type RequestOptions = RequestInit & {
  allowApiErrorFallback?: boolean
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const SERVER_SOURCE_SYNC_KEY = 'legado.pg.serverSourceSynced'
const DATABASE_UNAVAILABLE_ERROR_CODE = 'DATABASE_UNAVAILABLE'

let serverAvailable: boolean | undefined
const serverAvailabilityListeners = new Set<
  (available: boolean | undefined) => void
>()

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly allowFallback: boolean,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

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
  const { allowApiErrorFallback, ...fetchOptions } = options
  const allowRequestFallback = allowApiErrorFallback !== false
  let response: Response
  try {
    response = await fetch(path, {
      ...fetchOptions,
      headers: {
        ...(fetchOptions.body === undefined ? {} : JSON_HEADERS),
        ...fetchOptions.headers,
      },
    })
  } catch (error) {
    throw new ApiRequestError(
      `服务端请求失败：${getErrorMessage(error)}`,
      allowRequestFallback,
    )
  }

  let payload: LegadoApiResponse<T>
  try {
    payload = (await response.json()) as LegadoApiResponse<T>
  } catch (error) {
    throw new ApiRequestError(
      `服务端响应不是 JSON：${getErrorMessage(error)}`,
      allowRequestFallback,
    )
  }
  if (!response.ok || !payload.isSuccess) {
    const databaseUnavailable =
      response.status >= 500 &&
      payload.errorCode === DATABASE_UNAVAILABLE_ERROR_CODE
    setServerAvailable(databaseUnavailable ? false : true)
    const message = payload.errorMsg || `HTTP ${response.status}`
    throw new ApiRequestError(
      message,
      allowRequestFallback && databaseUnavailable,
    )
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
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.allowFallback !== true)
      throw error
    setServerAvailable(false)
    return fallback()
  }
}

const withApiFallback = async <T>(
  run: () => ApiResult<T>,
  fallback: () => ApiResult<T>,
): ApiResult<T> => withFallback(run, fallback)

const apiFailure = <T>(
  error: unknown,
  data: T,
): { data: LegadoApiResponse<T> } => ({
  data: {
    isSuccess: false,
    errorMsg: getErrorMessage(error),
    data,
  },
})

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
      await standaloneApi.saveReadConfig(config).catch(() => undefined)
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

const getChapterList = async (bookUrl: string): ApiResult<BookChapter[]> => {
  try {
    return await withApiFallback(
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
  } catch (error) {
    return apiFailure(error, [])
  }
}

const getBookContent = async (
  bookUrl: string,
  chapterIndex: number,
): ApiResult<string> => {
  try {
    return await withApiFallback(
      async () => ({
        data: {
          isSuccess: true,
          errorMsg: '',
          data: await request<string>(
            apiPath('/api/chapter-content', { bookUrl, index: chapterIndex }),
            { allowApiErrorFallback: serverAvailable !== true },
          ),
        },
      }),
      () => standaloneApi.getBookContent(bookUrl, chapterIndex),
    )
  } catch (error) {
    return apiFailure(error, '')
  }
}

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

const importSourceBook = async (
  book: SourceSearchBook,
): ApiResult<SourceBookImportResult> =>
  withApiFallback(
    async () => ({
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<SourceBookImportResult>(
          '/api/books/import-source',
          {
            method: 'POST',
            body: JSON.stringify(book),
            allowApiErrorFallback: false,
          },
        ),
      },
    }),
    () => standaloneApi.importSourceBook(book),
  )

const previewSourceBook = async (
  book: SourceSearchBook,
): ApiResult<SourceBookPreviewResult> =>
  withApiFallback(
    async () => ({
      data: {
        isSuccess: true,
        errorMsg: '',
        data: await request<SourceBookPreviewResult>(
          '/api/books/preview-source',
          {
            method: 'POST',
            body: JSON.stringify(book),
            allowApiErrorFallback: false,
          },
        ),
      },
    }),
    () => standaloneApi.previewSourceBook(book),
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
      await standaloneApi.saveSource(source, kind).catch(() => undefined)
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
      await standaloneApi.saveSources(savedSources, kind).catch(() => undefined)
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
      await standaloneApi.deleteSource(sources, kind).catch(() => undefined)
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
  serverAvailable === undefined
    ? '检测中'
    : serverAvailable
      ? 'PostgreSQL 持久化'
      : '浏览器本地'

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
  importSourceBook,
  previewSourceBook,
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
