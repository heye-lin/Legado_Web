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
          @keyup.enter="searchBook"
        >
        </el-input>
      </div>
      <div class="bottom-wrapper">
        <div class="recent-wrapper">
          <div class="recent-title">最近阅读</div>
          <div class="reading-recent">
            <el-tag
              :type="
                readingRecent.name == '尚无阅读记录' ? 'warning' : 'primary'
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
                  readingRecent.isSeachBook,
                  true,
                )
              "
              :class="{ 'no-point': readingRecent.bookUrl == '' }"
            >
              {{ readingRecent.name }}
            </el-tag>
          </div>
        </div>
        <div class="setting-wrapper">
          <div class="setting-title">基本设定</div>
          <div class="setting-item">
            <el-tag
              :type="connectType"
              size="large"
              class="setting-connect"
              :class="{ 'no-point': newConnect }"
              @click="setLegadoRetmoteUrl"
            >
              {{ connectStatus }}
            </el-tag>
            <el-button
              v-if="isStandaloneMode"
              class="standalone-action-button"
              type="primary"
              size="small"
              @click="fileInput?.click()"
            >
              导入 TXT
            </el-button>
            <el-button
              v-if="isStandaloneMode"
              class="standalone-action-button"
              size="small"
              @click="exportStandaloneBackup"
            >
              导出备份
            </el-button>
            <el-button
              v-if="isStandaloneMode"
              class="standalone-action-button"
              size="small"
              @click="backupFileInput?.click()"
            >
              恢复备份
            </el-button>
            <el-button
              v-if="isStandaloneMode"
              class="standalone-action-button"
              type="danger"
              size="small"
              @click="clearStandaloneData"
            >
              清空本地数据
            </el-button>
          </div>
        </div>
      </div>
      <div class="bottom-icons">
        <a
          href="https://github.com/gedoor/legado_web_bookshelf"
          target="_blank"
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
      <div v-if="showStandaloneEmptyState" class="empty-shelf-state">
        <div class="empty-shelf-title">导入 TXT 开始阅读</div>
        <div class="empty-shelf-description">
          选择本地 TXT 文件，或直接拖拽到书架区域导入。
        </div>
        <el-button type="primary" size="large" @click="fileInput?.click()">
          导入 TXT
        </el-button>
      </div>
      <book-items
        v-else
        :books="books"
        @bookClick="handleBookClick"
        @bookDelete="handleBookDelete"
        :isSearch="isSearching"
      ></book-items>
      <div v-if="isDraggingFile" class="drag-import-mask">
        <div class="drag-import-title">释放鼠标导入 TXT</div>
        <div class="drag-import-description">TXT 会保存在浏览器本地书架中</div>
      </div>
    </div>
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
import { baseURL_localStorage_key } from '@/api/axios'
import API, {
  legado_http_entry_point,
  parseLeagdoHttpUrlWithDefault,
  setApiEntryPoint,
  isStandaloneMode,
} from '@api'
import { validatorHttpUrl } from '@/utils/utils'
import type { Book, SeachBook } from '@/book'
import type { webReadConfig } from '@/web'
import {
  type BookshelfBook,
  type ReadingRecentBook,
  clearReadingSession,
  clearStoredReadingRecent,
  createDefaultReadingRecent,
  filterShelfBooks,
  getBookReadPosition,
  getErrorMessage,
  hasBookOnShelf,
  isSearchBook,
  loadStoredReadingRecent,
  saveReadingRecent,
  saveReadingSession,
} from '@/utils/bookshelf'

const store = useBookStore()
const isNight = computed(() => store.isNight)
const shelf = computed(() => store.shelf)

const readingRecent = ref<ReadingRecentBook>(createDefaultReadingRecent())
const resetReadingRecent = () => {
  readingRecent.value = createDefaultReadingRecent()
  clearStoredReadingRecent()
}

const restoreReadingRecent = () => {
  const storedRecent = loadStoredReadingRecent()
  if (storedRecent !== undefined) readingRecent.value = storedRecent
}

/** shortcuts of `store.setConfig` */
const applyReadConfig = (config?: webReadConfig) => {
  try {
    if (config !== undefined) store.setConfig(config)
  } catch {
    ElMessage.info('阅读界面配置解析错误')
  }
}

const shelfWrapper = ref<HTMLElement>()
const { showLoading, closeLoading, loadingWrapper, isLoading } = useLoading(
  shelfWrapper,
  '正在获取书籍信息',
)

// 书架书籍和在线书籍搜索
const books = shallowRef<Book[] | SeachBook[]>([])
const searchWord = ref('')
const searchPlaceholder = computed(() =>
  isStandaloneMode
    ? '搜索本地书架，点击“导入 TXT”添加书籍'
    : '搜索书籍，在线书籍自动加入书架',
)
const isSearching = ref(false)
let activeOnlineSearchId = 0

const isActiveOnlineSearch = (searchId: number, searchKey: string) =>
  searchId === activeOnlineSearchId &&
  isSearching.value &&
  searchWord.value === searchKey

const finishStaleOnlineSearch = (searchId: number, searchKey: string) => {
  if (searchId !== activeOnlineSearchId || searchWord.value === searchKey) {
    return
  }
  if (isLoading.value) closeLoading()
  isSearching.value = false
}

const showStandaloneEmptyState = computed(
  () =>
    isStandaloneMode &&
    !isLoading.value &&
    !isSearching.value &&
    shelf.value.length === 0,
)

watchEffect(() => {
  if (isSearching.value && searchWord.value !== '') return
  isSearching.value = false
  books.value =
    searchWord.value === ''
      ? shelf.value
      : filterShelfBooks(shelf.value, searchWord.value)
})

const searchLocalShelf = () => {
  isSearching.value = false
  books.value = filterShelfBooks(shelf.value, searchWord.value)
  if (books.value.length === 0) ElMessage.info('本地书架中没有匹配书籍')
}

//搜索在线书籍
const searchBook = () => {
  if (searchWord.value === '') return
  if (isStandaloneMode) {
    searchLocalShelf()
    return
  }
  const searchKey = searchWord.value
  const searchId = ++activeOnlineSearchId
  books.value = []
  store.clearSearchBooks()
  showLoading()
  isSearching.value = true
  API.search(
    searchKey,
    searchBooks => {
      if (!isActiveOnlineSearch(searchId, searchKey)) {
        finishStaleOnlineSearch(searchId, searchKey)
        return
      }
      if (isLoading.value) closeLoading()
      try {
        store.setSearchBooks(searchBooks)
        books.value = store.searchBooks
      } catch (e) {
        ElMessage.error('后端数据错误')
        throw e
      }
    },
    () => {
      if (!isActiveOnlineSearch(searchId, searchKey)) {
        finishStaleOnlineSearch(searchId, searchKey)
        return
      }
      closeLoading()
      if (books.value.length === 0) {
        ElMessage.info('搜索结果为空')
      }
    },
  )
}

//连接状态
const connectionStore = useConnectionStore()
const { connectStatus, connectType, newConnect } = storeToRefs(connectionStore)

const setLegadoRetmoteUrl = () => {
  if (isStandaloneMode) {
    ElMessageBox.alert(
      '当前是纯 Web 本地模式：书籍、章节、阅读进度、阅读配置和源配置都保存在浏览器 IndexedDB/localStorage 中；不需要 Android App，也不会连接后端。',
      '纯 Web 模式',
      { confirmButtonText: '知道了' },
    )
    return
  }
  ElMessageBox.prompt(
    '请输入 后端地址 ( 如：http://127.0.0.1:9527 或者通过内网穿透的地址)',
    '提示',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPlaceholder: legado_http_entry_point,
      inputValidator: value => validatorHttpUrl(value),
      inputErrorMessage: '输入的格式不对',
      beforeClose: (action, instance, done) => {
        if (action === 'confirm') {
          connectionStore.setNewConnect(true)
          instance.confirmButtonLoading = true
          instance.confirmButtonText = '校验中……'
          const url = new URL(instance.inputValue).toString()
          API.getReadConfig(url)
            .then(function (config) {
              connectionStore.setNewConnect(false)
              applyReadConfig(config)
              instance.confirmButtonLoading = false
              store.clearSearchBooks()
              setApiEntryPoint(...parseLeagdoHttpUrlWithDefault(url))
              if (url === location.origin) {
                localStorage.removeItem(baseURL_localStorage_key)
              } else {
                localStorage.setItem(baseURL_localStorage_key, url)
              }
              store.loadBookShelf(true)
              done()
            })
            .catch(function (error) {
              connectionStore.setNewConnect(false)
              instance.confirmButtonLoading = false
              instance.confirmButtonText = '确定'
              throw error
            })
        } else {
          done()
        }
      },
    },
  )
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
  clearSearchBooks: () => store.clearSearchBooks(),
  resetReadingRecent,
})

const router = useRouter()
const handleBookDelete = async (book: BookshelfBook) => {
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

const handleBookClick = async (book: BookshelfBook) => {
  const isSeachBook = isSearchBook(book)
  if (isSeachBook) {
    await API.saveBook(book)
  }
  const { chapterIndex, chapterPos } = getBookReadPosition(book)
  toDetail(
    book.bookUrl,
    book.name,
    book.author,
    chapterIndex,
    chapterPos,
    isSeachBook,
  )
}

const toDetail = (
  bookUrl: string,
  bookName: string,
  bookAuthor: string,
  chapterIndex: number,
  chapterPos: number,
  isSeachBook: boolean | undefined = false,
  fromReadRecentClick = false,
) => {
  if (bookName === '尚无阅读记录') return
  // 最近书籍不再书架上 自动搜索
  if (fromReadRecentClick && !hasBookOnShelf(shelf.value, bookUrl)) {
    searchWord.value = bookName
    searchBook()
    return
  }

  const recent: ReadingRecentBook = {
    name: bookName,
    author: bookAuthor,
    bookUrl,
    chapterIndex,
    chapterPos,
    isSeachBook: isSeachBook ?? false,
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
  //确保各种网络情况下同步请求先完成
  await store.loadBookShelf(true)
}

onMounted(() => {
  //获取最近阅读书籍
  restoreReadingRecent()
  console.log('bookshelf mounted')
  loadingWrapper(loadShelf())
})
</script>

<style lang="scss" scoped>
.index-wrapper {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: row;

  .navigation-wrapper {
    width: 260px;
    min-width: 260px;
    padding: 48px 36px;
    background-color: #f7f7f7;

    .navigation-title {
      font-size: 24px;
      font-weight: 500;
      font-family: FZZCYSK;
    }

    .navigation-sub-title {
      font-size: 16px;
      font-weight: 300;
      font-family: FZZCYSK;
      margin-top: 16px;
      color: #b1b1b1;
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
        color: #b1b1b1;
        font-family: FZZCYSK;
      }

      .reading-recent {
        margin: 18px 0;

        .recent-book {
          font-size: 10px;
          /*           // font-weight: 400;
          // margin: 12px 0;
          // font-weight: 500;
          // color: #6B7C87; */
          cursor: pointer;
          /*           // padding: 6px 18px; */
        }
      }
    }

    .setting-wrapper {
      margin-top: 36px;

      .setting-title {
        font-size: 14px;
        color: #b1b1b1;
        font-family: FZZCYSK;
      }

      .no-point {
        pointer-events: none;
      }

      .setting-connect {
        font-size: 8px;
        margin-top: 16px;
        /*         // color: #6B7C87; */
        cursor: pointer;
      }

      .standalone-action-button {
        display: block;
        margin-top: 12px;
        margin-left: 0;
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
    }
  }

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
    transition:
      background-color 0.2s ease,
      outline-color 0.2s ease;

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
      border: 1px dashed #dcdfe6;
      border-radius: 18px;
      text-align: center;
      color: #33373d;
      background: rgba(255, 255, 255, 0.56);
    }

    .empty-shelf-title {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 12px;
      font-family: FZZCYSK;
    }

    .empty-shelf-description {
      color: #8a8f99;
      font-size: 14px;
      line-height: 1.7;
      margin-bottom: 24px;
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
      color: #6f7b8a;
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
        flex-direction: row;

        > * {
          flex-grow: 1;
          margin-top: 18px;

          .reading-recent,
          .setting-item {
            margin-bottom: 0px;
          }
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
  .navigation-wrapper {
    background-color: #454545;

    .navigation-title {
      color: #aeaeae;
    }

    .search-wrapper {
      .search-input {
        .el-input__wrapper {
          background-color: #454545;
        }

        .el-input__inner {
          color: #b1b1b1;
        }
      }
    }
  }

  .shelf-wrapper {
    background-color: #161819;

    &.drag-over {
      background-color: rgba(64, 158, 255, 0.12);
    }

    .empty-shelf-state {
      border-color: #3d434a;
      color: #d5d8dc;
      background: rgba(255, 255, 255, 0.04);
    }

    .empty-shelf-description,
    .drag-import-description {
      color: #9aa1aa;
    }

    .drag-import-mask {
      background: rgba(22, 24, 25, 0.9);
    }
  }
}
</style>
