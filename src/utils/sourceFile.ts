import API from '@api'
import type { Source } from '@/source'
import { downloadJson, formatFileDate, readJsonFile } from '@/utils/jsonFile'
import { parseSourcesForKind } from '@/utils/sourceImport'
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
