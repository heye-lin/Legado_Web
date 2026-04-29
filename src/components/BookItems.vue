<template>
  <div class="books-wrapper">
    <div class="wrapper">
      <div
        class="book"
        v-for="book in props.books"
        :key="getBookKey(book)"
        :class="{ 'is-source-book': isSourceSearchBook(book) }"
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
          <div class="name" :title="book.name">{{ book.name }}</div>
          <div class="sub">
            <div class="author" :title="book.author || '作者未知'">
              {{ book.author || '作者未知' }}
            </div>
            <div v-if="isSourceSearchBook(book)" class="update-info">
              <div class="dot">•</div>
              <div class="date source-name" :title="book.sourceName">
                {{ book.sourceName }}
              </div>
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
            <span class="preview-hint">点击卡片预览</span>
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
            @keydown.enter.stop
            @keydown.space.stop
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
import { dateFormat } from '../utils/utils'
import API from '@api'
import { getDisplayCoverUrl, getPlaceholderCover } from '@/utils/bookCover'
import { isSourceSearchBook } from '@/utils/sourceSearch'

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
    ? `预览《${book.name}》的详情和目录`
    : `打开《${book.name}》`

const getSourceDescription = (book: BookItem) => {
  if (!isSourceSearchBook(book)) return ''
  return [book.kind, book.wordCount].filter(Boolean).join(' · ')
}

const getCover = (book: BookItem) => {
  const subtitle = isSourceSearchBook(book) ? book.sourceName : '本地书籍'
  return getDisplayCoverUrl(
    book.coverUrl,
    getPlaceholderCover(book, subtitle),
    API.getProxyCoverUrl,
  )
}
const proxyImage = (evt: Event, book: BookItem) => {
  const target = evt.target as HTMLImageElement
  target.src = getPlaceholderCover(
    book,
    isSourceSearchBook(book) ? book.sourceName : '本地书籍',
  )
}
</script>

<style lang="scss" scoped>
.books-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;

  .wrapper {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 292px), 340px));
    gap: var(--shelf-grid-gap, 16px);
    align-content: start;
    justify-content: start;
    padding-bottom: 2px;

    .book {
      --book-cover-width: 80px;
      --book-cover-height: 112px;

      position: relative;
      user-select: none;
      display: flex;
      cursor: pointer;
      min-width: 0;
      padding: 16px;
      flex-direction: row;
      align-items: stretch;
      gap: 16px;
      box-sizing: border-box;
      border: 1px solid var(--shelf-panel-border, #ebeef5);
      border-radius: var(--shelf-radius, 16px);
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.18), transparent 42%),
        var(--shelf-card-bg, var(--shelf-panel-bg, rgba(255, 255, 255, 0.78)));
      box-shadow: var(--shelf-card-shadow, 0 10px 24px rgba(15, 23, 42, 0.06));
      overflow: hidden;
      transition:
        transform 0.18s ease,
        box-shadow 0.18s ease,
        border-color 0.18s ease,
        background-color 0.18s ease;

      &.is-source-book {
        border-color: rgba(103, 194, 58, 0.26);
      }

      .cover-img {
        position: relative;
        flex: 0 0 auto;
        width: var(--book-cover-width);
        height: var(--book-cover-height);
        border-radius: 11px;
        background: var(--shelf-subpanel-bg, rgba(248, 250, 252, 0.72));

        &::after {
          position: absolute;
          inset: 0;
          pointer-events: none;
          border-radius: inherit;
          box-shadow:
            inset 10px 0 16px rgba(15, 23, 42, 0.1),
            inset 0 0 0 1px rgba(255, 255, 255, 0.16);
          content: '';
        }

        .cover {
          width: 100%;
          height: 100%;
          display: block;
          object-fit: cover;
          border-radius: inherit;
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.16);
        }
      }

      .info {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        flex: 1;
        gap: 6px;
        min-height: var(--book-cover-height);
        min-width: 0;
        overflow: hidden;

        .name {
          max-width: 100%;
          font-size: 16px;
          font-weight: 700;
          line-height: 1.35;
          color: var(--shelf-text, #33373d);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .sub {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--shelf-muted, #6b6b6b);

          .update-info {
            display: flex;
            align-items: center;
            flex: 1 1 auto;
            gap: 7px;
            min-width: 0;

            .dot {
              flex: 0 0 auto;
              color: var(--shelf-soft-muted, #8a94a3);
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

          .source-name {
            max-width: 180px;
          }
        }

        .source-book-actions {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: auto;
          max-width: 100%;

          .import-book {
            height: 26px;
            padding: 0 9px;
            border-radius: 999px;
          }

          .preview-hint {
            display: inline-flex;
            align-items: center;
            height: 24px;
            padding: 0 9px;
            border: 1px solid var(--el-border-color-lighter);
            border-radius: 999px;
            color: var(--shelf-soft-muted, #8a94a3);
            background: var(--shelf-subpanel-bg, rgba(248, 250, 252, 0.72));
            font-size: 12px;
            line-height: 1;
          }
        }

        .delete-book {
          align-self: flex-start;
          height: 26px;
          margin-top: auto;
          padding: 0 9px;
          border-radius: 999px;
          background: rgba(245, 108, 108, 0.08);
        }

        .intro,
        .dur-chapter,
        .last-chapter {
          width: 100%;
          color: var(--shelf-muted, #606975);
          font-size: 13px;
          font-weight: 500;
          line-height: 1.45;
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
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.24), transparent 42%),
        var(
          --shelf-card-hover-bg,
          var(--shelf-card-bg, var(--shelf-panel-bg, rgba(255, 255, 255, 0.9)))
        );
      box-shadow: var(
        --shelf-card-hover-shadow,
        0 18px 36px rgba(15, 23, 42, 0.12)
      );
      transform: translateY(-2px);
    }

    .book:focus-visible {
      outline: 2px solid var(--el-color-primary);
      outline-offset: 2px;
    }
  }
}

.books-wrapper::-webkit-scrollbar {
  width: 0 !important;
}

@media screen and (max-width: 750px) {
  .books-wrapper {
    box-sizing: border-box;
    padding: 0;

    .wrapper {
      display: flex;
      flex-direction: column;
      gap: 10px;

      .book {
        --book-cover-width: 68px;
        --book-cover-height: 94px;

        box-sizing: border-box;
        width: 100%;
        padding: 12px;
        gap: 12px;
        border: 1px solid var(--shelf-panel-border, #ebeef5);
        border-radius: 14px;
        box-shadow: var(--shelf-card-shadow, 0 8px 20px rgba(15, 23, 42, 0.05));

        .info {
          gap: 4px;

          .name {
            font-size: 15px;
          }

          .sub {
            flex-wrap: wrap;
            row-gap: 3px;

            .author {
              flex-basis: 100%;
            }

            .update-info {
              width: 100%;
              gap: 6px;

              .dot:first-child {
                display: none;
              }
            }
          }

          .intro,
          .dur-chapter,
          .last-chapter {
            font-size: 12px;
          }

          .source-book-actions {
            gap: 6px;
          }
        }
      }
    }
  }
}
</style>
