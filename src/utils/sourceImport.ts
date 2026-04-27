import type { Source } from '@/source'
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
