import API from '@api'
import type { BookSource, RssSource, Source } from '@/source'
import {
  downloadJson,
  formatFileDate,
  isPlainObject,
  readJsonFile,
} from '@/utils/jsonFile'
import { convertSourcesToMap } from '@/utils/source'
import {
  type SourceSubscriptionData,
  parseSourceSubscriptionData,
  parseSourcesForKind,
} from '@/utils/sourceImport'
import { type SourceKind, sourceKindFilePrefix } from '@/utils/sourceKind'

export type SourceSubscriptionReadResult = SourceSubscriptionData & {
  notes: string[]
}

type YioveCollection = {
  id: string
  name: string
  total: number
  viewTotal: number
}

const YIOVE_SITE_ORIGIN = 'https://shuyuan.yiove.com'
const YIOVE_API_ORIGIN = 'https://shuyuan-api.yiove.com'
const YIOVE_COLLECTION_PAGE_SIZE = 20
const YIOVE_RECOMMENDED_COLLECTION_MAX_TOTAL = 100
const YIOVE_DEFAULT_SOURCE_PAGE_SIZE = 30

export const readSourceConfigFile = async (file: File, kind: SourceKind) =>
  parseSourcesForKind(await readJsonFile(file), kind)

export const persistSourceConfig = async (
  sources: Source[],
  kind: SourceKind,
) => {
  const { data } = await API.saveSources(sources, kind)
  if (!data.isSuccess) throw new Error(data.errorMsg)
}

export const downloadSourceConfig = (sources: Source[], kind: SourceKind) => {
  downloadJson(
    `${sourceKindFilePrefix(kind)}_${formatFileDate(new Date())}.json`,
    sources,
  )
}

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

const sourceSubscriptionProxyUrl = (url: string) =>
  `/api/source-subscription?url=${encodeURIComponent(url)}`

const readSourceSubscriptionJson = async (url: string) => {
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('订阅地址必须是 http/https URL')
  }

  try {
    return await fetchJson(sourceSubscriptionProxyUrl(parsedUrl.toString()))
  } catch (proxyError) {
    try {
      return await fetchJson(parsedUrl.toString())
    } catch (directError) {
      throw new Error(
        `订阅地址拉取失败。当前服务会优先使用同源代理；如果仍失败，通常是网络、CORS 或返回内容不是 JSON。代理错误：${proxyError instanceof Error ? proxyError.message : String(proxyError)}；直连错误：${directError instanceof Error ? directError.message : String(directError)}`,
      )
    }
  }
}

export const readSourceSubscriptionUrl = async (
  url: string,
): Promise<SourceSubscriptionReadResult> => {
  const parsedUrl = new URL(url)
  const subscription = parseSourceSubscriptionData(
    await readSourceSubscriptionJson(parsedUrl.toString()),
  )
  return resolveSourceSubscription(parsedUrl, subscription)
}

const hasYioveWarehouseRssSource = (subscription: SourceSubscriptionData) =>
  subscription.rssSources.some(source => {
    try {
      return new URL(source.sourceUrl).origin === YIOVE_SITE_ORIGIN
    } catch {
      return false
    }
  })

const isYioveWarehouseUrl = (url: URL) =>
  url.origin === YIOVE_SITE_ORIGIN || url.origin === YIOVE_API_ORIGIN

const readSourceSubscriptionFromUrl = async (url: string) =>
  parseSourceSubscriptionData(await readSourceSubscriptionJson(url))

const toFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const parseYioveCollection = (value: unknown): YioveCollection | undefined => {
  if (!isPlainObject(value)) return undefined

  const id = value.id
  const name = value.name
  const total = toFiniteNumber(value.total)
  const viewTotal = toFiniteNumber(value.view_total) ?? 0
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    total === undefined
  ) {
    return undefined
  }

  return { id, name, total, viewTotal }
}

const selectYioveRecommendedCollection = (
  data: unknown,
): YioveCollection | undefined => {
  if (!isPlainObject(data) || !Array.isArray(data.items)) return undefined

  const collections = data.items
    .map(parseYioveCollection)
    .filter((item): item is YioveCollection => item !== undefined)
  const recommended = collections
    .filter(
      item =>
        item.total > 0 && item.total <= YIOVE_RECOMMENDED_COLLECTION_MAX_TOTAL,
    )
    .sort(
      (left, right) =>
        right.viewTotal - left.viewTotal ||
        left.total - right.total ||
        left.name.localeCompare(right.name),
    )

  return recommended[0]
}

const mergeBookSources = (sources: BookSource[]) => {
  const map = new Map<string, BookSource>()
  sources.forEach(source => map.set(source.bookSourceUrl, source))
  return Array.from(map.values())
}

const readYioveRecommendedBookSources = async () => {
  const collectionCatalog = await readSourceSubscriptionJson(
    `${YIOVE_API_ORIGIN}/shuyuan/book-source-collections?page=1&page_size=${YIOVE_COLLECTION_PAGE_SIZE}`,
  )
  const collection = selectYioveRecommendedCollection(collectionCatalog)
  if (collection !== undefined) {
    const data = await readSourceSubscriptionFromUrl(
      `${YIOVE_API_ORIGIN}/import/book-source-collection/${collection.id}`,
    )
    return {
      bookSources: data.bookSources,
      note: `已从 Yiove 书源仓库自动展开「${collection.name}」合集 ${data.bookSources.length} 条书源`,
    }
  }

  const data = await readSourceSubscriptionFromUrl(
    `${YIOVE_API_ORIGIN}/import/book-sources/1-${YIOVE_DEFAULT_SOURCE_PAGE_SIZE}`,
  )
  return {
    bookSources: data.bookSources,
    note: `已从 Yiove 书源仓库自动展开前 ${data.bookSources.length} 条书源`,
  }
}

const resolveSourceSubscription = async (
  url: URL,
  subscription: SourceSubscriptionData,
): Promise<SourceSubscriptionReadResult> => {
  const notes: string[] = []
  const bookSources = [...subscription.bookSources]

  if (
    subscription.bookSources.length === 0 &&
    (hasYioveWarehouseRssSource(subscription) || isYioveWarehouseUrl(url))
  ) {
    try {
      const resolved = await readYioveRecommendedBookSources()
      bookSources.push(...resolved.bookSources)
      notes.push(resolved.note)
    } catch (error) {
      notes.push(
        `Yiove 书源仓库自动展开失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    bookSources: mergeBookSources(bookSources),
    rssSources: subscription.rssSources,
    notes,
  }
}

export type SourceMergeResult<T extends Source> = {
  sources: T[]
  added: number
  updated: number
}

export const mergeSourceConfig = async <T extends Source>(
  incomingSources: T[],
  kind: SourceKind,
): Promise<SourceMergeResult<T>> => {
  const { data } = await API.getSources(kind)
  if (!data.isSuccess) throw new Error(data.errorMsg)

  const map = convertSourcesToMap(data.data)
  let added = 0
  let updated = 0
  incomingSources.forEach(source => {
    const key =
      kind === 'bookSource'
        ? (source as BookSource).bookSourceUrl
        : (source as RssSource).sourceUrl
    if (map.has(key)) updated += 1
    else added += 1
    map.set(key, source)
  })

  const sources = Array.from(map.values()) as T[]
  await persistSourceConfig(sources, kind)
  return { sources, added, updated }
}
