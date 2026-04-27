import API from '@api'
import type { StandaloneBackupData } from '@/api/standalone'
import type { webReadConfig } from '@/web'
import {
  clearReadingSession,
  hasDragFiles,
  isTextFile,
} from '@/utils/bookshelf'
import {
  downloadJson,
  formatFileDate,
  getErrorMessage,
  readJsonFile,
} from '@/utils/jsonFile'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ref } from 'vue'

type UseStandaloneBookImportOptions = {
  loadingWrapper: (promise: Promise<unknown>) => Promise<unknown>
  reloadShelf: () => Promise<unknown>
  setReadConfig: (config?: webReadConfig) => void
  resetReadingRecent: () => void
}

export const useStandaloneBookImport = ({
  loadingWrapper,
  reloadShelf,
  setReadConfig,
  resetReadingRecent,
}: UseStandaloneBookImportOptions) => {
  const fileInput = ref<HTMLInputElement>()
  const backupFileInput = ref<HTMLInputElement>()
  const isDraggingFile = ref(false)
  const dragDepth = ref(0)

  const importTextFiles = async (files: File[]) => {
    if (files.length === 0) return

    const textFiles = files.filter(isTextFile)
    if (textFiles.length === 0) {
      ElMessage.warning('请导入 TXT 文件')
      return
    }
    if (textFiles.length !== files.length) {
      ElMessage.warning('已忽略非 TXT 文件')
    }

    let importedCount = 0
    await loadingWrapper(
      Promise.allSettled(
        textFiles.map(file => API.importLocalTextBook(file)),
      ).then(results => {
        const successBooks: string[] = []
        const failedMessages: string[] = []

        results.forEach(result => {
          if (result.status === 'rejected') {
            failedMessages.push(getErrorMessage(result.reason))
            return
          }
          if (result.value.data.isSuccess) {
            successBooks.push(result.value.data.data.name)
          } else {
            failedMessages.push(result.value.data.errorMsg)
          }
        })

        importedCount = successBooks.length
        if (successBooks.length > 0) {
          ElMessage.success(`已导入：${successBooks.join('、')}`)
        }
        if (failedMessages.length > 0) {
          ElMessage.error(failedMessages.join('；'))
        }
      }),
    )
    if (importedCount > 0) await reloadShelf()
  }

  const importLocalBooks = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    await importTextFiles(files)
  }

  const handleShelfDragEnter = (event: DragEvent) => {
    if (!hasDragFiles(event)) return
    event.preventDefault()
    dragDepth.value += 1
    isDraggingFile.value = true
  }

  const handleShelfDragOver = (event: DragEvent) => {
    if (!hasDragFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    isDraggingFile.value = true
  }

  const handleShelfDragLeave = (event: DragEvent) => {
    if (!hasDragFiles(event)) return
    event.preventDefault()
    dragDepth.value = Math.max(0, dragDepth.value - 1)
    isDraggingFile.value = dragDepth.value > 0
  }

  const handleShelfDrop = async (event: DragEvent) => {
    if (!hasDragFiles(event)) return
    event.preventDefault()
    dragDepth.value = 0
    isDraggingFile.value = false
    await importTextFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  const exportStandaloneBackup = async () => {
    try {
      const result = await API.exportStandaloneData()
      if (!result.data.isSuccess) {
        ElMessage.error(result.data.errorMsg)
        return
      }
      downloadJson(
        `legado-web-backup_${formatFileDate(new Date())}.json`,
        result.data.data,
      )
      ElMessage.success('本地数据备份已导出')
    } catch (error) {
      ElMessage.error(`导出备份失败：${getErrorMessage(error)}`)
    }
  }

  const importStandaloneBackup = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return

    try {
      const backup = (await readJsonFile(file)) as StandaloneBackupData
      const result = await API.importStandaloneData(backup)
      if (!result.data.isSuccess) {
        ElMessage.error(result.data.errorMsg)
        return
      }

      const config = await API.getReadConfig()
      setReadConfig(config)
      resetReadingRecent()
      clearReadingSession()
      await reloadShelf()
      ElMessage.success(result.data.data)
    } catch (error) {
      ElMessage.error(`恢复备份失败：${getErrorMessage(error)}`)
    }
  }

  const clearStandaloneData = async () => {
    try {
      await ElMessageBox.confirm(
        '此操作会删除浏览器中的本地书籍、章节、进度、阅读设置和源配置。确定继续？',
        '清空本地数据',
        {
          confirmButtonText: '清空',
          cancelButtonText: '取消',
          type: 'warning',
        },
      )
    } catch {
      return
    }

    try {
      const result = await API.clearStandaloneData()
      if (!result.data.isSuccess) {
        ElMessage.error(result.data.errorMsg)
        return
      }

      resetReadingRecent()
      clearReadingSession()
      setReadConfig(await API.getReadConfig())
      await reloadShelf()
      ElMessage.success(result.data.data)
    } catch (error) {
      ElMessage.error(`清空本地数据失败：${getErrorMessage(error)}`)
    }
  }

  return {
    fileInput,
    backupFileInput,
    isDraggingFile,
    importTextFiles,
    importLocalBooks,
    handleShelfDragEnter,
    handleShelfDragOver,
    handleShelfDragLeave,
    handleShelfDrop,
    exportStandaloneBackup,
    importStandaloneBackup,
    clearStandaloneData,
  }
}
