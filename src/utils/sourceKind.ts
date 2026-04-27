export type SourceKind = 'bookSource' | 'rssSource'

export const sourceKindFromPath = (path: string): SourceKind =>
  /bookSource/i.test(path) ? 'bookSource' : 'rssSource'

export const getCurrentSourceKind = (): SourceKind =>
  sourceKindFromPath(location.href)

export const isBookSourceKind = (kind = getCurrentSourceKind()) =>
  kind === 'bookSource'

export const sourceKindDisplayName = (kind = getCurrentSourceKind()) =>
  isBookSourceKind(kind) ? '书源' : '订阅源'

export const sourceKindFilePrefix = (kind = getCurrentSourceKind()) =>
  isBookSourceKind(kind) ? 'bookSource' : 'rssSource'

export const sourceKindRequiredFields = (kind = getCurrentSourceKind()) =>
  isBookSourceKind(kind)
    ? 'bookSourceUrl、bookSourceName'
    : 'sourceUrl、sourceName'
