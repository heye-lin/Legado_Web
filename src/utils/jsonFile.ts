const padDatePart = (value: number) => value.toString().padStart(2, '0')

export const formatFileDate = (date: Date) => {
  const year = date.getFullYear()
  const month = padDatePart(date.getMonth() + 1)
  const day = padDatePart(date.getDate())
  const hours = padDatePart(date.getHours())
  const minutes = padDatePart(date.getMinutes())
  const seconds = padDatePart(date.getSeconds())
  return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

export const isPlainObject = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const downloadJson = (filename: string, data: unknown) => {
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json;charset=utf-8',
    }),
  )
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0)
}

export const readTextFile = async (file: File) => {
  try {
    return await file.text()
  } catch (error) {
    throw new Error(`读取文件失败：${getErrorMessage(error)}`)
  }
}

const parseJsonText = (content: string): unknown => {
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`JSON 解析失败：${getErrorMessage(error)}`)
  }
}

export const readJsonFile = async (file: File) =>
  parseJsonText(await readTextFile(file))

export const selectJsonFile = (onSelect: (file: File | undefined) => void) => {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'application/json,.json'
  input.addEventListener('change', () => onSelect(input.files?.[0]), {
    once: true,
  })
  input.click()
}
