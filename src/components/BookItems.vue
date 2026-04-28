<template>
  <div class="books-wrapper">
    <div class="wrapper">
      <div
        class="book"
        v-for="book in props.books"
        :key="getBookKey(book)"
        role="button"
        tabindex="0"
        :aria-label="getBookActionLabel(book)"
        @click="handleClick(book)"
        @keydown.enter.prevent="handleClick(book)"
        @keydown.space.prevent="handleClick(book)"
      >
        <div class="cover-img">
          <img
            class="cover"
            :src="getCover(book)"
            :key="book.coverUrl"
            @error.once="proxyImage($event, book)"
            :alt="`${book.name} 封面`"
            loading="lazy"
          />
        </div>
        <div class="info">
          <div class="name">{{ book.name }}</div>
          <div class="sub">
            <div class="author">{{ book.author || '作者未知' }}</div>
            <div v-if="isSourceSearchBook(book)" class="update-info">
              <div class="dot">•</div>
              <div class="date">{{ book.sourceName }}</div>
            </div>
            <div v-else class="update-info">
              <div class="dot">•</div>
              <div class="size">共{{ book.totalChapterNum }}章</div>
              <div class="dot">•</div>
              <div class="date">{{ dateFormat(book.lastCheckTime) }}</div>
            </div>
          </div>
          <div v-if="!isSourceSearchBook(book)" class="dur-chapter">
            已读：{{ book.durChapterTitle }}
          </div>
          <div v-else-if="book.intro" class="intro">{{ book.intro }}</div>
          <div v-else-if="getSourceDescription(book)" class="intro">
            {{ getSourceDescription(book) }}
          </div>
          <div v-if="book.latestChapterTitle" class="last-chapter">
            最新：{{ book.latestChapterTitle }}
          </div>
          <div v-if="isSourceSearchBook(book)" class="source-book-actions">
            <el-tag size="small" effect="plain"> 点击卡片打开来源站 </el-tag>
            <el-button
              class="import-book"
              text
              type="success"
              size="small"
              :loading="isBookImporting(book)"
              :disabled="isBookImporting(book)"
              :aria-label="`加入书架：${book.name}`"
              @click.stop="handleImport(book)"
              @keydown.enter.stop.prevent="handleImport(book)"
              @keydown.space.stop.prevent="handleImport(book)"
            >
              加入书架
            </el-button>
          </div>
          <el-button
            v-else
            class="delete-book"
            text
            type="danger"
            size="small"
            @click.stop="handleDelete(book)"
          >
            删除
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import type { Book, SourceSearchBook } from '@/book'
import { dateFormat, isLegadoUrl } from '../utils/utils'
import API from '@api'

type BookItem = Book | SourceSearchBook

const props = withDefaults(
  defineProps<{
    books: BookItem[]
    importingBookKeys?: ReadonlySet<string>
  }>(),
  {
    importingBookKeys: () => new Set<string>(),
  },
)

const emit = defineEmits<{
  bookClick: [book: BookItem]
  bookDelete: [book: Book]
  bookImport: [book: SourceSearchBook]
}>()
const isSourceSearchBook = (book: BookItem): book is SourceSearchBook =>
  'entryType' in book && book.entryType === 'source-search'
const handleClick = (book: BookItem) => emit('bookClick', book)
const handleDelete = (book: Book) => emit('bookDelete', book)
const handleImport = (book: BookItem) => {
  if (isSourceSearchBook(book) && !isBookImporting(book)) {
    emit('bookImport', book)
  }
}
const getBookKey = (book: BookItem) =>
  isSourceSearchBook(book) ? book.resultKey : book.bookUrl
const isBookImporting = (book: BookItem) =>
  isSourceSearchBook(book) && props.importingBookKeys.has(getBookKey(book))
const getBookActionLabel = (book: BookItem) =>
  isSourceSearchBook(book)
    ? `在新标签页打开《${book.name}》的来源站详情`
    : `打开《${book.name}》`

const escapeSvgText = (text: string) =>
  text.replace(/[&<>"']/g, char => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&apos;',
    }
    return entities[char]
  })

const truncateSvgText = (text: string, maxLength: number) => {
  const chars = Array.from(text.trim())
  return chars.length > maxLength
    ? `${chars.slice(0, maxLength).join('')}…`
    : chars.join('')
}

const getPlaceholderCover = (book: BookItem) => {
  const title = escapeSvgText(truncateSvgText(book.name || '阅读', 8))
  const subtitle = escapeSvgText(
    truncateSvgText(isSourceSearchBook(book) ? book.sourceName : '本地书籍', 12),
  )
  const initial = escapeSvgText(Array.from(book.name || '书')[0] ?? '书')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="224" viewBox="0 0 168 224"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4d7a1"/><stop offset="1" stop-color="#7aa7d9"/></linearGradient></defs><rect width="168" height="224" rx="12" fill="url(#g)"/><text x="84" y="92" text-anchor="middle" font-size="48" font-family="serif" fill="#fff">${initial}</text><text x="84" y="142" text-anchor="middle" font-size="17" font-family="sans-serif" font-weight="700" fill="#fff">${title}</text><text x="84" y="172" text-anchor="middle" font-size="12" font-family="sans-serif" fill="rgba(255,255,255,.82)">${subtitle}</text></svg>`
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

const getSourceDescription = (book: BookItem) => {
  if (!isSourceSearchBook(book)) return ''
  return [book.kind, book.wordCount].filter(Boolean).join(' · ')
}

const getCover = (book: BookItem) => {
  const { coverUrl } = book
  if (!coverUrl) return getPlaceholderCover(book)
  return isLegadoUrl(coverUrl) ? API.getProxyCoverUrl(coverUrl) : coverUrl
}
const proxyImage = (evt: Event, book: BookItem) => {
  const target = evt.target as HTMLImageElement
  target.src = getPlaceholderCover(book)
}
</script>

<style lang="scss" scoped>
.books-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;

  .wrapper {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 18px;

    .book {
      user-select: none;
      display: flex;
      cursor: pointer;
      min-width: 0;
      padding: 18px;
      flex-direction: row;
      align-items: center;
      box-sizing: border-box;
      border: 1px solid var(--shelf-panel-border, #ebeef5);
      border-radius: 16px;
      background: var(--shelf-panel-bg, rgba(255, 255, 255, 0.72));
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
      transition:
        transform 0.18s ease,
        box-shadow 0.18s ease,
        border-color 0.18s ease,
        background-color 0.18s ease;

      .cover-img {
        flex: 0 0 auto;
        width: 84px;
        height: 112px;

        .cover {
          width: 84px;
          height: 112px;
          display: block;
          object-fit: cover;
          border-radius: 10px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.18);
        }
      }

      .info {
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        align-items: flex-start;
        height: 112px;
        margin-left: 20px;
        flex: 1;
        min-width: 0;
        overflow: hidden;

        .name {
          max-width: 100%;
          font-size: 16px;
          font-weight: 700;
          color: var(--shelf-text, #33373d);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sub {
          display: flex;
          flex-direction: row;
          align-items: baseline;
          justify-content: flex-start;
          max-width: 100%;
          min-width: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--shelf-muted, #6b6b6b);

          .update-info {
            display: flex;
            flex: 1 1 auto;
            min-width: 0;
            .dot {
              flex: 0 0 auto;
              margin: 0 7px;
            }
          }

          .author,
          .date,
          .size {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .author {
            flex: 0 1 45%;
          }
        }

        .source-book-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          max-width: 100%;

          .import-book {
            padding-left: 0;
          }
        }

        .delete-book {
          align-self: flex-start;
          padding-left: 0;
        }

        .intro,
        .dur-chapter,
        .last-chapter {
          color: var(--shelf-muted, #606975);
          font-size: 13px;
          margin-top: 3px;
          font-weight: 500;
          word-wrap: break-word;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 1;
          line-clamp: 1;
          text-align: left;
        }
      }
    }

    .book:hover,
    .book:focus-visible {
      border-color: rgba(64, 158, 255, 0.36);
      box-shadow: 0 18px 36px rgba(15, 23, 42, 0.12);
      transform: translateY(-2px);
    }

    .book:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: 2px;
    }
  }

  .wrapper:last-child {
    margin-right: auto;
  }
}

.books-wrapper::-webkit-scrollbar {
  width: 0 !important;
}

@media screen and (max-width: 750px) {
  .books-wrapper {
    box-sizing: border-box;
    padding: 16px;

    .wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;

      .book {
        box-sizing: border-box;
        width: 100%;
        padding: 14px;
        border: 1px solid var(--shelf-panel-border, #ebeef5);
        border-radius: 16px;
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);

        .info {
          margin-left: 16px;

          .sub {
            flex-wrap: wrap;
            row-gap: 2px;

            .author {
              flex-basis: 100%;
            }

            .update-info {
              width: 100%;

              .dot {
                display: none;
              }
            }
          }
        }
      }
    }
  }
}
</style>
