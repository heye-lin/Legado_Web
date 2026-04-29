import API from '@api'
import type {
  SourceBookImportResult,
  SourceBookPreviewResult,
  SourceSearchFilter,
  SourceSearchBook,
  SourceSearchReport,
} from '@/book'
import { getErrorMessage } from '@/utils/bookshelf'
import { ElMessage } from 'element-plus'
import {
  computed,
  nextTick,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type Ref,
} from 'vue'
import {
  SOURCE_BOOK_SEARCH_DEFAULT_FILTER,
  isSourceSearchBook,
} from '@/utils/sourceSearch'

type UseSourceSearchOptions = {
  searchWord: Ref<string>
  loadingWrapper: (promise: Promise<unknown>) => Promise<unknown>
  importSourceBook: (book: SourceSearchBook) => Promise<SourceBookImportResult>
}

const getSourceSearchEmptyMessage = (reports: SourceSearchReport[]) => {
  if (reports.length === 0) return '当前没有可用书源，请先到书源管理导入书源。'
  const exampleReport = reports.find(report =>
    report.message.includes('示例书源'),
  )
  if (exampleReport !== undefined) return exampleReport.message
  if (reports.every(report => report.status === 'empty')) {
    return '书源请求成功，但没有解析出可显示结果。请检查关键词或搜索规则。'
  }
  if (reports.every(report => report.status === 'skipped')) {
    return '没有可搜索书源，请启用书源并配置搜索地址、搜索列表、书名和详情地址规则。'
  }
  if (reports.every(report => report.status === 'unsupported')) {
    return '导入的书源超出当前 Web 服务端搜索规则支持范围。'
  }
  if (reports.every(report => report.status === 'failed')) {
    return '所有书源搜索失败，常见原因是目标站网络失败、代理无法访问、反爬拦截或规则不兼容。'
  }
  return '书源没有返回可显示的搜索结果，请检查书源规则、网络/代理可达性或更换书源。'
}

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const useSourceSearch = ({
  searchWord,
  loadingWrapper,
  importSourceBook,
}: UseSourceSearchOptions) => {
  const sourceSearchBooks = shallowRef<SourceSearchBook[]>([])
  const sourceSearchReports = ref<SourceSearchReport[]>([])
  const sourceSearchErrorMessage = ref('')
  const sourceSearchActive = ref(false)
  const sourceSearchKeyword = ref('')
  const isSearchingSources = ref(false)
  const sourceSearchDialogVisible = ref(false)
  const sourceSearchInput = ref('')
  const sourceSearchSourceKeyword = ref(
    SOURCE_BOOK_SEARCH_DEFAULT_FILTER.keyword,
  )
  const sourceSearchEnabledFilter = ref<
    NonNullable<SourceSearchFilter['enabled']>
  >(SOURCE_BOOK_SEARCH_DEFAULT_FILTER.enabled)
  const sourceSearchFeatureFilter = ref<
    NonNullable<SourceSearchFilter['feature']>
  >(SOURCE_BOOK_SEARCH_DEFAULT_FILTER.feature)
  const sourceSearchFieldFilter = ref<NonNullable<SourceSearchFilter['field']>>(
    SOURCE_BOOK_SEARCH_DEFAULT_FILTER.field,
  )
  const sourceSearchReportsExpanded = ref(false)
  const importingSourceBookKeys = ref(new Set<string>())
  const previewDialogVisible = ref(false)
  const previewSourceBook = ref<SourceSearchBook>()
  const previewResult = ref<SourceBookPreviewResult>()
  const previewErrorMessage = ref('')
  const isPreviewingSourceBook = ref(false)
  let sourceSearchRunId = 0
  let sourceSearchAbortController: AbortController | undefined
  let previewRunId = 0

  const sourceSearchEmptyMessage = computed(
    () =>
      sourceSearchErrorMessage.value ||
      getSourceSearchEmptyMessage(sourceSearchReports.value),
  )

  const sourceFilter = computed<SourceSearchFilter>(() => ({
    keyword: sourceSearchSourceKeyword.value.trim(),
    enabled: sourceSearchEnabledFilter.value,
    feature: sourceSearchFeatureFilter.value,
    field: sourceSearchFieldFilter.value,
  }))

  const resetSourceSearchFilters = () => {
    sourceSearchSourceKeyword.value = SOURCE_BOOK_SEARCH_DEFAULT_FILTER.keyword
    sourceSearchEnabledFilter.value = SOURCE_BOOK_SEARCH_DEFAULT_FILTER.enabled
    sourceSearchFeatureFilter.value = SOURCE_BOOK_SEARCH_DEFAULT_FILTER.feature
    sourceSearchFieldFilter.value = SOURCE_BOOK_SEARCH_DEFAULT_FILTER.field
  }

  const resetSourceSearchState = () => {
    sourceSearchActive.value = false
    sourceSearchBooks.value = []
    sourceSearchReports.value = []
    sourceSearchErrorMessage.value = ''
    sourceSearchKeyword.value = ''
    sourceSearchReportsExpanded.value = false
  }

  const cancelSourceSearchRequest = () => {
    sourceSearchRunId += 1
    sourceSearchAbortController?.abort()
    sourceSearchAbortController = undefined
    isSearchingSources.value = false
  }

  const clearSourceSearch = () => {
    cancelSourceSearchRequest()
    resetSourceSearchState()
  }

  const cancelSourceBookPreview = () => {
    previewRunId += 1
    isPreviewingSourceBook.value = false
  }

  const searchBook = async () => {
    const keyword = searchWord.value.trim()
    if (keyword === '') {
      openSourceSearchDialog()
      return
    }

    sourceSearchAbortController?.abort()
    const currentRunId = ++sourceSearchRunId
    const controller = new AbortController()
    sourceSearchAbortController = controller
    resetSourceSearchState()
    sourceSearchKeyword.value = keyword
    sourceSearchActive.value = true
    isSearchingSources.value = true
    try {
      const result = await API.searchBookSources(keyword, {
        signal: controller.signal,
        sourceFilter: sourceFilter.value,
      })
      if (currentRunId !== sourceSearchRunId || controller.signal.aborted)
        return
      if (!result.data.isSuccess) {
        sourceSearchErrorMessage.value = result.data.errorMsg
        ElMessage.error(result.data.errorMsg)
        return
      }
      sourceSearchBooks.value = result.data.data.books
      sourceSearchReports.value = result.data.data.reports
      sourceSearchKeyword.value = keyword
      sourceSearchActive.value = true
      if (sourceSearchBooks.value.length === 0) {
        ElMessage.warning(
          getSourceSearchEmptyMessage(sourceSearchReports.value),
        )
      }
    } catch (error) {
      if (currentRunId !== sourceSearchRunId || controller.signal.aborted)
        return
      sourceSearchErrorMessage.value = `书源搜索失败：${getErrorMessage(error)}`
      ElMessage.error(sourceSearchErrorMessage.value)
    } finally {
      if (currentRunId === sourceSearchRunId) {
        isSearchingSources.value = false
        if (sourceSearchAbortController === controller) {
          sourceSearchAbortController = undefined
        }
      }
    }
  }

  const openSourceSearchDialog = () => {
    sourceSearchInput.value = searchWord.value.trim()
    sourceSearchDialogVisible.value = true
  }

  const confirmSourceSearchDialog = () => {
    const keyword = sourceSearchInput.value.trim()
    if (keyword === '') {
      ElMessage.info('请输入要搜索的书名、作者或关键词')
      return
    }
    sourceSearchDialogVisible.value = false
    searchWord.value = keyword
    void nextTick(searchBook)
  }

  const setSourceBookImporting = (key: string, importing: boolean) => {
    const next = new Set(importingSourceBookKeys.value)
    if (importing) next.add(key)
    else next.delete(key)
    importingSourceBookKeys.value = next
  }

  const handleBookImport = async (book: SourceSearchBook) => {
    const key = book.resultKey
    if (importingSourceBookKeys.value.has(key)) return
    setSourceBookImporting(key, true)
    try {
      let imported: SourceBookImportResult | undefined
      await loadingWrapper(
        importSourceBook(book).then(result => {
          imported = result
        }),
      )
      if (imported === undefined) return

      ElMessage.success(
        imported.alreadyOnShelf
          ? `《${imported.book.name}》已在书架，共 ${imported.chapterCount} 章`
          : `《${imported.book.name}》已加入书架，共 ${imported.chapterCount} 章`,
      )
      clearSourceSearch()
      previewDialogVisible.value = false
      searchWord.value = ''
    } catch (error) {
      ElMessage.error(`加入书架失败：${getErrorMessage(error)}`)
    } finally {
      setSourceBookImporting(key, false)
    }
  }

  const openSourceBookPreview = async (book: SourceSearchBook) => {
    if (!isHttpUrl(book.bookUrl)) {
      ElMessage.warning('书源搜索结果只支持预览 http/https 详情链接')
      return
    }
    const currentRunId = ++previewRunId
    previewSourceBook.value = book
    previewResult.value = undefined
    previewErrorMessage.value = ''
    previewDialogVisible.value = true
    isPreviewingSourceBook.value = true
    try {
      const result = await API.previewSourceBook(book)
      if (currentRunId !== previewRunId) return
      if (!result.data.isSuccess) {
        previewErrorMessage.value = result.data.errorMsg
        ElMessage.error(`预览失败：${result.data.errorMsg}`)
        return
      }
      previewResult.value = result.data.data
    } catch (error) {
      if (currentRunId !== previewRunId) return
      previewErrorMessage.value = getErrorMessage(error)
      ElMessage.error(`预览失败：${previewErrorMessage.value}`)
    } finally {
      if (currentRunId === previewRunId) {
        isPreviewingSourceBook.value = false
      }
    }
  }

  watch(searchWord, value => {
    if (value.trim() === '') {
      clearSourceSearch()
      return
    }
    if (sourceSearchActive.value || isSearchingSources.value) {
      cancelSourceSearchRequest()
      resetSourceSearchState()
    }
  })

  onUnmounted(() => {
    cancelSourceSearchRequest()
    cancelSourceBookPreview()
  })

  return {
    sourceSearchBooks,
    sourceSearchReports,
    sourceSearchActive,
    sourceSearchKeyword,
    isSearchingSources,
    sourceSearchDialogVisible,
    sourceSearchInput,
    sourceSearchSourceKeyword,
    sourceSearchEnabledFilter,
    sourceSearchFeatureFilter,
    sourceSearchFieldFilter,
    sourceSearchReportsExpanded,
    sourceSearchEmptyMessage,
    importingSourceBookKeys,
    previewDialogVisible,
    previewSourceBook,
    previewResult,
    previewErrorMessage,
    isPreviewingSourceBook,
    searchBook,
    openSourceSearchDialog,
    confirmSourceSearchDialog,
    resetSourceSearchFilters,
    clearSourceSearch,
    handleBookImport,
    openSourceBookPreview,
    isSourceSearchBook,
  }
}
