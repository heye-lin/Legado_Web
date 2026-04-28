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
              size="small"
              @click="openBookSourceManager"
            >
              书源管理
            </el-button>
            <el-button
              class="standalone-action-button"
              type="primary"
              size="small"
              @click="openSourceSearchDialog"
            >
              书源搜索
            </el-button>
            <el-button
              class="standalone-action-button"
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
          <el-button @click="openBookSourceManager">
            书源管理
          </el-button>
          <el-button type="primary" @click="openSourceSearchDialog">
            书源搜索
          </el-button>
        </div>
      </div>
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
      <div v-if="showStandaloneEmptyState" class="empty-shelf-state">
        <div class="empty-shelf-title">导入 TXT 开始阅读</div>
        <div class="empty-shelf-description">
          <p>选择本地 TXT 文件，或直接拖拽到书架区域导入。</p>
          <p>也可以先进入书源管理导入书源，再搜索在线书籍并加入书架。</p>
        </div>
        <div class="empty-shelf-actions">
          <el-button size="large" @click="fileInput?.click()">
            导入 TXT
          </el-button>
          <el-button size="large" @click="openBookSourceManager">
            书源管理
          </el-button>
          <el-button
            type="primary"
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
        <div class="source-search-filter-grid">
          <el-input
            v-model="sourceSearchSourceKeyword"
            clearable
            placeholder="筛选参与搜索的书源，例如 起点、group:小说、url:qidian"
            aria-label="筛选参与搜索的书源"
          />
          <el-select v-model="sourceSearchEnabledFilter">
            <el-option label="仅启用书源" value="enabled" />
            <el-option label="全部状态" value="all" />
            <el-option label="仅禁用" value="disabled" />
          </el-select>
          <el-select v-model="sourceSearchFeatureFilter">
            <el-option label="仅可搜索" value="searchable" />
            <el-option label="全部能力" value="all" />
            <el-option label="不可搜索" value="unsearchable" />
            <el-option label="CookieJar" value="cookie" />
            <el-option label="JS/动态规则" value="js" />
            <el-option label="登录相关" value="login" />
          </el-select>
          <el-select v-model="sourceSearchFieldFilter">
            <el-option label="全字段匹配" value="all" />
            <el-option label="只搜名称" value="name" />
            <el-option label="只搜地址" value="url" />
            <el-option label="只搜分组" value="group" />
            <el-option label="只搜备注" value="comment" />
            <el-option label="只搜规则" value="rule" />
          </el-select>
        </div>
      </div>
      <template #footer>
        <el-button @click="sourceSearchDialogVisible = false">取消</el-button>
        <el-button @click="openBookSourceManager">
          书源管理
        </el-button>
        <el-button
          type="primary"
          :loading="isSearchingSources"
          @click="confirmSourceSearchDialog"
        >
          开始搜索
        </el-button>
      </template>
    </el-dialog>
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
import SourceBookPreviewDialog from '@/components/SourceBookPreviewDialog.vue'
import SourceSearchPanel from '@/components/SourceSearchPanel.vue'
import { useBookStore } from '@/store'
import githubUrl from '@/assets/imgs/github.png'
import { useLoading } from '@/hooks/loading'
import { useStandaloneBookImport } from '@/hooks/useStandaloneBookImport'
import { useSourceSearch } from '@/hooks/useSourceSearch'
import { Search as SearchIcon } from '@element-plus/icons-vue'
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

    .source-search-filter-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;

      > :first-child {
        grid-column: 1 / -1;
      }
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

    .shelf-feature-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-sizing: border-box;
      gap: 16px;
      margin-bottom: 18px;
      padding: 16px 18px;
      border: 1px solid var(--shelf-panel-border);
      border-radius: var(--shelf-radius);
      color: var(--shelf-text);
      background: var(--shelf-panel-bg);
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
      backdrop-filter: blur(10px);
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
    .source-search-dialog {
      .source-search-filter-grid {
        grid-template-columns: 1fr;
      }
    }
  }

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

      .source-search-empty {
        margin: 16px;
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

    .drag-import-mask {
      background: rgba(22, 24, 25, 0.9);
    }
  }
}
</style>
