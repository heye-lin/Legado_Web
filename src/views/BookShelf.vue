<template>
  <div :class="{ 'index-wrapper': true, night: isNight, day: !isNight }">
    <shelf-sidebar
      v-model:search-word="searchWord"
      :search-placeholder="searchPlaceholder"
      :is-searching-sources="isSearchingSources"
      :reading-recent="readingRecent"
      :api-target-name="apiTargetName"
      :api-target-tag-type="apiTargetTagType"
      :github-url="githubUrl"
      @source-search="searchBook"
      @clear-source-search="clearSourceSearch"
      @recent-click="openReadingRecent"
      @open-source-manager="openBookSourceManager"
      @open-source-search-dialog="openSourceSearchDialog"
      @import-txt="fileInput?.click()"
      @export-backup="exportStandaloneBackup"
      @restore-backup="backupFileInput?.click()"
      @clear-data="clearStandaloneData"
    />
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
      <shelf-feature-bar
        v-if="
          !showStandaloneEmptyState &&
          !sourceSearchActive &&
          !isSearchingSources
        "
        @open-source-manager="openBookSourceManager"
        @open-source-search-dialog="openSourceSearchDialog"
      />
      <source-search-panel
        v-if="sourceSearchActive || isSearchingSources"
        :keyword="sourceSearchKeyword"
        :is-searching="isSearchingSources"
        :result-count="sourceSearchBooks.length"
        :reports="sourceSearchReports"
        :api-target-name="apiTargetName"
        v-model:reports-expanded="sourceSearchReportsExpanded"
        @retry="searchBook"
        @clear="clearSourceSearch"
        @manage="openBookSourceManager"
      />
      <shelf-empty-state
        v-if="showStandaloneEmptyState"
        @import-txt="fileInput?.click()"
        @open-source-manager="openBookSourceManager"
        @open-source-search-dialog="openSourceSearchDialog"
      />
      <div v-else-if="isSearchingSources" class="source-search-empty">
        正在搜索「{{
          sourceSearchKeyword
        }}」，可点击“取消”或“返回书架”中止搜索。
      </div>
      <div v-else-if="showLocalSearchEmptyState" class="source-search-empty">
        本地书架没有匹配「{{
          searchWord.trim()
        }}」的书籍。可清空关键词，或点击“在线搜书”搜索在线书籍。
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
      <drag-import-mask
        v-if="isDraggingFile"
        :description="dragImportDescription"
      />
    </div>
    <source-search-dialog
      v-model="sourceSearchDialogVisible"
      v-model:keyword="sourceSearchInput"
      v-model:source-keyword="sourceSearchSourceKeyword"
      v-model:enabled="sourceSearchEnabledFilter"
      v-model:feature="sourceSearchFeatureFilter"
      v-model:field="sourceSearchFieldFilter"
      :loading="isSearchingSources"
      @confirm="confirmSourceSearchDialog"
      @manage="openBookSourceManager"
      @reset-filters="resetSourceSearchFilters"
    />
    <source-book-preview-dialog
      v-model="previewDialogVisible"
      :book="previewSourceBook"
      :preview="previewResult"
      :loading="isPreviewingSourceBook"
      :error-message="previewErrorMessage"
      :importing="
        previewSourceBook === undefined
          ? false
          : importingSourceBookKeys.has(previewSourceBook.resultKey)
      "
      @import="handleBookImport"
    />
  </div>
</template>

<script setup lang="ts">
import '@/assets/bookshelf.css'
import '@/assets/fonts/shelffont.css'
import DragImportMask from '@/components/bookshelf/DragImportMask.vue'
import ShelfEmptyState from '@/components/bookshelf/ShelfEmptyState.vue'
import ShelfFeatureBar from '@/components/bookshelf/ShelfFeatureBar.vue'
import ShelfSidebar from '@/components/bookshelf/ShelfSidebar.vue'
import SourceBookPreviewDialog from '@/components/SourceBookPreviewDialog.vue'
import SourceSearchDialog from '@/components/SourceSearchDialog.vue'
import SourceSearchPanel from '@/components/SourceSearchPanel.vue'
import { useBookStore } from '@/store'
import githubUrl from '@/assets/imgs/github.png'
import { useLoading } from '@/hooks/loading'
import { useStandaloneBookImport } from '@/hooks/useStandaloneBookImport'
import { useSourceSearch } from '@/hooks/useSourceSearch'
import API, { getApiTargetName, subscribeApiAvailability } from '@api'
import type { Book, SourceSearchBook } from '@/book'
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
const apiTargetName = ref(getApiTargetName())
const {
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
} = useSourceSearch({
  searchWord,
  loadingWrapper,
  importSourceBook: book => store.importSourceBook(book),
})
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

const openBookSourceManager = () => {
  router.push({ path: '/bookSource' })
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

const handleBookClick = (book: Book | SourceSearchBook) => {
  if (isSourceSearchBook(book)) {
    void openSourceBookPreview(book)
    return
  }
  const { chapterIndex, chapterPos } = getBookReadPosition(book)
  toDetail(book.bookUrl, book.name, book.author, chapterIndex, chapterPos)
}

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

const openReadingRecent = () => {
  toDetail(
    readingRecent.value.bookUrl,
    readingRecent.value.name,
    readingRecent.value.author,
    readingRecent.value.chapterIndex,
    readingRecent.value.chapterPos,
    readingRecent.value.isSearchBook,
    true,
  )
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
  --shelf-subpanel-bg: rgba(248, 250, 252, 0.72);
  --shelf-subpanel-border: rgba(148, 163, 184, 0.18);
  --shelf-warning-bg: rgba(230, 162, 60, 0.1);
  --shelf-divider: rgba(148, 163, 184, 0.2);
  --shelf-drag-mask-bg: rgba(255, 255, 255, 0.88);

  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;
  color: var(--shelf-text);
  background: var(--shelf-main-bg);

  .hidden-file-input {
    display: none;
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
      radial-gradient(
        circle at 78% 10%,
        rgba(103, 194, 58, 0.1),
        transparent 28%
      ),
      var(--shelf-main-bg);
    transition:
      background-color 0.2s ease,
      outline-color 0.2s ease;

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
  }
}

@media screen and (max-width: 750px) {
  .index-wrapper {
    overflow-x: hidden;
    flex-direction: column;

    .shelf-wrapper {
      padding: 0;
      flex-grow: 1;

      &.drag-over {
        outline-offset: -8px;
      }

      .source-search-empty {
        margin: 16px;
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
  --shelf-subpanel-bg: rgba(17, 24, 39, 0.42);
  --shelf-subpanel-border: rgba(148, 163, 184, 0.16);
  --shelf-warning-bg: rgba(230, 162, 60, 0.14);
  --shelf-divider: rgba(148, 163, 184, 0.14);
  --shelf-drag-mask-bg: rgba(22, 24, 25, 0.9);

  .shelf-wrapper {
    background:
      radial-gradient(
        circle at 78% 10%,
        rgba(103, 194, 58, 0.08),
        transparent 28%
      ),
      var(--shelf-main-bg);

    &.drag-over {
      background-color: rgba(64, 158, 255, 0.12);
    }
  }
}
</style>
