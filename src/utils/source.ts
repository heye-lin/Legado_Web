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

export type SourceEnabledFilter = 'all' | 'enabled' | 'disabled'
export type SourceFeatureFilter =
  | 'all'
  | 'searchable'
  | 'unsearchable'
  | 'cookie'
  | 'js'
  | 'login'
export type SourceSearchField = 'all' | 'name' | 'url' | 'group' | 'comment' | 'rule'

export type SourceMatchOptions = {
  enabled?: SourceEnabledFilter
  feature?: SourceFeatureFilter
  field?: SourceSearchField
}

const normalizeSearchText = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase()

const collectObjectStrings = (value: unknown, output: string[]) => {
  if (value === undefined || value === null) return
  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectObjectStrings(item, output))
    return
  }
  if (typeof value !== 'object') return
  Object.values(value as Record<string, unknown>).forEach(item =>
    collectObjectStrings(item, output),
  )
}

const collectRuleStrings = (source: Source) => {
  const rules: string[] = []
  if (isBookSource(source)) {
    collectObjectStrings(source.searchUrl, rules)
    collectObjectStrings(source.exploreUrl, rules)
    collectObjectStrings(source.bookUrlPattern, rules)
    collectObjectStrings(source.ruleSearch, rules)
    collectObjectStrings(source.ruleBookInfo, rules)
    collectObjectStrings(source.ruleToc, rules)
    collectObjectStrings(source.ruleContent, rules)
    collectObjectStrings(source.ruleExplore, rules)
    return rules
  }
  collectObjectStrings(source.sortUrl, rules)
  collectObjectStrings(source.ruleArticles, rules)
  collectObjectStrings(source.ruleNextPage, rules)
  collectObjectStrings(source.ruleTitle, rules)
  collectObjectStrings(source.rulePubDate, rules)
  collectObjectStrings(source.ruleDescription, rules)
  collectObjectStrings(source.ruleImage, rules)
  collectObjectStrings(source.ruleLink, rules)
  collectObjectStrings(source.ruleContent, rules)
  collectObjectStrings(source.contentWhitelist, rules)
  collectObjectStrings(source.contentBlacklist, rules)
  return rules
}

const getSourceFieldTexts = (
  source: Source,
): Record<SourceSearchField, string[]> => {
  const name = getSourceName(source)
  const url = getSourceUniqueKey(source)
  const group = isBookSource(source)
    ? source.bookSourceGroup
    : source.sourceGroup
  const comment = isBookSource(source)
    ? source.bookSourceComment
    : source.sourceComment
  const rule = collectRuleStrings(source)
  return {
    all: [
      name,
      url,
      group,
      comment,
      isBookSource(source) ? source.variableComment : source.variableComment,
      ...rule,
    ].filter((item): item is string => typeof item === 'string'),
    name: [name],
    url: [url],
    group: group ? [group] : [],
    comment: comment ? [comment] : [],
    rule,
  }
}

export const sourceHasSearchRule = (source: Source) =>
  isBookSource(source) &&
  Boolean(
    source.searchUrl?.trim() &&
      source.ruleSearch?.bookList?.trim() &&
      source.ruleSearch?.name?.trim() &&
      source.ruleSearch?.bookUrl?.trim(),
  )

export const sourceUsesJsRule = (source: Source) =>
  Boolean(
    source.jsLib?.trim() ||
      source.loginUi?.trim() ||
      source.loginCheckJs?.trim() ||
      source.coverDecodeJs?.trim() ||
      collectRuleStrings(source).some(rule =>
        /(^\s*(?:@?js:|<js>)|<js>|java\.|source\.getVariable|source\.setVariable)/i.test(
          rule,
        ),
      ),
  )

export const sourceNeedsLogin = (source: Source) =>
  Boolean(source.loginUi?.trim() || source.loginCheckJs?.trim())

export const sourceNeedsCookieJar = (source: Source) =>
  source.enabledCookieJar === true

const sourceMatchesEnabledFilter = (
  source: Source,
  filter: SourceEnabledFilter,
) => {
  if (filter === 'all') return true
  return filter === 'enabled' ? source.enabled === true : source.enabled !== true
}

const sourceMatchesFeatureFilter = (
  source: Source,
  filter: SourceFeatureFilter,
) => {
  if (filter === 'all') return true
  if (filter === 'searchable') return sourceHasSearchRule(source)
  if (filter === 'unsearchable') return !sourceHasSearchRule(source)
  if (filter === 'cookie') return sourceNeedsCookieJar(source)
  if (filter === 'js') return sourceUsesJsRule(source)
  return sourceNeedsLogin(source)
}

const normalizeQueryTokens = (searchKey: string) =>
  normalizeSearchText(searchKey)
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)

const fieldAlias: Record<string, SourceSearchField> = {
  n: 'name',
  name: 'name',
  名称: 'name',
  u: 'url',
  url: 'url',
  地址: 'url',
  g: 'group',
  group: 'group',
  分组: 'group',
  c: 'comment',
  comment: 'comment',
  备注: 'comment',
  r: 'rule',
  rule: 'rule',
  规则: 'rule',
}

const tokenMatchesSource = (
  source: Source,
  token: string,
  defaultField: SourceSearchField,
) => {
  const fieldMatch = token.match(/^([^:：]+)[:：](.+)$/)
  const field = fieldMatch?.[1] ? fieldAlias[fieldMatch[1]] : defaultField
  const keyword = fieldMatch?.[2] ?? token
  const targetField = field ?? defaultField
  if (!keyword) return true
  return getSourceFieldTexts(source)[targetField].some(value =>
    normalizeSearchText(value).includes(keyword),
  )
}

export const isSourceMatches: (source: Source, searchKey: string) => boolean = (
  source,
  searchKey,
) => isSourceMatchesAdvanced(source, searchKey)

export const isSourceMatchesAdvanced = (
  source: Source,
  searchKey: string,
  {
    enabled = 'all',
    feature = 'all',
    field = 'all',
  }: SourceMatchOptions = {},
) =>
  sourceMatchesEnabledFilter(source, enabled) &&
  sourceMatchesFeatureFilter(source, feature) &&
  normalizeQueryTokens(searchKey).every(token =>
    tokenMatchesSource(source, token, field),
  )

export const convertSourcesToMap = (sources: Source[]): Map<string, Source> => {
  const map = new Map<string, Source>()
  sources.forEach(source => map.set(getSourceUniqueKey(source), source))
  return map
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const normalizeSource = (source: object) => {
  const record = source as Record<string, unknown>
  for (const key in record) {
    const value = record[key]
    if (value === null || (typeof value === 'string' && value.trim() === '')) {
      delete record[key]
    } else if (isObjectRecord(value)) {
      normalizeSource(value)
    }
  }
}
