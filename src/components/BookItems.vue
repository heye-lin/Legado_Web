<template>
  <div class="books-wrapper">
    <div class="wrapper">
      <div
        class="book"
        v-for="book in books"
        :key="getBookKey(book)"
        @click="handleClick(book)"
      >
        <div class="cover-img">
          <img
            class="cover"
            :src="getCover(book)"
            :key="book.coverUrl"
            @error.once="proxyImage($event, book)"
            alt=""
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
          <el-button
            v-if="!isSourceSearchBook(book)"
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

defineProps<{
  books: BookItem[]
}>()

const emit = defineEmits<{
  bookClick: [book: BookItem]
  bookDelete: [book: Book]
}>()
const isSourceSearchBook = (book: BookItem): book is SourceSearchBook =>
  'entryType' in book && book.entryType === 'source-search'
const handleClick = (book: BookItem) => emit('bookClick', book)
const handleDelete = (book: Book) => emit('bookDelete', book)
const getBookKey = (book: BookItem) =>
  isSourceSearchBook(book) ? book.resultKey : book.bookUrl

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

const getPlaceholderCover = (book: BookItem) => {
  const title = escapeSvgText(book.name || '阅读')
  const subtitle = escapeSvgText(
    isSourceSearchBook(book) ? book.sourceName : '本地书籍',
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
  const { bookUrl, coverUrl } = book
  if (coverUrl === undefined) {
    return isSourceSearchBook(book)
      ? getPlaceholderCover(book)
      : API.getProxyCoverUrl(bookUrl)
  }
  return isLegadoUrl(coverUrl) ? API.getProxyCoverUrl(coverUrl) : coverUrl
}
const proxyImage = (evt: Event, book: BookItem) => {
  const target = evt.target as HTMLImageElement
  target.src = isSourceSearchBook(book)
    ? getPlaceholderCover(book)
    : API.getProxyCoverUrl(target.src)
}
</script>

<style lang="scss" scoped>
.books-wrapper {
  overflow: auto;

  .wrapper {
    display: grid;
    grid-template-columns: repeat(auto-fill, 380px);
    justify-content: space-around;
    grid-gap: 10px;

    .book {
      user-select: none;
      display: flex;
      cursor: pointer;
      margin-bottom: 18px;
      padding: 24px 24px;
      width: 360px;
      flex-direction: row;
      justify-content: space-around;

      .cover-img {
        width: 84px;
        height: 112px;

        .cover {
          width: 84px;
          height: 112px;
        }
      }

      .info {
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        align-items: left;
        height: 112px;
        margin-left: 20px;
        flex: 1;
        overflow: hidden;

        .name {
          width: fit-content;
          font-size: 16px;
          font-weight: 700;
          color: #33373d;
        }

        .sub {
          display: flex;
          flex-direction: row;
          align-items: baseline;
          justify-content: flex-start;
          font-size: 12px;
          font-weight: 600;
          color: #6b6b6b;

          .update-info {
            display: flex;
            .dot {
              margin: 0 7px;
            }
          }
        }

        .delete-book {
          align-self: flex-start;
          padding-left: 0;
        }

        .intro,
        .dur-chapter,
        .last-chapter {
          color: #969ba3;
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

    .book:hover {
      background: rgba(0, 0, 0, 0.1);
      transition-duration: 0.5s;
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
    .wrapper {
      display: flex;
      flex-direction: column;

      .book {
        box-sizing: border-box;
        width: 100%;
        margin-bottom: 0;
        padding: 10px 20px;
      }
    }
  }
}
</style>
