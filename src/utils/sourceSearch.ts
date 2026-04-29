import type { Book, SourceSearchBook, SourceSearchFilter } from '@/book'

export const SOURCE_BOOK_SEARCH_DEFAULT_FILTER = {
  keyword: '',
  enabled: 'enabled',
  feature: 'web',
  field: 'all',
} satisfies Required<SourceSearchFilter>

export const isSourceSearchBook = (
  book: Book | SourceSearchBook,
): book is SourceSearchBook =>
  'entryType' in book && book.entryType === 'source-search'
