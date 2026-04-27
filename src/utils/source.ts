import type { BookSource, RssSource, Source } from '../source'
import { type SourceKind, isBookSourceKind } from './sourceKind'
import { isNullOrBlank } from './utils'

const bookRuleKeys = [
  'ruleSearch',
  'ruleBookInfo',
  'ruleToc',
  'ruleContent',
  'ruleExplore',
] as const

export const isBookSource = (source: Source): source is BookSource =>
  'bookSourceUrl' in source || 'bookSourceName' in source

const createEditableBookSource = (source: Partial<BookSource>) => {
  const normalized = {
    bookSourceType: 0,
    customOrder: 0,
    enabled: true,
    enabledExplore: false,
    lastUpdateTime: Date.now(),
    respondTime: 0,
    weight: 0,
    ...source,
  } as BookSource
  bookRuleKeys.forEach(key => {
    normalized[key] = source[key] ?? {}
  })
  return normalized
}

const createEditableRssSource = (source: Partial<RssSource>) =>
  ({
    sourceIcon: '',
    enabled: true,
    singleUrl: true,
    articleStyle: 0,
    enableJs: false,
    loadWithBaseUrl: false,
    lastUpdateTime: Date.now(),
    customOrder: 0,
    ...source,
  }) as RssSource

export const createEditableSource = (
  kind: SourceKind,
  source?: Source,
): Source => {
  if (isBookSourceKind(kind)) {
    return createEditableBookSource((source ?? {}) as Partial<BookSource>)
  }
  return createEditableRssSource((source ?? {}) as Partial<RssSource>)
}

export const normalizeSourceForEdit = (source: Source): Source =>
  isBookSource(source)
    ? createEditableBookSource(source)
    : createEditableRssSource(source)

export const isValidSource: (source: Source) => boolean = source => {
  if (isBookSource(source)) {
    return (
      !isNullOrBlank(source.bookSourceName) &&
      !isNullOrBlank(source.bookSourceUrl) &&
      !isNullOrBlank(source.bookSourceType)
    )
  }
  return !isNullOrBlank(source.sourceName) && !isNullOrBlank(source.sourceUrl)
}

export const getSourceUniqueKey = (source: Source) =>
  isBookSource(source) ? source.bookSourceUrl : source.sourceUrl
export const getSourceName = (source: Source) =>
  isBookSource(source) ? source.bookSourceName : source.sourceName

const textMatches = (value: string | undefined, searchKey: string) =>
  value?.includes(searchKey) ?? false

export const isSourceMatches: (source: Source, searchKey: string) => boolean = (
  source,
  searchKey,
) => {
  if (isBookSource(source)) {
    return (
      textMatches(source.bookSourceName, searchKey) ||
      textMatches(source.bookSourceUrl, searchKey) ||
      textMatches(source.bookSourceGroup, searchKey) ||
      textMatches(source.bookSourceComment, searchKey)
    )
  }
  return (
    textMatches(source.sourceName, searchKey) ||
    textMatches(source.sourceUrl, searchKey) ||
    textMatches(source.sourceGroup, searchKey) ||
    textMatches(source.sourceComment, searchKey)
  )
}

export const convertSourcesToMap = (sources: Source[]): Map<string, Source> => {
  const map = new Map()
  sources.forEach(source => map.set(getSourceUniqueKey(source), source))
  return map
}

export const normalizeSource = (source: object) => {
  const record = source as Record<string, unknown>
  for (const key in record) {
    const value = record[key]
    if (
      value === '' ||
      value === null ||
      (typeof value === 'string' && !value.trim())
    ) {
      delete record[key]
    } else if (typeof value === 'object') {
      normalizeSource(value)
    }
  }
}
