<template>
  <div :class="{ 'index-wrapper': true, night: isNight, day: !isNight }">
    <div class="navigation-wrapper">
      <div class="navigation-title-wrapper">
        <div class="navigation-title">阅读</div>
        <div class="navigation-sub-title">清风不识字，何故乱翻书</div>
      </div>
      <div class="search-wrapper">
        <el-input
          :placeholder="searchPlaceholder"
          v-model="searchWord"
          class="search-input"
          :prefix-icon="SearchIcon"
          aria-label="筛选本地书架"
        >
          <template #append>
            <el-button
              :type="isSearchingSources ? 'danger' : 'primary'"
              @click="isSearchingSources ? clearSourceSearch() : searchBook()"
            >
              {{ isSearchingSources ? '取消' : '书源搜索' }}
            </el-button>
          </template>
        </el-input>
      </div>
      <div class="bottom-wrapper">
        <div class="recent-wrapper">
          <div class="recent-title">最近阅读</div>
          <div class="reading-recent">
            <el-tag
              :type="
                readingRecent.name === '尚无阅读记录' ? 'warning' : 'primary'
              "
              class="recent-book"
              size="large"
              @click="
                toDetail(
                  readingRecent.bookUrl,
                  readingRecent.name,
                  readingRecent.author,
                  readingRecent.chapterIndex,
                  readingRecent.chapterPos,
                  readingRecent.isSearchBook,
                  true,
                )
              "
              :class="{ 'no-point': readingRecent.bookUrl === '' }"
            >
              {{ readingRecent.name }}
            </el-tag>
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">基本设定</div>
          <div class="setting-item">
            <el-tag
              :type="apiTargetTagType"
              size="large"
              class="setting-connect"
            >
              {{ apiTargetName }}
            </el-tag>
            <el-button
              class="standalone-action-button"
              type="warning"
              size="small"
              @click="openBookSourceManager"
            >
              书源管理
            </el-button>
            <el-button
              class="standalone-action-button"
              type="success"
              size="small"
              @click="openSourceSearchDialog"
            >
              书源搜索
            </el-button>
            <el-button
              class="standalone-action-button"
              type="primary"
              size="small"
              @click="fileInput?.click()"
            >
              导入 TXT
            </el-button>
            <el-button
              class="standalone-action-button"
              size="small"
              @click="exportStandaloneBackup"
            >
              导出备份
            </el-button>
            <el-button
              class="standalone-action-button"
              size="small"
              @click="backupFileInput?.click()"
            >
              恢复备份
            </el-button>
            <el-button
              class="standalone-action-button"
              type="danger"
              size="small"
              @click="clearStandaloneData"
            >
              清空数据
            </el-button>
          </div>
        </div>
      </div>
      <div class="bottom-icons">
        <a
          href="https://github.com/heye-lin/Legado_Web"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开 Legado Web GitHub 仓库"
        >
          <div class="bottom-icon">
            <img :src="githubUrl" alt="" />
          </div>
        </a>
      </div>
    </div>
    <input
      ref="fileInput"
      class="hidden-file-input"
      type="file"
      accept=".txt,text/plain"
      multiple
      @change="importLocalBooks"
    />
    <input
      ref="backupFileInput"
      class="hidden-file-input"
      type="file"
      accept="application/json,.json"
      @change="importStandaloneBackup"
    />
    <div
      class="shelf-wrapper"
      :class="{ 'drag-over': isDraggingFile }"
      ref="shelfWrapper"
      @dragenter="handleShelfDragEnter"
      @dragover="handleShelfDragOver"
      @dragleave="handleShelfDragLeave"
      @drop="handleShelfDrop"
    >
      <div
        v-if="
          !showStandaloneEmptyState &&
          !sourceSearchActive &&
          !isSearchingSources
        "
        class="shelf-feature-bar"
      >
        <div class="shelf-feature-text">
          <strong>书源搜索</strong>
          <span>先导入或保存书源，再搜索在线书籍并加入书架。</span>
        </div>
        <div class="shelf-feature-actions">
          <el-button type="warning" @click="openBookSourceManager">
            书源管理
          </el-button>
          <el-button type="success" @click="openSourceSearchDialog">
            书源搜索
          </el-button>
        </div>
      </div>
      <div
        v-if="sourceSearchActive || isSearchingSources"
        class="source-search-summary"
      >
        <div class="source-search-summary-heading">
          <div>
            <strong class="source-search-title">
              {{
                isSearchingSources
                  ? '正在使用书源搜索'
                  : `书源搜索结果：${sourceSearchBooks.length} 本`
              }}
            </strong>
            <span class="source-search-keyword"
              >「{{ sourceSearchKeyword }}」</span
            >
            <div
              v-if="sourceSearchReports.length > 0"
              class="source-search-subtitle"
            >
              {{ sourceSearchReportSummaryText }}
            </div>
          </div>
          <div class="source-search-actions">
            <el-button
              size="small"
              type="success"
              :loading="isSearchingSources"
              @click="searchBook"
            >
              重新搜索
            </el-button>
            <el-button size="small" @click="clearSourceSearch">
              返回本地书架
            </el-button>
            <el-button
              size="small"
              type="warning"
              @click="openBookSourceManager"
            >
              管理书源
            </el-button>
          </div>
        </div>
        <div v-if="sourceSearchReports.length > 0" class="source-search-report">
          <el-tag
            v-for="item in sourceSearchReportCountItems"
            :key="item.status"
            :type="item.type"
            effect="plain"
            size="small"
            round
          >
            {{ item.label }} {{ item.count }}
          </el-tag>
        </div>
        <div class="source-search-tip">
          {{ sourceSearchTipText }}
        </div>
        <div
          v-if="sourceSearchShowReportDetails"
          class="source-search-report-details"
        >
          <div class="source-search-report-details-header">
            <span>{{ sourceSearchReportDetailsTitle }}</span>
            <span v-if="sourceSearchSuccessHidden">
              成功项默认收起，展开可查看全部源。
            </span>
          </div>
          <div
            v-for="report in sourceSearchReportDetails"
            :key="`${report.sourceUrl}:${report.status}`"
            class="source-search-report-detail"
            :class="`is-${report.status}`"
            :title="getSourceSearchReportTitle(report)"
          >
            <el-tag
              size="small"
              effect="dark"
              :type="sourceSearchReportTagType(report.status)"
            >
              {{ sourceSearchReportStatusText(report.status) }}
            </el-tag>
            <span class="source-search-report-source">
              {{ report.sourceName }}
            </span>
            <span class="source-search-report-message">
              {{ formatSourceSearchReportMessage(report.message) }}
            </span>
          </div>
          <el-button
            v-if="sourceSearchCanToggleReports"
            class="source-search-report-toggle"
            text
            size="small"
            @click="sourceSearchReportsExpanded = !sourceSearchReportsExpanded"
          >
            {{ sourceSearchReportToggleText }}
          </el-button>
        </div>
        <div
          v-if="sourceSearchTopIssues.length > 0"
          class="source-search-quick-hint"
        >
          <strong>优先处理：</strong>
          <span>{{ sourceSearchTopIssues.join('；') }}</span>
        </div>
      </div>
      <div v-if="showStandaloneEmptyState" class="empty-shelf-state">
        <div class="empty-shelf-title">导入 TXT 开始阅读</div>
        <div class="empty-shelf-description">
          <p>选择本地 TXT 文件，或直接拖拽到书架区域导入。</p>
          <p>也可以先进入书源管理导入书源，再搜索在线书籍并加入书架。</p>
        </div>
        <div class="empty-shelf-actions">
          <el-button type="primary" size="large" @click="fileInput?.click()">
            导入 TXT
          </el-button>
          <el-button type="warning" size="large" @click="openBookSourceManager">
            书源管理
          </el-button>
          <el-button
            type="success"
            size="large"
            @click="openSourceSearchDialog"
          >
            书源搜索
          </el-button>
        </div>
      </div>
      <div v-else-if="isSearchingSources" class="source-search-empty">
        正在搜索「{{
          sourceSearchKeyword
        }}」，可点击“取消”或“返回本地书架”中止搜索。
      </div>
      <div v-else-if="showLocalSearchEmptyState" class="source-search-empty">
        本地书架没有匹配「{{
          searchWord.trim()
        }}」的书籍。可清空关键词，或点击“书源搜索”搜索在线来源。
      </div>
      <div
        v-else-if="sourceSearchActive && books.length === 0"
        class="source-search-empty"
      >
        {{ sourceSearchEmptyMessage }}
      </div>
      <book-items
        v-else
        :books="books"
        :importingBookKeys="importingSourceBookKeys"
        @bookClick="handleBookClick"
        @bookDelete="handleBookDelete"
        @bookImport="handleBookImport"
      ></book-items>
      <div v-if="isDraggingFile" class="drag-import-mask">
        <div class="drag-import-title">释放鼠标导入 TXT</div>
        <div class="drag-import-description">{{ dragImportDescription }}</div>
      </div>
    </div>
    <el-dialog
      v-model="sourceSearchDialogVisible"
      title="书源搜索"
      width="min(420px, calc(100vw - 32px))"
    >
      <div class="source-search-dialog">
        <p>
          从已导入并启用的书源中搜索书籍。生产服务支持将结果加入书架；未导入书源时，请先进入书源管理。
        </p>
        <el-input
          v-model="sourceSearchInput"
          placeholder="输入书名、作者或关键词"
          :prefix-icon="SearchIcon"
          aria-label="输入书名、作者或关键词进行书源搜索"
          @keyup.enter="confirmSourceSearchDialog"
        />
      </div>
      <template #footer>
        <el-button @click="sourceSearchDialogVisible = false">取消</el-button>
        <el-button type="warning" @click="openBookSourceManager">
          书源管理
        </el-button>
        <el-button
          type="success"
          :loading="isSearchingSources"
          @click="confirmSourceSearchDialog"
        >
          开始搜索
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import '@/assets/bookshelf.css'
import '@/assets/fonts/shelffont.css'
import { useBookStore } from '@/store'
import githubUrl from '@/assets/imgs/github.png'
import { useLoading } from '@/hooks/loading'
import { useStandaloneBookImport } from '@/hooks/useStandaloneBookImport'
import { Search as SearchIcon } from '@element-plus/icons-vue'
import API, { getApiTargetName, subscribeApiAvailability } from '@api'
import type { Book, SourceSearchBook, SourceSearchReport } from '@/book'
import {
  type ReadingRecentBook,
  clearReadingSession,
  clearStoredReadingRecent,
  createDefaultReadingRecent,
  filterShelfBooks,
  getBookReadPosition,
  getErrorMessage,
  hasBookOnShelf,
  loadStoredReadingRecent,
  saveReadingRecent,
  saveReadingSession,
} from '@/utils/bookshelf'

const store = useBookStore()
const isNight = computed(() => store.isNight)
const shelf = computed(() => store.shelf)
const router = useRouter()

const readingRecent = ref<ReadingRecentBook>(createDefaultReadingRecent())
const resetReadingRecent = () => {
  readingRecent.value = createDefaultReadingRecent()
  clearStoredReadingRecent()
}

const restoreReadingRecent = () => {
  const storedRecent = loadStoredReadingRecent()
  if (storedRecent !== undefined) readingRecent.value = storedRecent
}

const shelfWrapper = ref<HTMLElement>()
const { loadingWrapper, isLoading } = useLoading(
  shelfWrapper,
  '正在获取书籍信息',
)

// 书架书籍和本地搜索
const searchWord = ref('')
const searchPlaceholder = '筛选本地书架'
const sourceSearchBooks = shallowRef<SourceSearchBook[]>([])
const sourceSearchReports = ref<SourceSearchReport[]>([])
const sourceSearchErrorMessage = ref('')
const sourceSearchActive = ref(false)
const sourceSearchKeyword = ref('')
const isSearchingSources = ref(false)
const sourceSearchDialogVisible = ref(false)
const sourceSearchInput = ref('')
const sourceSearchReportsExpanded = ref(false)
const apiTargetName = ref(getApiTargetName())
let sourceSearchRunId = 0
let sourceSearchAbortController: AbortController | undefined
const apiTargetTagType = computed(() =>
  apiTargetName.value === 'PostgreSQL 持久化'
    ? 'success'
    : apiTargetName.value === '浏览器本地'
      ? 'warning'
      : 'info',
)
const dragImportDescription = computed(() =>
  apiTargetName.value === 'PostgreSQL 持久化'
    ? 'TXT 会保存到 PostgreSQL 持久化书架'
    : apiTargetName.value === '浏览器本地'
      ? 'TXT 会保存到浏览器本地书架'
      : 'TXT 会保存到当前可用数据存储',
)
const books = computed(() =>
  sourceSearchActive.value
    ? sourceSearchBooks.value
    : searchWord.value === ''
      ? shelf.value
      : filterShelfBooks(shelf.value, searchWord.value),
)
const showStandaloneEmptyState = computed(
  () =>
    !sourceSearchActive.value && !isLoading.value && shelf.value.length === 0,
)
const isLocalSearching = computed(
  () => !sourceSearchActive.value && searchWord.value.trim() !== '',
)
const showLocalSearchEmptyState = computed(
  () => isLocalSearching.value && books.value.length === 0,
)

type SourceSearchReportTagType = 'success' | 'info' | 'warning' | 'danger'

const sourceSearchReportMeta: Record<
  SourceSearchReport['status'],
  { label: string; type: SourceSearchReportTagType }
> = {
  success: { label: '搜索成功', type: 'success' },
  empty: { label: '请求成功无结果', type: 'info' },
  failed: { label: '请求/解析失败', type: 'danger' },
  unsupported: { label: '规则不支持', type: 'warning' },
  skipped: { label: '已跳过', type: 'info' },
  truncated: { label: '结果截断', type: 'info' },
}
const sourceSearchReportStatusOrder: SourceSearchReport['status'][] = [
  'success',
  'empty',
  'failed',
  'unsupported',
  'skipped',
  'truncated',
]
const sourceSearchReportCounts = computed(() =>
  sourceSearchReports.value.reduce(
    (counts, report) => {
      counts[report.status] += 1
      return counts
    },
    {
      success: 0,
      empty: 0,
      failed: 0,
      unsupported: 0,
      skipped: 0,
      truncated: 0,
    } satisfies Record<SourceSearchReport['status'], number>,
  ),
)
const sourceSearchReportCountItems = computed(() =>
  sourceSearchReportStatusOrder
    .map(status => ({
      status,
      label: sourceSearchReportMeta[status].label,
      type: sourceSearchReportMeta[status].type,
      count: sourceSearchReportCounts.value[status],
    }))
    .filter(item => item.count > 0),
)
const sourceSearchIssueStatusPriority: Record<
  SourceSearchReport['status'],
  number
> = {
  failed: 0,
  unsupported: 1,
  empty: 2,
  skipped: 3,
  truncated: 4,
  success: 5,
}
const sourceSearchIssueReports = computed(() =>
  sourceSearchReports.value
    .filter(report => report.status !== 'success' || report.count === 0)
    .slice()
    .sort(
      (left, right) =>
        sourceSearchIssueStatusPriority[left.status] -
          sourceSearchIssueStatusPriority[right.status] ||
        left.sourceName.localeCompare(right.sourceName),
    ),
)
const sourceSearchReportPreviewLimit = 8
const sourceSearchReportDetails = computed(() =>
  sourceSearchReportsExpanded.value
    ? sourceSearchReports.value
    : sourceSearchIssueReports.value.slice(0, sourceSearchReportPreviewLimit),
)
const sourceSearchReportHiddenCount = computed(() =>
  Math.max(
    0,
    sourceSearchReportsExpanded.value
      ? 0
      : sourceSearchIssueReports.value.length - sourceSearchReportPreviewLimit,
  ),
)
const sourceSearchCanToggleReports = computed(
  () =>
    sourceSearchReportsExpanded.value ||
    sourceSearchReportDetails.value.length < sourceSearchReports.value.length,
)
const sourceSearchShowReportDetails = computed(
  () =>
    sourceSearchReportDetails.value.length > 0 ||
    sourceSearchCanToggleReports.value,
)
const sourceSearchSuccessHidden = computed(
  () =>
    !sourceSearchReportsExpanded.value &&
    sourceSearchReports.value.some(
      report => report.status === 'success' && report.count > 0,
    ),
)
const sourceSearchReportToggleText = computed(() =>
  sourceSearchReportsExpanded.value
    ? '收起搜索明细'
    : `查看全部 ${sourceSearchReports.value.length} 条搜索明细`,
)
const sourceSearchReportDetailsTitle = computed(() => {
  if (sourceSearchReportsExpanded.value) return '全部搜索明细'
  if (sourceSearchIssueReports.value.length === 0) return '搜索明细'
  return sourceSearchReportHiddenCount.value > 0
    ? `问题明细，另有 ${sourceSearchReportHiddenCount.value} 条已收起`
    : '问题明细'
})
const sourceSearchReportSummaryText = computed(() => {
  const counts = sourceSearchReportCountItems.value
    .map(item => `${item.label} ${item.count}`)
    .join(' · ')
  return counts
    ? `${counts} · 返回结果 ${sourceSearchBooks.value.length} 本`
    : `返回结果 ${sourceSearchBooks.value.length} 本`
})
const sourceSearchTopIssues = computed(() => {
  const messages: string[] = []
  const { failed: failedCount, unsupported: unsupportedCount, empty: emptyCount } =
    sourceSearchReportCounts.value
  if (failedCount > 0) messages.push(`${failedCount} 个源请求失败或被目标站拦截`)
  if (unsupportedCount > 0)
    messages.push(`${unsupportedCount} 个源依赖 JS、Cookie 或登录规则`)
  if (emptyCount > 0) messages.push(`${emptyCount} 个源请求成功但规则未命中`)
  return messages.slice(0, 3)
})
const sourceSearchTipText = computed(() =>
  apiTargetName.value === 'PostgreSQL 持久化'
    ? '点击卡片打开来源站详情；点击“加入书架”会通过生产服务解析详情/目录并保存到 PostgreSQL，阅读章节时按需解析正文并缓存。复杂 JS、登录、CookieJar 和反爬规则仍不支持。'
    : `点击卡片打开来源站详情；点击“加入书架”需要生产服务解析详情/目录并保存，当前为${apiTargetName.value}模式，纯静态/浏览器本地降级模式不支持书源结果入库。复杂 JS、登录、CookieJar 和反爬规则仍不支持。`,
)
const sourceSearchEmptyMessage = computed(
  () =>
    sourceSearchErrorMessage.value ||
    getSourceSearchEmptyMessage(sourceSearchReports.value),
)

const sourceSearchReportStatusText = (status: SourceSearchReport['status']) =>
  sourceSearchReportMeta[status].label

const sourceSearchReportTagType = (status: SourceSearchReport['status']) =>
  sourceSearchReportMeta[status].type

const formatSourceSearchReportMessage = (message: string) => {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (sourceSearchReportsExpanded.value) return normalized
  return normalized.length > 220
    ? `${normalized.slice(0, 220).trimEnd()}…`
    : normalized
}

const getSourceSearchReportTitle = (report: SourceSearchReport) =>
  `${sourceSearchReportStatusText(report.status)} · ${report.sourceName}：${report.message.replace(/\s+/g, ' ').trim()}`

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
    })
    if (currentRunId !== sourceSearchRunId || controller.signal.aborted) return
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
      ElMessage.warning(getSourceSearchEmptyMessage(sourceSearchReports.value))
    }
  } catch (error) {
    if (currentRunId !== sourceSearchRunId || controller.signal.aborted) return
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

const openBookSourceManager = () => {
  router.push({ path: '/bookSource' })
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

const clearSourceSearch = () => {
  cancelSourceSearchRequest()
  resetSourceSearchState()
}

const {
  fileInput,
  backupFileInput,
  isDraggingFile,
  importLocalBooks,
  handleShelfDragEnter,
  handleShelfDragOver,
  handleShelfDragLeave,
  handleShelfDrop,
  exportStandaloneBackup,
  importStandaloneBackup,
  clearStandaloneData,
} = useStandaloneBookImport({
  loadingWrapper,
  reloadShelf: () => store.loadBookShelf(true),
  setReadConfig: config => store.setConfig(config),
  resetReadingRecent,
})

const handleBookDelete = async (book: Book) => {
  try {
    await ElMessageBox.confirm(
      `确定从本地书架删除《${book.name}》？`,
      '删除书籍',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }
  try {
    const result = await API.deleteBook(book)
    if (result.data.isSuccess) {
      ElMessage.success(result.data.data)
      await store.loadBookShelf(true)
      if (readingRecent.value.bookUrl === book.bookUrl) {
        resetReadingRecent()
        clearReadingSession()
      }
    } else {
      ElMessage.error(result.data.errorMsg)
    }
  } catch (error) {
    ElMessage.error(`删除失败：${getErrorMessage(error)}`)
  }
}

const isSourceSearchBook = (
  book: Book | SourceSearchBook,
): book is SourceSearchBook =>
  'entryType' in book && book.entryType === 'source-search'

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const importingSourceBookKeys = ref(new Set<string>())
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
    let imported: Awaited<ReturnType<typeof store.importSourceBook>> | undefined
    await loadingWrapper(
      store.importSourceBook(book).then(result => {
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
    searchWord.value = ''
  } catch (error) {
    ElMessage.error(`加入书架失败：${getErrorMessage(error)}`)
  } finally {
    setSourceBookImporting(key, false)
  }
}

const handleBookClick = (book: Book | SourceSearchBook) => {
  if (isSourceSearchBook(book)) {
    if (!isHttpUrl(book.bookUrl)) {
      ElMessage.warning('书源搜索结果只能打开 http/https 链接')
      return
    }
    const opened = window.open(book.bookUrl, '_blank', 'noopener,noreferrer')
    if (opened === null) ElMessage.warning('浏览器阻止了外部详情页弹窗')
    return
  }
  const { chapterIndex, chapterPos } = getBookReadPosition(book)
  toDetail(book.bookUrl, book.name, book.author, chapterIndex, chapterPos)
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

const toDetail = (
  bookUrl: string,
  bookName: string,
  bookAuthor: string,
  chapterIndex: number,
  chapterPos: number,
  isSearchBook: boolean | undefined = false,
  fromReadRecentClick = false,
) => {
  if (bookName === '尚无阅读记录') return
  if (fromReadRecentClick && !hasBookOnShelf(shelf.value, bookUrl)) {
    ElMessage.warning('最近阅读的书籍已不在书架，请重新导入或重新加入书架')
    resetReadingRecent()
    clearReadingSession()
    return
  }

  const recent: ReadingRecentBook = {
    name: bookName,
    author: bookAuthor,
    bookUrl,
    chapterIndex,
    chapterPos,
    isSearchBook: isSearchBook ?? false,
  }
  saveReadingSession(recent)
  readingRecent.value = recent
  saveReadingRecent(recent)
  router.push({
    path: '/chapter',
  })
}

const loadShelf = async () => {
  await store.loadWebConfig()
  await store.saveBookProgress()
  await store.loadBookShelf(true)
}

onMounted(() => {
  //获取最近阅读书籍
  restoreReadingRecent()
  void loadingWrapper(loadShelf()).catch(error => {
    ElMessage.error(`加载书架失败：${getErrorMessage(error)}`)
  })
})

onUnmounted(
  subscribeApiAvailability(() => {
    apiTargetName.value = getApiTargetName()
  }),
)
</script>

<style lang="scss" scoped>
.index-wrapper {
  --shelf-sidebar-bg: #f7f7f7;
  --shelf-main-bg: #f5f7fb;
  --shelf-panel-bg: rgba(255, 255, 255, 0.78);
  --shelf-panel-border: #e5e9f0;
  --shelf-text: #33373d;
  --shelf-muted: #606975;
  --shelf-soft-muted: #8a94a3;
  --shelf-radius: 16px;

  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;
  color: var(--shelf-text);
  background: var(--shelf-main-bg);

  .navigation-wrapper {
    width: 260px;
    min-width: 260px;
    padding: 48px 36px;
    background:
      radial-gradient(circle at 16% 4%, rgba(64, 158, 255, 0.14), transparent 32%),
      var(--shelf-sidebar-bg);
    border-right: 1px solid var(--shelf-panel-border);

    .navigation-title {
      font-size: 24px;
      font-weight: 700;
      font-family: FZZCYSK;
      color: var(--shelf-text);
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 300;
      font-family: FZZCYSK;
      margin-top: 16px;
      color: var(--shelf-muted);
    }

    .search-wrapper {
      .search-input {
        border-radius: 50%;
        margin-top: 24px;

        :deep(.el-input__wrapper) {
          border-radius: 50px;
          border-color: #e3e3e3;
        }
      }
    }

    .bottom-wrapper {
      display: flex;
      flex-direction: column;
    }

    .recent-wrapper {
      margin-top: 36px;

      .recent-title {
        font-size: 14px;
        color: var(--shelf-muted);
        font-family: FZZCYSK;
      }

      .reading-recent {
        margin: 18px 0;

        .recent-book {
          font-size: 12px;
          cursor: pointer;

          &.no-point {
            pointer-events: none;
            cursor: default;
          }
        }
      }
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: var(--shelf-muted);
        font-family: FZZCYSK;
      }

      .setting-connect {
        font-size: 12px;
        margin-top: 16px;
        cursor: default;
      }

      .standalone-action-button {
        margin: 0;
      }

      .setting-item {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        margin-top: 16px;

        :deep(.el-button + .el-button) {
          margin-left: 0;
        }
      }
    }

    .bottom-icons {
      position: fixed;
      bottom: 0;
      height: 120px;
      width: 260px;
      align-items: center;
      display: flex;
      flex-direction: row;

      .bottom-icon {
        opacity: 0.72;
        transition:
          opacity 0.18s ease,
          transform 0.18s ease;

        &:hover {
          opacity: 1;
          transform: translateY(-2px);
        }
      }
    }
  }

  .hidden-file-input {
    display: none;
  }

  .source-search-dialog {
    p {
      margin: 0 0 14px;
      color: var(--shelf-muted);
      line-height: 1.7;
    }
  }

  .shelf-wrapper {
    position: relative;
    padding: 48px 48px;
    width: 100%;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    overflow: hidden;
    background:
      radial-gradient(circle at 78% 10%, rgba(103, 194, 58, 0.1), transparent 28%),
      var(--shelf-main-bg);
    transition:
      background-color 0.2s ease,
      outline-color 0.2s ease;

    .shelf-feature-bar,
    .source-search-summary {
      display: flex;
      box-sizing: border-box;
      border: 1px solid var(--shelf-panel-border);
      border-radius: var(--shelf-radius);
      color: var(--shelf-text);
      background: var(--shelf-panel-bg);
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
      backdrop-filter: blur(10px);
    }

    .shelf-feature-bar {
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      padding: 16px 18px;
    }

    .shelf-feature-text {
      display: flex;
      flex-direction: column;
      gap: 6px;

      span {
        color: var(--shelf-muted);
        font-size: 14px;
      }
    }

    .shelf-feature-actions,
    .empty-shelf-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .shelf-feature-actions {
      justify-content: flex-end;
    }

    .empty-shelf-actions {
      justify-content: center;
    }

    .source-search-summary {
      flex-direction: column;
      margin-bottom: 18px;
      padding: 16px 18px;
    }

    .source-search-summary-heading {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
    }

    .source-search-title {
      font-size: 16px;
    }

    .source-search-subtitle {
      margin-top: 6px;
      color: var(--shelf-soft-muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .source-search-keyword {
      margin-left: 6px;
      color: var(--shelf-muted);
    }

    .source-search-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;

      :deep(.el-button + .el-button) {
        margin-left: 0;
      }
    }

    .source-search-report,
    .source-search-report-details,
    .source-search-tip,
    .source-search-quick-hint {
      margin-top: 10px;
      color: var(--shelf-muted);
      font-size: 14px;
      line-height: 1.6;
    }

    .source-search-report {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .source-search-report-details {
      max-height: 220px;
      overflow: auto;
      padding: 10px 12px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 12px;
      background: rgba(248, 250, 252, 0.72);
    }

    .source-search-report-details-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
      color: var(--shelf-soft-muted);
      font-size: 12px;
    }

    .source-search-report-detail {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 0;
      overflow-wrap: anywhere;

      & + .source-search-report-detail {
        border-top: 1px dashed rgba(148, 163, 184, 0.2);
      }
    }

    .source-search-report-source {
      flex: 0 0 auto;
      max-width: 160px;
      color: var(--shelf-text);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .source-search-report-message {
      min-width: 0;
      white-space: normal;
    }

    .source-search-quick-hint {
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(230, 162, 60, 0.1);
    }

    .source-search-report-toggle {
      margin-top: 4px;
      padding-left: 0;
    }

    .source-search-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 260px;
      padding: 24px;
      box-sizing: border-box;
      border: 1px dashed var(--shelf-panel-border);
      border-radius: 18px;
      color: var(--shelf-muted);
      text-align: center;
      line-height: 1.8;
      background: var(--shelf-panel-bg);
    }

    &.drag-over {
      background-color: rgba(64, 158, 255, 0.08);
      outline: 2px dashed rgba(64, 158, 255, 0.45);
      outline-offset: -14px;
    }

    .empty-shelf-state {
      flex: 1;
      min-height: calc(100vh - 96px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      border: 1px dashed var(--shelf-panel-border);
      border-radius: 18px;
      text-align: center;
      color: var(--shelf-text);
      background: var(--shelf-panel-bg);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
    }

    .empty-shelf-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 12px;
      font-family: FZZCYSK;
    }

    .empty-shelf-description {
      color: var(--shelf-muted);
      font-size: 14px;
      line-height: 1.7;
      margin-bottom: 24px;

      p {
        margin: 0;
      }

      p + p {
        margin-top: 4px;
      }
    }

    .drag-import-mask {
      position: absolute;
      inset: 32px;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      border: 2px dashed #409eff;
      border-radius: 18px;
      color: #409eff;
      background: rgba(255, 255, 255, 0.88);
      pointer-events: none;
    }

    .drag-import-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 10px;
    }

    .drag-import-description {
      font-size: 14px;
      color: var(--shelf-muted);
    }
  }
}

@media screen and (max-width: 750px) {
  .index-wrapper {
    overflow-x: hidden;
    flex-direction: column;

    .navigation-wrapper {
      padding: 20px 24px;
      box-sizing: border-box;
      width: 100%;

      .navigation-title-wrapper {
        white-space: nowrap;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
      }

      .bottom-wrapper {
        flex-direction: column;

        > * {
          margin-top: 18px;

          .reading-recent,
          .setting-item {
            margin-bottom: 0;
          }
        }
      }

      .setting-wrapper {
        margin-top: 18px;

        .setting-item {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }

        .setting-connect,
        .standalone-action-button {
          margin: 0;
        }

        .standalone-action-button {
          display: inline-flex;
        }
      }

      .bottom-icons {
        display: none;
      }
    }

    .shelf-wrapper {
      padding: 0;
      flex-grow: 1;

      &.drag-over {
        outline-offset: -8px;
      }

      .empty-shelf-state {
        min-height: 360px;
        margin: 16px;
        padding: 32px 18px;
      }

      .shelf-feature-bar {
        display: none;
      }

      .source-search-summary,
      .source-search-empty {
        margin: 16px;
      }

      .source-search-summary-heading,
      .source-search-report-details-header {
        flex-direction: column;
        align-items: stretch;
      }

      .source-search-actions {
        justify-content: flex-start;
      }

      .source-search-keyword {
        display: inline-block;
        max-width: 100%;
        margin-left: 0;
        overflow-wrap: anywhere;
      }

      .source-search-report-source {
        max-width: 42vw;
      }

      .drag-import-mask {
        inset: 12px;
      }

      :deep(.el-loading-spinner) {
        display: none;
      }
    }
  }
}

.night {
  --shelf-sidebar-bg: #202326;
  --shelf-main-bg: #14171a;
  --shelf-panel-bg: rgba(31, 35, 39, 0.78);
  --shelf-panel-border: #343a42;
  --shelf-text: #d7dbe0;
  --shelf-muted: #a0a7b0;
  --shelf-soft-muted: #7f8792;

  .navigation-wrapper {
    background:
      radial-gradient(circle at 16% 4%, rgba(64, 158, 255, 0.12), transparent 32%),
      var(--shelf-sidebar-bg);

    .navigation-title {
      color: var(--shelf-text);
    }

    .search-wrapper {
      .search-input {
        :deep(.el-input__wrapper) {
          background-color: #454545;
        }

        :deep(.el-input__inner) {
          color: #b1b1b1;
        }
      }
    }
  }

  .shelf-wrapper {
    background:
      radial-gradient(circle at 78% 10%, rgba(103, 194, 58, 0.08), transparent 28%),
      var(--shelf-main-bg);

    &.drag-over {
      background-color: rgba(64, 158, 255, 0.12);
    }

    .source-search-report-details {
      border-color: rgba(148, 163, 184, 0.16);
      background: rgba(17, 24, 39, 0.42);
    }

    .source-search-quick-hint {
      background: rgba(230, 162, 60, 0.14);
    }

    .source-search-report-detail + .source-search-report-detail {
      border-top-color: rgba(148, 163, 184, 0.14);
    }

    .drag-import-mask {
      background: rgba(22, 24, 25, 0.9);
    }
  }
}
</style>
