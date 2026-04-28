import type { BookSource, RssSource, Source } from '@/source'
import { createEditableSource } from './source'
import { isPlainObject } from './jsonFile'
import {
  type SourceKind,
  getCurrentSourceKind,
  sourceKindDisplayName,
  sourceKindRequiredFields,
} from './sourceKind'

const isSourceOfKind = (
  value: unknown,
  kind: SourceKind = getCurrentSourceKind(),
) => {
  if (!isPlainObject(value)) return false
  return kind === 'bookSource'
    ? typeof value.bookSourceUrl === 'string' &&
        typeof value.bookSourceName === 'string'
    : typeof value.sourceUrl === 'string' &&
        typeof value.sourceName === 'string'
}

export const parseSourcesForKind = (
  data: unknown,
  kind: SourceKind = getCurrentSourceKind(),
): Source[] => {
  if (!Array.isArray(data)) {
    throw new Error('文件内容必须是 Source[] 数组')
  }

  const invalidIndex = data.findIndex(source => !isSourceOfKind(source, kind))
  if (invalidIndex !== -1) {
    throw new Error(
      `第 ${invalidIndex + 1} 条不是有效${sourceKindDisplayName(kind)}，需要字段：${sourceKindRequiredFields(kind)}`,
    )
  }

  return data.map(source => createEditableSource(kind, source as Source))
}

export type SourceSubscriptionData = {
  bookSources: BookSource[]
  rssSources: RssSource[]
}

const isBookSourceObject = (value: unknown): value is BookSource =>
  isSourceOfKind(value, 'bookSource')

const isRssSourceObject = (value: unknown): value is RssSource =>
  isSourceOfKind(value, 'rssSource')

const createBookSource = (source: Source) =>
  createEditableSource('bookSource', source) as BookSource

const createRssSource = (source: Source) =>
  createEditableSource('rssSource', source) as RssSource

const getSubscriptionSourceList = (data: unknown): unknown[] | undefined => {
  if (Array.isArray(data)) return data
  if (!isPlainObject(data)) return undefined

  for (const key of ['sources', 'data', 'items']) {
    const value = data[key]
    if (Array.isArray(value)) return value
  }

  if (isBookSourceObject(data) || isRssSourceObject(data)) return [data]
  return undefined
}

const appendTypedSources = (
  values: unknown[],
  result: SourceSubscriptionData,
  path: string,
) => {
  values.forEach((value, index) => {
    if (isBookSourceObject(value)) {
      result.bookSources.push(createBookSource(value))
      return
    }
    if (isRssSourceObject(value)) {
      result.rssSources.push(createRssSource(value))
      return
    }
    throw new Error(`订阅数据 ${path}[${index}] 不是有效书源或订阅源`)
  })
}

export const parseSourceSubscriptionData = (
  data: unknown,
): SourceSubscriptionData => {
  const result: SourceSubscriptionData = { bookSources: [], rssSources: [] }

  if (isPlainObject(data)) {
    if (Array.isArray(data.bookSources)) {
      appendTypedSources(data.bookSources, result, 'bookSources')
    }
    if (Array.isArray(data.rssSources)) {
      appendTypedSources(data.rssSources, result, 'rssSources')
    }
    if (result.bookSources.length > 0 || result.rssSources.length > 0) {
      return result
    }
  }

  const sources = getSubscriptionSourceList(data)
  if (sources === undefined) {
    throw new Error(
      '订阅内容必须是源数组、单个源对象，或包含 sources/data/bookSources/rssSources 的对象',
    )
  }

  appendTypedSources(sources, result, 'sources')
  if (result.bookSources.length === 0 && result.rssSources.length === 0) {
    throw new Error('订阅内容中没有可导入的源')
  }
  return result
}
