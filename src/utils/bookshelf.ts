import type { Book, SeachBook } from '@/book'

export { getErrorMessage } from './jsonFile'

export type BookshelfBook = Book | SeachBook

export type ReadingRecentBook = {
  name: string
  author: string
  bookUrl: string
  chapterIndex: number
  chapterPos: number
  isSeachBook?: boolean
}

const READING_RECENT_STORAGE_KEY = 'readingRecent'
const READING_SESSION_KEYS = [
  'bookUrl',
  'bookName',
  'bookAuthor',
  'chapterIndex',
  'chapterPos',
  'isSeachBook',
]

export const createDefaultReadingRecent = (): ReadingRecentBook => ({
  name: '尚无阅读记录',
  author: '',
  bookUrl: '',
  chapterIndex: 0,
  chapterPos: 0,
  isSeachBook: false,
})

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseStoredReadingRecent = (
  raw: string,
): ReadingRecentBook | undefined => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObjectRecord(parsed)) return undefined
    if (
      typeof parsed.name !== 'string' ||
      typeof parsed.author !== 'string' ||
      typeof parsed.bookUrl !== 'string'
    ) {
      return undefined
    }

    return {
      name: parsed.name,
      author: parsed.author,
      bookUrl: parsed.bookUrl,
      chapterIndex:
        typeof parsed.chapterIndex === 'number' ? parsed.chapterIndex : 0,
      chapterPos: typeof parsed.chapterPos === 'number' ? parsed.chapterPos : 0,
      isSeachBook:
        typeof parsed.isSeachBook === 'boolean' ? parsed.isSeachBook : false,
    }
  } catch {
    return undefined
  }
}

export const loadStoredReadingRecent = (): ReadingRecentBook | undefined => {
  const raw = localStorage.getItem(READING_RECENT_STORAGE_KEY)
  if (raw === null) return undefined

  const recent = parseStoredReadingRecent(raw)
  if (recent !== undefined) return recent

  localStorage.removeItem(READING_RECENT_STORAGE_KEY)
  return createDefaultReadingRecent()
}

export const saveReadingRecent = (recent: ReadingRecentBook) => {
  localStorage.setItem(READING_RECENT_STORAGE_KEY, JSON.stringify(recent))
}

export const clearStoredReadingRecent = () => {
  localStorage.removeItem(READING_RECENT_STORAGE_KEY)
}

export const saveReadingSession = (recent: ReadingRecentBook) => {
  sessionStorage.setItem('bookUrl', recent.bookUrl)
  sessionStorage.setItem('bookName', recent.name)
  sessionStorage.setItem('bookAuthor', recent.author)
  sessionStorage.setItem('chapterIndex', String(recent.chapterIndex))
  sessionStorage.setItem('chapterPos', String(recent.chapterPos))
  sessionStorage.setItem('isSeachBook', String(recent.isSeachBook))
}

export const clearReadingSession = () => {
  READING_SESSION_KEYS.forEach(key => sessionStorage.removeItem(key))
}

export const normalizeSearchText = (value: string) =>
  value.trim().toLocaleLowerCase()

export const filterShelfBooks = (books: Book[], keyword: string) => {
  const key = normalizeSearchText(keyword)
  if (key.length === 0) return books

  return books.filter(book => {
    const text =
      `${book.name} ${book.author} ${book.kind ?? ''}`.toLocaleLowerCase()
    return text.includes(key)
  })
}

export const hasBookOnShelf = (books: Book[], bookUrl: string) =>
  books.some(book => book.bookUrl === bookUrl)

export const isSearchBook = (book: BookshelfBook): book is SeachBook =>
  'respondTime' in book

export const getBookReadPosition = (book: BookshelfBook) => {
  if (isSearchBook(book)) {
    return { chapterIndex: 0, chapterPos: 0 }
  }

  return {
    chapterIndex: book.durChapterIndex,
    chapterPos: book.durChapterPos,
  }
}

export const isTextFile = (file: File) =>
  file.name.toLocaleLowerCase().endsWith('.txt') || file.type === 'text/plain'

export const hasDragFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')
