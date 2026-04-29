<template>
  <el-dialog
    v-model="visible"
    class="source-book-preview-dialog"
    width="min(760px, calc(100vw - 32px))"
    :title="dialogTitle"
    :teleported="false"
  >
    <div v-if="book === undefined" class="preview-empty">
      请选择一个搜索结果进行预览。
    </div>

    <div v-else class="preview-body">
      <div class="preview-header">
        <div class="preview-cover">
          <img
            :key="coverUrl"
            :src="coverUrl"
            :alt="`${bookName} 封面`"
            @error="usePlaceholderCover"
          />
        </div>
        <div class="preview-meta">
          <h3 :title="bookName">{{ bookName }}</h3>
          <div
            class="preview-subtitle"
            :title="`${displayBook?.author || '作者未知'} · ${book.sourceName}`"
          >
            <span class="preview-author">
              {{ displayBook?.author || '作者未知' }}
            </span>
            <span class="preview-subtitle-separator">·</span>
            <span class="preview-source-name">{{ book.sourceName }}</span>
          </div>
          <div class="preview-tags">
            <el-tag
              v-if="preview?.alreadyOnShelf"
              type="success"
              effect="plain"
            >
              已在书架
            </el-tag>
            <el-tag v-if="preview" effect="plain">
              目录 {{ preview.chapterCount }} 章
            </el-tag>
            <el-tag v-if="displayBook?.kind" effect="plain">
              {{ displayBook.kind }}
            </el-tag>
            <el-tag v-if="displayBook?.wordCount" effect="plain">
              {{ displayBook.wordCount }}
            </el-tag>
          </div>
          <p v-if="displayBook?.latestChapterTitle" class="preview-line">
            最新：{{ displayBook.latestChapterTitle }}
          </p>
          <p v-if="preview?.notes.length" class="preview-line">
            {{ preview.notes.join('；') }}
          </p>
        </div>
      </div>

      <div v-if="loading" class="preview-state">
        正在解析详情和目录，请稍候…
      </div>
      <el-alert
        v-else-if="errorMessage"
        type="error"
        :closable="false"
        show-icon
        :title="`预览失败：${errorMessage}`"
      />
      <template v-else-if="preview">
        <section v-if="displayIntro" class="preview-section">
          <div class="preview-section-title">简介</div>
          <p class="preview-intro">{{ displayIntro }}</p>
        </section>

        <section class="preview-section">
          <div class="preview-section-title">
            目录
            <span>{{ chapterPreviewText }}</span>
          </div>
          <div v-if="preview.chapters.length === 0" class="preview-no-chapter">
            暂未解析到目录。
          </div>
          <div v-else class="preview-chapters">
            <div
              v-for="chapter in preview.chapters"
              :key="chapter.index"
              class="preview-chapter"
            >
              <span class="preview-chapter-index">
                {{ chapter.index + 1 }}
              </span>
              <span class="preview-chapter-title">{{ chapter.title }}</span>
              <el-tag
                v-if="chapter.isVip"
                class="preview-chapter-tag"
                size="small"
                type="warning"
                effect="plain"
              >
                VIP
              </el-tag>
              <span v-if="chapter.tag" class="preview-chapter-extra">
                {{ chapter.tag }}
              </span>
            </div>
          </div>
        </section>
      </template>
    </div>

    <template #footer>
      <div class="preview-footer" :class="{ 'is-single': !book }">
        <el-button @click="visible = false">关闭</el-button>
        <el-button
          v-if="book"
          type="primary"
          :loading="importing"
          :disabled="loading || !preview || preview.alreadyOnShelf"
          @click="emit('import', book)"
        >
          {{ importButtonText }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import API from '@api'
import type { Book, SourceBookPreviewResult, SourceSearchBook } from '@/book'
import { getDisplayCoverUrl, getPlaceholderCover } from '@/utils/bookCover'

const props = defineProps<{
  modelValue: boolean
  book?: SourceSearchBook
  preview?: SourceBookPreviewResult
  loading: boolean
  errorMessage: string
  importing: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  import: [book: SourceSearchBook]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const displayBook = computed<Book | SourceSearchBook | undefined>(
  () => props.preview?.book ?? props.book,
)

const bookName = computed(() => displayBook.value?.name || '未知书籍')

const dialogTitle = computed(() =>
  props.book === undefined ? '书籍预览' : `预览：${bookName.value}`,
)

const importButtonText = computed(() => {
  if (props.preview?.alreadyOnShelf) return '已在书架'
  if (props.errorMessage) return '预览失败，暂不可加入'
  if (props.preview === undefined) return '等待预览'
  return '加入书架'
})

const stripHtml = (value: string) =>
  value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const displayIntro = computed(() => stripHtml(displayBook.value?.intro ?? ''))

const chapterPreviewText = computed(() => {
  if (props.preview === undefined) return ''
  const visibleCount = props.preview.chapters.length
  if (visibleCount === 0) return '暂未解析到目录'
  return props.preview.chapterCount > visibleCount
    ? `前 ${visibleCount} 章`
    : `${visibleCount} 章`
})

const placeholderCover = computed(() =>
  getPlaceholderCover(
    displayBook.value ?? { name: bookName.value },
    props.book?.sourceName || '书源预览',
  ),
)

const coverUrl = computed(() => {
  return getDisplayCoverUrl(
    displayBook.value?.coverUrl,
    placeholderCover.value,
    API.getProxyCoverUrl,
  )
})

const usePlaceholderCover = (event: Event) => {
  const target = event.target as HTMLImageElement
  if (target.src === placeholderCover.value) return
  target.src = placeholderCover.value
}
</script>

<style lang="scss" scoped>
:global(.source-book-preview-dialog.el-dialog),
:global(.source-book-preview-dialog .el-dialog) {
  overflow: hidden;
  border: 1px solid var(--shelf-panel-border, var(--el-border-color-lighter));
  border-radius: var(--shelf-radius, 16px);
  background: var(--el-bg-color);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
}

:global(.source-book-preview-dialog .el-dialog__header),
:global(.source-book-preview-dialog.el-dialog .el-dialog__header),
:global(.source-book-preview-dialog .el-dialog__footer),
:global(.source-book-preview-dialog.el-dialog .el-dialog__footer) {
  border-color: var(--shelf-panel-border, var(--el-border-color-lighter));
}

:global(.source-book-preview-dialog .el-dialog__title),
:global(.source-book-preview-dialog.el-dialog .el-dialog__title) {
  color: var(--shelf-text, var(--el-text-color-primary));
  font-weight: 700;
}

:global(.source-book-preview-dialog .el-dialog__body),
:global(.source-book-preview-dialog.el-dialog .el-dialog__body) {
  max-height: calc(100vh - 180px);
  overflow: auto;
}

.preview-empty,
.preview-state {
  padding: 30px 18px;
  border: 1px dashed var(--shelf-panel-border, var(--el-border-color-lighter));
  border-radius: 16px;
  color: var(--shelf-muted, var(--el-text-color-secondary));
  text-align: center;
  background: var(--el-fill-color-lighter);
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.preview-header,
.preview-section {
  display: flex;
  padding: 14px;
  border: 1px solid var(--shelf-panel-border, var(--el-border-color-lighter));
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(64, 158, 255, 0.06), transparent 48%),
    var(--el-bg-color);
}

.preview-header {
  gap: 16px;
  align-items: stretch;
}

.preview-cover {
  flex: 0 0 auto;
  width: 96px;
  height: 128px;

  img {
    width: 96px;
    height: 128px;
    display: block;
    object-fit: cover;
    border-radius: 12px;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
  }
}

.preview-meta {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  justify-content: center;
  min-width: 0;

  h3 {
    margin: 0;
    color: var(--shelf-text, var(--el-text-color-primary));
    font-size: 20px;
    line-height: 1.35;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
}

.preview-subtitle,
.preview-line {
  color: var(--shelf-muted, var(--el-text-color-secondary));
  line-height: 1.7;
}

.preview-subtitle {
  display: flex;
  gap: 6px;
  min-width: 0;
  margin-top: 6px;
}

.preview-author,
.preview-source-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-author {
  flex: 0 1 auto;
}

.preview-subtitle-separator {
  flex: 0 0 auto;
}

.preview-source-name {
  flex: 1 1 auto;
}

.preview-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.preview-line {
  margin: 8px 0 0;
}

.preview-section {
  flex-direction: column;
}

.preview-section-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  color: var(--shelf-text, var(--el-text-color-primary));
  font-weight: 700;

  span {
    color: var(--shelf-soft-muted, var(--el-text-color-secondary));
    font-size: 12px;
    font-weight: 400;
  }
}

.preview-intro {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  color: var(--shelf-muted, var(--el-text-color-secondary));
  line-height: 1.8;
  white-space: pre-wrap;
}

.preview-chapters {
  max-height: min(42vh, 300px);
  overflow: auto;
}

.preview-no-chapter {
  padding: 22px 12px;
  border: 1px dashed var(--shelf-panel-border, var(--el-border-color-lighter));
  border-radius: 12px;
  color: var(--shelf-muted, var(--el-text-color-secondary));
  text-align: center;
  background: var(--shelf-subpanel-bg, var(--el-fill-color-lighter));
}

.preview-chapter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 0;
  color: var(--shelf-muted, var(--el-text-color-secondary));

  & + .preview-chapter {
    border-top: 1px dashed var(--shelf-divider, rgba(148, 163, 184, 0.22));
  }
}

.preview-chapter-index {
  flex: 0 0 34px;
  color: var(--shelf-soft-muted, var(--el-text-color-secondary));
  font-variant-numeric: tabular-nums;
}

.preview-chapter-title {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--shelf-text, var(--el-text-color-primary));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-chapter-tag {
  flex: 0 0 auto;
}

.preview-chapter-extra {
  flex: 0 1 auto;
  max-width: 220px;
  overflow: hidden;
  color: var(--shelf-soft-muted, var(--el-text-color-secondary));
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

@media screen and (max-width: 750px) {
  :global(.source-book-preview-dialog.el-dialog),
  :global(.source-book-preview-dialog .el-dialog) {
    width: calc(100vw - 24px) !important;
    border-radius: 18px;
  }

  :global(.source-book-preview-dialog .el-dialog__body),
  :global(.source-book-preview-dialog.el-dialog .el-dialog__body) {
    max-height: calc(100vh - 160px);
  }

  .preview-header {
    gap: 12px;
    padding: 12px;
  }

  .preview-cover {
    width: 78px;
    height: 104px;

    img {
      width: 78px;
      height: 104px;
      border-radius: 10px;
    }
  }

  .preview-meta {
    justify-content: flex-start;

    h3 {
      font-size: 18px;
    }
  }

  .preview-subtitle,
  .preview-line {
    font-size: 13px;
  }

  .preview-section {
    padding: 12px;
  }

  .preview-section-title {
    flex-direction: column;
    gap: 2px;
    margin-bottom: 8px;
  }

  .preview-footer {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));

    :deep(.el-button) {
      width: 100%;
    }

    &.is-single {
      grid-template-columns: 1fr;
    }
  }

  .preview-chapter {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .preview-chapter-title {
    flex-basis: calc(100% - 42px);
    white-space: normal;
  }

  .preview-chapter-extra {
    max-width: 100%;
    margin-left: 42px;
  }
}
</style>
