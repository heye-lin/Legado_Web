import API from '@api'
import type { BookSource, RssSource, Source } from '@/source'
import { downloadJson, formatFileDate, readJsonFile } from '@/utils/jsonFile'
import { convertSourcesToMap } from '@/utils/source'
import {
  type SourceSubscriptionData,
  parseSourceSubscriptionData,
  parseSourcesForKind,
} from '@/utils/sourceImport'
import { type SourceKind, sourceKindFilePrefix } from '@/utils/sourceKind'

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
): Promise<SourceSubscriptionData> =>
  parseSourceSubscriptionData(await readSourceSubscriptionJson(url))

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
