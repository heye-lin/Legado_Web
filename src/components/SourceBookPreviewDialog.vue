<template>
  <el-dialog
    v-model="visible"
    class="source-book-preview-dialog"
    width="min(760px, calc(100vw - 32px))"
    :title="dialogTitle"
  >
    <div v-if="book === undefined" class="preview-empty">
      请选择要预览的书源搜索结果。
    </div>

    <div v-else class="preview-body">
      <div class="preview-header">
        <div class="preview-cover">
          <img
            :src="coverUrl"
            :alt="`${displayBook.name} 封面`"
            @error.once="usePlaceholderCover"
          />
        </div>
        <div class="preview-meta">
          <h3>{{ displayBook.name }}</h3>
          <div class="preview-subtitle">
            {{ displayBook.author || '作者未知' }} · {{ book.sourceName }}
          </div>
          <div class="preview-tags">
            <el-tag v-if="preview?.alreadyOnShelf" type="success" effect="plain">
              已在书架
            </el-tag>
            <el-tag v-if="preview" effect="plain">
              共 {{ preview.chapterCount }} 章
            </el-tag>
            <el-tag v-if="displayBook.kind" effect="plain">
              {{ displayBook.kind }}
            </el-tag>
            <el-tag v-if="displayBook.wordCount" effect="plain">
              {{ displayBook.wordCount }}
            </el-tag>
          </div>
          <p v-if="displayBook.latestChapterTitle" class="preview-line">
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
        <section v-if="displayBook.intro" class="preview-section">
          <div class="preview-section-title">简介</div>
          <p class="preview-intro">{{ displayBook.intro }}</p>
        </section>

        <section class="preview-section">
          <div class="preview-section-title">
            目录预览
            <span>最多显示前 {{ preview.chapters.length }} 章</span>
          </div>
          <div class="preview-chapters">
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
      <el-button @click="visible = false">关闭</el-button>
      <el-button
        v-if="book"
        type="primary"
        :loading="importing"
        :disabled="loading"
        @click="emit('import', book)"
      >
        {{ preview?.alreadyOnShelf ? '刷新书架' : '加入书架' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import API from '@api'
import type {
  Book,
  SourceBookPreviewResult,
  SourceSearchBook,
} from '@/book'

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

const displayBook = computed<Book | SourceSearchBook>(
  () =>
    props.preview?.book ??
    props.book ?? {
      entryType: 'source-search',
      name: '未知书籍',
      author: '作者未知',
      bookUrl: '',
      kind: '',
      wordCount: '',
      sourceName: '',
      sourceUrl: '',
      origin: '',
      originName: '',
      type: 0,
      tocUrl: '',
      resultKey: '',
      resultIndex: 0,
      originOrder: 0,
      weight: 0,
      searchedAt: 0,
      time: 0,
    },
)

const dialogTitle = computed(() =>
  props.book === undefined ? '书籍预览' : `预览：${displayBook.value.name}`,
)

const placeholderCover = computed(() => {
  const name = displayBook.value?.name || '阅读'
  const initial = Array.from(name)[0] ?? '书'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="224" viewBox="0 0 168 224"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4d7a1"/><stop offset="1" stop-color="#7aa7d9"/></linearGradient></defs><rect width="168" height="224" rx="12" fill="url(#g)"/><text x="84" y="124" text-anchor="middle" font-size="52" font-family="serif" fill="#fff">${initial}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
})

const coverUrl = computed(() => {
  const rawCover = displayBook.value?.coverUrl
  return rawCover ? API.getProxyCoverUrl(rawCover) : placeholderCover.value
})

const usePlaceholderCover = (event: Event) => {
  const target = event.target as HTMLImageElement
  target.src = placeholderCover.value
}
</script>

<style lang="scss" scoped>
.preview-empty,
.preview-state {
  padding: 28px;
  color: var(--shelf-muted, var(--el-text-color-secondary));
  text-align: center;
}

.preview-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.preview-header {
  display: flex;
  gap: 18px;
  align-items: flex-start;
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
  min-width: 0;

  h3 {
    margin: 0;
    color: var(--shelf-text, var(--el-text-color-primary));
    font-size: 20px;
    line-height: 1.35;
  }
}

.preview-subtitle,
.preview-line {
  color: var(--shelf-muted, var(--el-text-color-secondary));
  line-height: 1.7;
}

.preview-subtitle {
  margin-top: 6px;
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
  padding: 14px 16px;
  border: 1px solid var(--shelf-panel-border, var(--el-border-color-lighter));
  border-radius: 16px;
  background: var(--shelf-panel-bg, var(--el-bg-color));
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
  color: var(--shelf-muted, var(--el-text-color-secondary));
  line-height: 1.8;
  white-space: pre-wrap;
}

.preview-chapters {
  max-height: 300px;
  overflow: auto;
}

.preview-chapter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 7px 0;
  color: var(--shelf-muted, var(--el-text-color-secondary));

  & + .preview-chapter {
    border-top: 1px dashed rgba(148, 163, 184, 0.22);
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

@media screen and (max-width: 750px) {
  .preview-header {
    flex-direction: column;
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
