#!/usr/bin/env node
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'
import * as cheerio from 'cheerio'
import pg from 'pg'

const { Pool } = pg

const MAX_JSON_BYTES = 20 * 1024 * 1024
const MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024
const MAX_SOURCE_FETCH_BYTES = 3 * 1024 * 1024
const SUBSCRIPTION_TIMEOUT_MS = 12_000
const SOURCE_FETCH_TIMEOUT_MS = 12_000
const DEFAULT_DATABASE_URL =
  process.env.LEGADO_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://iaeno:iaeno@127.0.0.1:5432/cli_proxy'
const CONFIGURED_RESULT_SIGNING_SECRET =
  process.env.LEGADO_RESULT_SIGNING_SECRET?.trim()
const RESULT_SIGNING_SECRET =
  CONFIGURED_RESULT_SIGNING_SECRET ||
  crypto.randomBytes(32).toString('base64url')
const RESULT_SIGNATURE_TTL_MS = Math.max(
  60_000,
  Math.min(
    24 * 60 * 60 * 1000,
    Number(process.env.LEGADO_RESULT_SIGNATURE_TTL_MS) || 30 * 60 * 1000,
  ),
)
const SCHEMA = 'legado_web'
const YIOVE_API_HOSTNAME = 'shuyuan-api.yiove.com'
const YIOVE_SITE_ORIGIN = 'https://shuyuan.yiove.com'
const FORBIDDEN_PROXY_HEADER_NAMES = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'host',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const SOURCE_SEARCH_HEADER_EXCEPTIONS = new Set(['origin', 'referer'])
const FORBIDDEN_PROXY_HEADER_PREFIXES = ['proxy-', 'sec-']
const SOURCE_SEARCH_CONCURRENCY = 8
const SOURCE_SEARCH_TIMEOUT_MS = 6_000
const SOURCE_SEARCH_RESULT_LIMIT = 50
const SOURCE_SEARCH_TOTAL_RESULT_LIMIT = 300
const SEARCH_KEYWORD_MAX_LENGTH = 80
const SOURCE_TOC_PAGE_LIMIT = Math.max(
  1,
  Math.min(50, Number(process.env.LEGADO_SOURCE_TOC_PAGE_LIMIT) || 10),
)
const SOURCE_CONTENT_PAGE_LIMIT = Math.max(
  1,
  Math.min(20, Number(process.env.LEGADO_SOURCE_CONTENT_PAGE_LIMIT) || 5),
)
const SOURCE_CHAPTER_LIMIT = Math.max(
  1,
  Math.min(20_000, Number(process.env.LEGADO_SOURCE_CHAPTER_LIMIT) || 5_000),
)
const SOURCE_CHAPTER_CONTENT_MAX_BYTES = Math.max(
  64 * 1024,
  Math.min(
    5 * 1024 * 1024,
    Number(process.env.LEGADO_SOURCE_CHAPTER_CONTENT_MAX_BYTES) ||
      2 * 1024 * 1024,
  ),
)
const COMPLEX_LEGADO_RULE_PATTERN =
  /(^\s*(js:|@js:|xpath:|@xpath:|regex:)|@js\b|<js>|java\.|source\.getVariable|source\.setVariable)/i
const COMPLEX_SEARCH_URL_PATTERN =
  /(^\s*(@?js:|<js>)|<js>|java\.ajax|java\.|source\.getVariable|source\.setVariable|buildRequest\()/i
const EMBEDDED_RULE_TEMPLATE_PATTERN = /\{\{\s*@@([\s\S]*?)\}\}/g
const STATIC_JS_BLOCK_PATTERN = /<js>([\s\S]*?)<\/js>/i
const SELECTOR_INDEX_PATTERN = /^(.*)\.(-?\d+)(?::(-?\d+))?$/
const BRACKET_SELECTOR_INDEX_PATTERN = /^(.*)\[(-?\d+)\]$/
const SELECTOR_EXCLUSION_PATTERN = /^(.*)!(-?\d+)(?::(-?\d+))?$/
const JSON_ACCESSOR_PATTERN =
  /^[A-Za-z_$][\w$]*(?:\[(?:-?\d+|\*)\])?(?:\.[A-Za-z_$][\w$]*(?:\[(?:-?\d+|\*)\])?)*$/
const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

const DEFAULT_READ_CONFIG = {
  theme: 0,
  font: 0,
  fontSize: 18,
  readWidth: 800,
  infiniteLoading: false,
  customFontName: '',
  jumpDuration: 1000,
  spacing: {
    paragraph: 1,
    line: 0.8,
    letter: 0,
  },
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
])

const ok = data => ({ isSuccess: true, errorMsg: '', data })
const fail = (message, errorCode) => ({
  isSuccess: false,
  errorMsg: message,
  errorCode,
  data: null,
})
const clone = value => JSON.parse(JSON.stringify(value))

class ApiError extends Error {
  constructor(status, message, errorCode) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errorCode = errorCode
  }
}

class SourceParseError extends ApiError {
  constructor(message) {
    super(422, message, 'SOURCE_PARSE_FAILED')
    this.name = 'SourceParseError'
  }
}

const badRequest = message => new ApiError(400, message)

const requireNonEmptyString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${label}不能为空`)
  }
  return value.trim()
}

const requireQueryParam = (url, name, label = name) =>
  requireNonEmptyString(url.searchParams.get(name) ?? '', label)

const requireNonNegativeIntegerParam = (url, name, label = name) => {
  const value = url.searchParams.get(name)
  if (value === null || value.trim() === '') {
    throw badRequest(`${label}不能为空`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0) {
    throw badRequest(`${label}必须是非负整数`)
  }
  return number
}

const parseArgs = argv => {
  const args = {
    host: '127.0.0.1',
    port: 8080,
    directory: 'dist',
    databaseUrl: DEFAULT_DATABASE_URL,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--host' && next !== undefined) {
      args.host = next
      index += 1
    } else if (arg === '--port' && next !== undefined) {
      args.port = Number(next)
      index += 1
    } else if (arg === '--directory' && next !== undefined) {
      args.directory = next
      index += 1
    } else if (arg === '--database-url' && next !== undefined) {
      args.databaseUrl = next
      index += 1
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const rootDir = path.dirname(fileURLToPath(import.meta.url))
const staticDir = path.resolve(rootDir, '..', args.directory)

const normalizeApiOrigin = value => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.origin
  } catch {
    return ''
  }
}

const originFromHostAndPort = (host, port) => {
  const trimmed = String(host ?? '').trim()
  if (
    !trimmed ||
    trimmed === '0.0.0.0' ||
    trimmed === '::' ||
    trimmed === '[::]'
  ) {
    return ''
  }
  const hostPart = net.isIPv6(trimmed) ? `[${trimmed}]` : trimmed
  return normalizeApiOrigin(`http://${hostPart}:${port}`)
}

const parseConfiguredApiOrigins = () =>
  String(process.env.LEGADO_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(item => normalizeApiOrigin(item.trim()))
    .filter(Boolean)

const apiAllowedOrigins = new Set(
  [
    `http://127.0.0.1:${args.port}`,
    `http://localhost:${args.port}`,
    originFromHostAndPort(args.host, args.port),
    ...parseConfiguredApiOrigins(),
  ].filter(Boolean),
)
const apiAllowedHosts = new Set(
  Array.from(apiAllowedOrigins, origin => new URL(origin).host.toLowerCase()),
)
const pool = new Pool({
  connectionString: args.databaseUrl,
  max: 8,
})

let dbReady

const query = (text, params = []) => pool.query(text, params)

const ensureDatabase = async () => {
  if (dbReady !== undefined) return dbReady
  dbReady = (async () => {
    await query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`)
    await query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.app_state (
        key text PRIMARY KEY,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.sources (
        kind text NOT NULL CHECK (kind IN ('bookSource', 'rssSource')),
        source_key text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, source_key)
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.books (
        book_url text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS ${SCHEMA}.chapters (
        book_url text NOT NULL REFERENCES ${SCHEMA}.books(book_url) ON DELETE CASCADE,
        chapter_index integer NOT NULL,
        data jsonb NOT NULL,
        content text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (book_url, chapter_index)
      )
    `)
  })()
  try {
    await dbReady
  } catch (error) {
    dbReady = undefined
    throw error
  }
  return dbReady
}

const send = (res, status, body, headers = {}) => {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  res.writeHead(status, {
    'Content-Length': buffer.byteLength,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  res.end(buffer)
}

const sendJson = (res, status, data) => {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
  })
}

const sendApiOk = (res, data) => sendJson(res, 200, ok(data))
const sendApiError = (res, status, message, errorCode) =>
  sendJson(res, status, fail(message, errorCode))

const readBody = (req, limit = MAX_JSON_BYTES) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.byteLength
      if (size > limit) {
        reject(new Error('请求体超过大小限制'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const readJsonBody = async req => {
  const body = await readBody(req)
  if (body.length === 0) return undefined
  const contentType = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiError(415, '请求 Content-Type 必须是 application/json')
  }
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw badRequest('请求体不是合法 JSON')
  }
}

const isRecord = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requestHost = req => String(req.headers.host ?? '').trim().toLowerCase()

const assertAllowedApiHost = req => {
  const host = requestHost(req)
  if (!host || !apiAllowedHosts.has(host)) {
    throw new ApiError(403, 'API 请求 Host 不在允许列表中')
  }
}

const assertSameOriginApiRequest = (req, url) => {
  if (!url.pathname.startsWith('/api/')) return
  assertAllowedApiHost(req)
  const secFetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (secFetchSite === 'cross-site') {
    throw new ApiError(403, '拒绝跨站 API 请求')
  }

  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin.trim() === '') return
  const normalizedOrigin = normalizeApiOrigin(origin)
  if (!normalizedOrigin || !apiAllowedOrigins.has(normalizedOrigin)) {
    throw new ApiError(403, 'API 请求 Origin 不在允许列表中')
  }
}

const requireKind = url => {
  const kind = url.searchParams.get('kind') ?? ''
  if (kind !== 'bookSource' && kind !== 'rssSource') {
    throw badRequest('kind 必须是 bookSource 或 rssSource')
  }
  return kind
}

const sourceKey = (kind, source) => {
  if (!isRecord(source)) throw badRequest('源必须是对象')
  const key = kind === 'bookSource' ? source.bookSourceUrl : source.sourceUrl
  const name = kind === 'bookSource' ? source.bookSourceName : source.sourceName
  if (typeof key !== 'string' || key.trim() === '') {
    throw badRequest(
      kind === 'bookSource' ? '书源缺少 bookSourceUrl' : '订阅源缺少 sourceUrl',
    )
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw badRequest(
      kind === 'bookSource'
        ? '书源缺少 bookSourceName'
        : '订阅源缺少 sourceName',
    )
  }
  return key
}

const getSources = async kind => {
  const result = await query(
    `SELECT data FROM ${SCHEMA}.sources WHERE kind = $1 ORDER BY source_key`,
    [kind],
  )
  return result.rows.map(row => row.data)
}

const replaceSources = async (kind, sources) => {
  if (!Array.isArray(sources)) throw new Error('源数据必须是数组')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM ${SCHEMA}.sources WHERE kind = $1`, [kind])
    for (const source of sources) {
      const key = sourceKey(kind, source)
      await client.query(
        `
          INSERT INTO ${SCHEMA}.sources (kind, source_key, data, updated_at)
          VALUES ($1, $2, $3::jsonb, now())
          ON CONFLICT (kind, source_key)
          DO UPDATE SET data = EXCLUDED.data, updated_at = now()
        `,
        [kind, key, JSON.stringify(source)],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
  return getSources(kind)
}

const upsertSource = async (kind, source) => {
  const key = sourceKey(kind, source)
  await query(
    `
      INSERT INTO ${SCHEMA}.sources (kind, source_key, data, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (kind, source_key)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `,
    [kind, key, JSON.stringify(source)],
  )
}

const deleteSources = async (kind, sources) => {
  if (!Array.isArray(sources)) throw new Error('删除源数据必须是数组')
  const keys = sources.map(source => sourceKey(kind, source))
  if (keys.length === 0) return
  await query(
    `DELETE FROM ${SCHEMA}.sources WHERE kind = $1 AND source_key = ANY($2)`,
    [kind, keys],
  )
}

const getReadConfig = async () => {
  const result = await query(
    `SELECT value FROM ${SCHEMA}.app_state WHERE key = 'readConfig'`,
  )
  return result.rows[0]?.value ?? clone(DEFAULT_READ_CONFIG)
}

const saveReadConfig = async config => {
  await query(
    `
      INSERT INTO ${SCHEMA}.app_state (key, value, updated_at)
      VALUES ('readConfig', $1::jsonb, now())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    `,
    [JSON.stringify(config)],
  )
}

const normalizeText = text =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()

const chapterTitlePattern =
  /^\s*((第\s*[\d零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节卷回集部篇].{0,50})|(序章|楔子|引子|前言|后记|终章|番外).{0,50}|(chapter|section)\s+\d+.{0,60})\s*$/i

const isChapterTitle = line => {
  const title = line.trim()
  return (
    title.length > 0 && title.length <= 80 && chapterTitlePattern.test(title)
  )
}

const splitTextByLength = (text, maxLength = 12_000) => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean)
  const chapters = []
  let buffer = []
  let bufferLength = 0

  const flush = () => {
    if (buffer.length === 0) return
    chapters.push({
      title: `第 ${chapters.length + 1} 章`,
      content: buffer.join('\n\n'),
    })
    buffer = []
    bufferLength = 0
  }

  for (const paragraph of paragraphs) {
    if (bufferLength > 0 && bufferLength + paragraph.length > maxLength) flush()
    buffer.push(paragraph)
    bufferLength += paragraph.length
  }
  flush()

  if (chapters.length === 0 && text.length > 0) {
    chapters.push({ title: '正文', content: text })
  }
  return chapters
}

const parseTextChapters = rawText => {
  const text = normalizeText(rawText)
  const lines = text.split('\n')
  const titles = []

  lines.forEach((line, lineIndex) => {
    if (isChapterTitle(line)) titles.push({ lineIndex, title: line.trim() })
  })

  if (titles.length < 2) return splitTextByLength(text)

  const chapters = []
  const preface = lines.slice(0, titles[0].lineIndex).join('\n').trim()
  if (preface.length > 0) chapters.push({ title: '前言', content: preface })

  titles.forEach((current, index) => {
    const next = titles[index + 1]
    const content = lines
      .slice(current.lineIndex + 1, next?.lineIndex ?? lines.length)
      .join('\n')
      .trim()
    chapters.push({ title: current.title, content: content || current.title })
  })

  return chapters
}

const bookUrlFromFile = file =>
  `local-book://${encodeURIComponent(file.name)}/${file.size}/${file.lastModified}`

const bookNameFromFile = file => file.name.replace(/\.[^.]+$/, '')

const chapterId = (bookUrl, index) => `${bookUrl}#${index}`

const buildBook = (file, chapters) => {
  const now = Date.now()
  const bookUrl = bookUrlFromFile(file)
  const latestChapterTitle = chapters.at(-1)?.title ?? '正文'
  return {
    name: bookNameFromFile(file),
    author: '本地导入',
    bookUrl,
    tocUrl: bookUrl,
    origin: 'local',
    originName: file.name,
    type: 0,
    group: 0,
    latestChapterTitle,
    latestChapterTime: now,
    lastCheckTime: now,
    lastCheckCount: 0,
    totalChapterNum: chapters.length,
    durChapterTitle: chapters[0]?.title ?? '正文',
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTime: now,
    canUpdate: false,
    order: now,
    originOrder: 0,
    syncTime: now,
  }
}

const chapterToRecord = (bookUrl, chapter, index) => ({
  id: chapterId(bookUrl, index),
  url: `${bookUrl}/chapter/${index}`,
  title: chapter.title,
  isVolume: false,
  baseUrl: bookUrl,
  bookUrl,
  index,
  isVip: false,
  isPay: true,
  content: chapter.content,
})

const saveBookWithChapters = async (book, chapters) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `
        INSERT INTO ${SCHEMA}.books (book_url, data, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (book_url)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `,
      [book.bookUrl, JSON.stringify(book)],
    )
    await client.query(`DELETE FROM ${SCHEMA}.chapters WHERE book_url = $1`, [
      book.bookUrl,
    ])
    for (const chapter of chapters) {
      await client.query(
        `
          INSERT INTO ${SCHEMA}.chapters (book_url, chapter_index, data, content, updated_at)
          VALUES ($1, $2, $3::jsonb, $4, now())
        `,
        [book.bookUrl, chapter.index, JSON.stringify(chapter), chapter.content],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const getBooks = async () => {
  const result = await query(
    `
      SELECT data
      FROM ${SCHEMA}.books
      ORDER BY
        CASE
          WHEN data->>'durChapterTime' ~ '^[0-9]+$'
          THEN (data->>'durChapterTime')::bigint
          ELSE 0
        END DESC
    `,
  )
  return result.rows.map(row => row.data)
}

const getBook = async bookUrl => {
  const result = await query(
    `SELECT data FROM ${SCHEMA}.books WHERE book_url = $1`,
    [bookUrl],
  )
  return result.rows[0]?.data
}

const getChapters = async bookUrl => {
  const result = await query(
    `SELECT data FROM ${SCHEMA}.chapters WHERE book_url = $1 ORDER BY chapter_index`,
    [bookUrl],
  )
  return result.rows.map(row => {
    const chapter = { ...row.data }
    delete chapter.content
    return chapter
  })
}

const isPlaceholderChapterContent = content =>
  /精彩内容正在加载中|内容正在加载|正在加载中|请稍候|请稍后/.test(
    String(content ?? ''),
  )

const getChapterRecord = async (bookUrl, index) => {
  const result = await query(
    `SELECT data, content FROM ${SCHEMA}.chapters WHERE book_url = $1 AND chapter_index = $2`,
    [bookUrl, index],
  )
  const row = result.rows[0]
  if (row === undefined) return undefined
  return {
    ...row.data,
    content:
      typeof row.content === 'string' ? row.content : (row.data.content ?? ''),
  }
}

const saveChapterContent = async (bookUrl, index, content) => {
  await query(
    `
      UPDATE ${SCHEMA}.chapters
      SET
        content = $3,
        data = jsonb_set(data, '{content}', to_jsonb($3::text), true),
        updated_at = now()
      WHERE book_url = $1 AND chapter_index = $2
    `,
    [bookUrl, index, content],
  )
}

const getChapterContent = async (bookUrl, index) => {
  const chapter = await getChapterRecord(bookUrl, index)
  if (chapter === undefined) return undefined

  const storedContent =
    typeof chapter.content === 'string' ? chapter.content : ''

  const book = await getBook(bookUrl)
  if (book === undefined || book.origin === 'local') return storedContent
  if (
    storedContent.trim().length > 0 &&
    !isPlaceholderChapterContent(storedContent)
  ) {
    return storedContent
  }

  const content = await parseSourceChapterContent(book, chapter)
  await saveChapterContent(bookUrl, index, content)
  return content
}

const sameBook = (book, progress) =>
  progress.bookUrl?.length > 0
    ? book.bookUrl === progress.bookUrl
    : book.name === progress.name && book.author === progress.author

const normalizeProgressNumber = (value, label) => {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    throw badRequest(`${label}必须是非负数字`)
  }
  return Math.floor(number)
}

const requireBookProgress = progress => {
  if (!isRecord(progress)) throw badRequest('阅读进度必须是对象')
  const bookUrl =
    typeof progress.bookUrl === 'string' ? progress.bookUrl.trim() : ''
  const name = typeof progress.name === 'string' ? progress.name.trim() : ''
  const author =
    typeof progress.author === 'string' ? progress.author.trim() : ''
  if (!bookUrl && (!name || !author)) {
    throw badRequest('阅读进度缺少 bookUrl 或 name/author')
  }
  return {
    bookUrl,
    name,
    author,
    durChapterIndex: normalizeProgressNumber(
      progress.durChapterIndex ?? 0,
      '章节序号',
    ),
    durChapterPos: normalizeProgressNumber(
      progress.durChapterPos ?? 0,
      '阅读位置',
    ),
    durChapterTime: normalizeProgressNumber(
      progress.durChapterTime ?? Date.now(),
      '阅读时间',
    ),
    durChapterTitle:
      typeof progress.durChapterTitle === 'string'
        ? progress.durChapterTitle.trim()
        : '',
  }
}

const saveBookProgress = async progress => {
  const normalizedProgress = requireBookProgress(progress)
  const book =
    normalizedProgress.bookUrl.length > 0
      ? await getBook(normalizedProgress.bookUrl)
      : (await getBooks()).find(item => sameBook(item, normalizedProgress))
  if (book === undefined) return '没有需要保存的 PG 进度'

  const updated = {
    ...book,
    durChapterIndex: normalizedProgress.durChapterIndex,
    durChapterPos: normalizedProgress.durChapterPos,
    durChapterTime: normalizedProgress.durChapterTime,
    durChapterTitle: normalizedProgress.durChapterTitle,
    syncTime: Date.now(),
  }
  await query(
    `UPDATE ${SCHEMA}.books SET data = $2::jsonb, updated_at = now() WHERE book_url = $1`,
    [updated.bookUrl, JSON.stringify(updated)],
  )
  return '阅读进度已保存到 PG'
}

const exportBackup = async () => {
  const [readConfig, bookSources, rssSources, books] = await Promise.all([
    getReadConfig(),
    getSources('bookSource'),
    getSources('rssSource'),
    getBooks(),
  ])
  const chapterResult = await query(
    `SELECT data, content FROM ${SCHEMA}.chapters ORDER BY book_url, chapter_index`,
  )
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    readConfig,
    bookSources,
    rssSources,
    books,
    chapters: chapterResult.rows.map(row => ({
      ...row.data,
      content:
        typeof row.content === 'string'
          ? row.content
          : (row.data.content ?? ''),
    })),
  }
}

const importBackup = async backup => {
  if (!isRecord(backup) || backup.version !== 1) {
    throw new Error('不支持的备份格式')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM ${SCHEMA}.chapters`)
    await client.query(`DELETE FROM ${SCHEMA}.books`)
    await client.query(`DELETE FROM ${SCHEMA}.sources`)
    await client.query(
      `DELETE FROM ${SCHEMA}.app_state WHERE key = 'readConfig'`,
    )
    await client.query(
      `
        INSERT INTO ${SCHEMA}.app_state (key, value, updated_at)
        VALUES ('readConfig', $1::jsonb, now())
      `,
      [JSON.stringify(backup.readConfig ?? DEFAULT_READ_CONFIG)],
    )
    for (const source of backup.bookSources ?? []) {
      await client.query(
        `INSERT INTO ${SCHEMA}.sources (kind, source_key, data, updated_at) VALUES ('bookSource', $1, $2::jsonb, now())`,
        [sourceKey('bookSource', source), JSON.stringify(source)],
      )
    }
    for (const source of backup.rssSources ?? []) {
      await client.query(
        `INSERT INTO ${SCHEMA}.sources (kind, source_key, data, updated_at) VALUES ('rssSource', $1, $2::jsonb, now())`,
        [sourceKey('rssSource', source), JSON.stringify(source)],
      )
    }
    for (const book of backup.books ?? []) {
      await client.query(
        `INSERT INTO ${SCHEMA}.books (book_url, data, updated_at) VALUES ($1, $2::jsonb, now())`,
        [book.bookUrl, JSON.stringify(book)],
      )
    }
    for (const chapter of backup.chapters ?? []) {
      await client.query(
        `INSERT INTO ${SCHEMA}.chapters (book_url, chapter_index, data, content, updated_at) VALUES ($1, $2, $3::jsonb, $4, now())`,
        [
          chapter.bookUrl,
          chapter.index,
          JSON.stringify(chapter),
          chapter.content ?? '',
        ],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const clearData = async () => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM ${SCHEMA}.chapters`)
    await client.query(`DELETE FROM ${SCHEMA}.books`)
    await client.query(`DELETE FROM ${SCHEMA}.sources`)
    await client.query(`DELETE FROM ${SCHEMA}.app_state`)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const isIpv4InRange = (parts, start, end) => {
  const value =
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  return value >= start && value <= end
}

const isForbiddenRemoteAddress = ip => {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) ||
      (parts[0] >= 224 && parts[0] <= 255) ||
      isIpv4InRange(parts, 0xc0000000, 0xc00000ff) ||
      isIpv4InRange(parts, 0xc0000200, 0xc00002ff) ||
      isIpv4InRange(parts, 0xc6336400, 0xc63364ff) ||
      isIpv4InRange(parts, 0xcb007100, 0xcb0071ff) ||
      isIpv4InRange(parts, 0xe9fc0000, 0xe9fc00ff)
    )
  }
  if (net.isIPv6(ip)) {
    const lowerIp = ip.toLowerCase()
    if (lowerIp.startsWith('::ffff:')) {
      const mappedIp = lowerIp.slice(7)
      return net.isIP(mappedIp) ? isForbiddenRemoteAddress(mappedIp) : true
    }
    const firstHextet = Number.parseInt(lowerIp.split(':')[0] || '0', 16)
    const secondHextet = Number.parseInt(lowerIp.split(':')[1] || '0', 16)
    return (
      lowerIp === '::' ||
      lowerIp === '::1' ||
      lowerIp.startsWith('fc') ||
      lowerIp.startsWith('fd') ||
      (Number.isFinite(firstHextet) && (firstHextet & 0xffc0) === 0xfe80) ||
      lowerIp.startsWith('ff') ||
      (firstHextet === 0x64 &&
        (secondHextet === 0xff9b || secondHextet === 0xff9b1)) ||
      (firstHextet === 0x100 && secondHextet === 0) ||
      firstHextet === 0x2002 ||
      (firstHextet === 0x2001 &&
        ((Number.isFinite(secondHextet) && secondHextet <= 0x01ff) ||
          secondHextet === 0x02 ||
          secondHextet === 0xdb8 ||
          (secondHextet >= 0x20 && secondHextet <= 0x2f)))
    )
  }
  return true
}

const lookupHostname = hostname => String(hostname ?? '').replace(/^\[|\]$/g, '')

const validatePublicUrl = async (rawUrl, label = '远程地址') => {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw badRequest(`${label}必须是有效 URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label}必须是 http/https URL`)
  }
  const hostname = lookupHostname(url.hostname)
  const hostnameFamily = net.isIP(hostname)
  const addresses =
    hostnameFamily === 0
      ? await dns.lookup(hostname, { all: true })
      : [{ address: hostname, family: hostnameFamily }]
  if (
    addresses.length === 0 ||
    addresses.some(address => isForbiddenRemoteAddress(address.address))
  ) {
    throw new Error(`${label}域名不是公网地址`)
  }
  return { url, addresses }
}

const createValidatedLookup = addresses => (hostname, options, callback) => {
  const family =
    options.family === 4 || options.family === 6 ? options.family : undefined
  const allowed = addresses.filter(
    address => family === undefined || address.family === family,
  )
  const selected = allowed[0]
  if (selected === undefined) {
    callback(new Error(`远程地址 ${hostname} 没有可用的公网解析地址`))
    return
  }
  if (options.all) {
    callback(
      null,
      allowed.map(address => ({
        address: address.address,
        family: address.family,
      })),
    )
    return
  }
  callback(null, selected.address, selected.family)
}

const isForbiddenProxyHeader = (name, { allowOriginReferer = false } = {}) => {
  const lowerName = name.toLocaleLowerCase()
  if (allowOriginReferer && SOURCE_SEARCH_HEADER_EXCEPTIONS.has(lowerName)) {
    return FORBIDDEN_PROXY_HEADER_PREFIXES.some(prefix =>
      lowerName.startsWith(prefix),
    )
  }
  return (
    FORBIDDEN_PROXY_HEADER_NAMES.has(lowerName) ||
    FORBIDDEN_PROXY_HEADER_PREFIXES.some(prefix => lowerName.startsWith(prefix))
  )
}

const normalizeProxyHeaders = (headers, options) => {
  const result = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Encoding': 'identity',
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  }
  if (!isRecord(headers)) return result

  Object.entries(headers).forEach(([key, value]) => {
    const normalizedKey = normalizeHeaderToken(key)
    if (
      typeof value !== 'string' ||
      !normalizedKey ||
      isForbiddenProxyHeader(normalizedKey, options)
    ) {
      return
    }
    result[normalizedKey] = value
  })
  return result
}

const hasHeader = (headers, name) =>
  Object.keys(headers).some(
    key => key.toLocaleLowerCase() === name.toLocaleLowerCase(),
  )

const removeBodyHeaders = headers =>
  Object.fromEntries(
    Object.entries(headers).filter(([key]) => {
      const lowerKey = key.toLocaleLowerCase()
      return lowerKey !== 'content-length' && lowerKey !== 'content-type'
    }),
  )

const encodeRequestBody = body => {
  if (typeof body !== 'string' || body.length === 0) return undefined
  return Buffer.from(body)
}

const decodeResponseContent = (content, contentEncoding, limit) => {
  const encoding = String(contentEncoding ?? '').toLocaleLowerCase()
  let decoded = content

  if (
    encoding.includes('gzip') ||
    (content[0] === GZIP_MAGIC_0 && content[1] === GZIP_MAGIC_1)
  ) {
    decoded = zlib.gunzipSync(content, { maxOutputLength: limit + 1 })
  } else if (encoding.includes('br')) {
    decoded = zlib.brotliDecompressSync(content, {
      maxOutputLength: limit + 1,
    })
  } else if (encoding.includes('deflate')) {
    decoded = zlib.inflateSync(content, { maxOutputLength: limit + 1 })
  }

  if (decoded.byteLength > limit) {
    throw new Error('远程内容解压后超过大小限制')
  }
  return decoded
}

const normalizeCharset = charset => {
  const normalized = charset?.trim().toLocaleLowerCase()
  if (!normalized) return undefined
  if (normalized === 'gb2312') return 'gbk'
  if (normalized === 'utf8') return 'utf-8'
  return normalized
}

const detectHeaderCharset = headers => {
  const contentType = Object.entries(headers ?? {}).find(
    ([key]) => key.toLocaleLowerCase() === 'content-type',
  )?.[1]
  if (typeof contentType !== 'string') return undefined
  return normalizeCharset(contentType.match(/charset=([^;\s]+)/i)?.[1])
}

const detectHtmlCharset = content => {
  const head = content.subarray(0, 4096).toString('latin1')
  return normalizeCharset(
    head.match(/<meta[^>]+charset=["']?\s*([^"'\s/>]+)/i)?.[1],
  )
}

const decodeSourceText = (content, headers, configuredCharset) => {
  const charset =
    normalizeCharset(configuredCharset) ??
    detectHeaderCharset(headers) ??
    detectHtmlCharset(content) ??
    'utf-8'
  try {
    return new TextDecoder(charset).decode(content).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('utf-8').decode(content).replace(/^\uFEFF/, '')
  }
}

const requestBytes = async (
  rawUrl,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = SOURCE_FETCH_TIMEOUT_MS,
    limit = MAX_SOURCE_FETCH_BYTES,
    redirect = 0,
    urlLabel = '远程地址',
  } = {},
) => {
  const { url, addresses } = await validatePublicUrl(rawUrl, urlLabel)
  const bodyBuffer = encodeRequestBody(body)
  const requestHeaders = { ...headers }
  if (
    bodyBuffer !== undefined &&
    !hasHeader(requestHeaders, 'content-length')
  ) {
    requestHeaders['Content-Length'] = String(bodyBuffer.byteLength)
  }
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      url,
      {
        method,
        headers: requestHeaders,
        timeout,
        lookup: createValidatedLookup(addresses),
        servername: url.hostname,
      },
      async response => {
        const statusCode = response.statusCode ?? 0
        if (
          statusCode >= 300 &&
          statusCode < 400 &&
          response.headers.location
        ) {
          response.resume()
          if (redirect >= 3) {
            reject(new Error('远程地址重定向次数过多'))
            return
          }
          try {
            const nextUrl = new URL(response.headers.location, url).toString()
            const shouldDropBody =
              method !== 'GET' &&
              (statusCode === 301 || statusCode === 302 || statusCode === 303)
            const nextMethod = shouldDropBody ? 'GET' : method
            resolve(
              await requestBytes(nextUrl, {
                method: nextMethod,
                headers: shouldDropBody
                  ? removeBodyHeaders(requestHeaders)
                  : requestHeaders,
                body: shouldDropBody ? undefined : body,
                timeout,
                limit,
                redirect: redirect + 1,
                urlLabel,
              }),
            )
          } catch (error) {
            reject(error)
          }
          return
        }
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`远程服务器返回 HTTP ${statusCode}`))
          response.resume()
          return
        }

        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.byteLength
          if (size > limit) {
            reject(new Error('远程内容超过大小限制'))
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          try {
            resolve({
              finalUrl: response.responseUrl ?? url.toString(),
              headers: response.headers,
              content: decodeResponseContent(
                Buffer.concat(chunks),
                response.headers['content-encoding'],
                limit,
              ),
            })
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    request.on('timeout', () =>
      request.destroy(new Error('远程服务器响应超时')),
    )
    request.on('error', reject)
    if (bodyBuffer !== undefined) request.write(bodyBuffer)
    request.end()
  })
}

const fetchSourceText = async requestBody => {
  if (!isRecord(requestBody) || typeof requestBody.url !== 'string') {
    throw new Error('源请求缺少 url')
  }
  const method = String(requestBody.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'POST') {
    throw new Error('源请求只支持 GET/POST')
  }
  const { finalUrl, headers, content } = await requestBytes(requestBody.url, {
    method,
    headers: normalizeProxyHeaders(requestBody.headers),
    body: typeof requestBody.body === 'string' ? requestBody.body : undefined,
    urlLabel: '源请求地址',
  })
  return {
    finalUrl,
    text: decodeSourceText(content, headers, requestBody.charset),
  }
}

const unique = values => Array.from(new Set(values))

const sourceSearchReport = (source, status, message, count = 0) => ({
  sourceName: source.bookSourceName,
  sourceUrl: source.bookSourceUrl,
  status,
  count,
  message,
})

const sourceSearchSignatureFields = book => [
  book.entryType,
  book.sourceUrl,
  book.bookUrl,
  book.tocUrl,
  book.name,
  book.author,
  book.coverUrl,
  book.intro,
  book.latestChapterTitle,
  book.kind,
  book.wordCount,
  book.searchedAt,
]

const signSourceSearchBookFields = book =>
  crypto
    .createHmac('sha256', RESULT_SIGNING_SECRET)
    .update(sourceSearchSignatureFields(book).map(String).join('\0'))
    .digest('base64url')

const attachSourceSearchBookSignature = book => ({
  ...book,
  resultSig: signSourceSearchBookFields(book),
})

const verifySourceSearchBookSignature = book => {
  const searchedAt = Number(book.searchedAt)
  if (!Number.isSafeInteger(searchedAt) || searchedAt <= 0) {
    throw badRequest('搜索结果缺少有效时间戳，请重新搜索后再加入书架')
  }
  if (Date.now() - searchedAt > RESULT_SIGNATURE_TTL_MS) {
    throw badRequest('搜索结果已过期，请重新搜索后再加入书架')
  }
  if (typeof book.resultSig !== 'string' || book.resultSig.trim() === '') {
    throw badRequest('加入书架请求缺少搜索结果签名，请重新搜索后再加入书架')
  }
  const expected = signSourceSearchBookFields(book)
  const actual = book.resultSig.trim()
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw badRequest('搜索结果签名无效，请重新搜索后再加入书架')
  }
}

const normalizeHeaderToken = value =>
  value
    .trim()
    .replace(/,$/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()

const parseSourceHeaders = (rawHeader, options) => {
  const headers = {}
  const warnings = []
  const trimmed = rawHeader?.trim()
  if (!trimmed) return { headers, warnings }

  const appendHeader = (rawKey, rawValue) => {
    const key = normalizeHeaderToken(rawKey)
    const value = normalizeHeaderToken(rawValue)
    if (!key || !value) return
    if (/\b(?:book|java|result|source)\./.test(value)) return
    if (isForbiddenProxyHeader(key, options)) {
      warnings.push(`已忽略代理禁止转发的请求头 ${key}`)
      return
    }
    headers[key] = value
  }

  try {
    const parsed = JSON.parse(trimmed)
    if (isRecord(parsed)) {
      Object.entries(parsed).forEach(([key, value]) => {
        if (typeof value === 'string') appendHeader(key, value)
      })
      return { headers, warnings: unique(warnings) }
    }
  } catch {
    // Continue with common line-based syntax.
  }

  trimmed.split(/\r?\n/).forEach(line => {
    const separatorIndex = line.search(/[:=]/)
    if (separatorIndex <= 0) return
    const key = normalizeHeaderToken(line.slice(0, separatorIndex))
    const value = normalizeHeaderToken(line.slice(separatorIndex + 1))
    if (key && value) appendHeader(key, value)
  })
  return { headers, warnings: unique(warnings) }
}

const fillSearchKey = (
  template,
  searchKey,
  { encodeKey = true, sourceBaseUrl = '' } = {},
) => {
  const renderedKey = encodeKey ? encodeURIComponent(searchKey) : searchKey
  const normalizedSourceBaseUrl = sourceBaseUrl.replace(/\/+$/, '')
  return template
    .replace(/\{\{\s*(?:ho|source\.key)\s*\}\}/gi, normalizedSourceBaseUrl)
    .replace(/\{\{\s*source\.bookSourceUrl\s*\}\}/gi, normalizedSourceBaseUrl)
    .replace(/\{\{\s*(?:key|keyword|searchKey)\s*\}\}/gi, renderedKey)
    .replace(/\{\{\s*\(?\s*(?:page|searchPage)\s*-\s*1\s*\)?\s*\}\}/gi, '0')
    .replace(/\{\{\s*\(?\s*page\s*-\s*1\s*\)?\s*\*\s*\d+\s*\}\}/gi, '0')
    .replace(/\{\{\s*(?:page|searchPage)\s*\}\}/gi, '1')
}

const fillSearchPage = template =>
  template
    .replace(/\{\{\s*\(?\s*(?:page|searchPage)\s*-\s*1\s*\)?\s*\}\}/gi, '0')
    .replace(/\{\{\s*\(?\s*page\s*-\s*1\s*\)?\s*\*\s*\d+\s*\}\}/gi, '0')
    .replace(/\{\{\s*(?:page|searchPage)\s*\}\}/gi, '1')

const isSupportedSearchTemplateExpression = expression =>
  /^(?:key|keyword|searchKey|page|searchPage)$/i.test(expression) ||
  /^(?:ho|source\.key|source\.bookSourceUrl)$/i.test(expression) ||
  /^\(?\s*(?:page|searchPage)\s*-\s*1\s*\)?$/i.test(expression) ||
  /^\(?\s*page\s*-\s*1\s*\)?\s*\*\s*\d+$/i.test(expression)

const findUnsupportedSearchUrlExpression = value => {
  const text = String(value ?? '')
  if (COMPLEX_SEARCH_URL_PATTERN.test(text)) return 'JS/动态请求'
  for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
    const expression = match[1].trim()
    if (!isSupportedSearchTemplateExpression(expression)) return match[0]
  }
  return ''
}

const splitSearchUrl = searchUrl => {
  const trimmed = searchUrl.trim()
  const configMatch = trimmed.match(/,\s*\{[\s\S]*\}\s*$/)
  const inlineConfig =
    configMatch === null
      ? {}
      : JSON.parse(fillSearchPage(trimmed.slice(configMatch.index + 1).trim()))
  const urlAndBody =
    configMatch === null ? trimmed : trimmed.slice(0, configMatch.index).trim()
  const bodySeparatorIndex = urlAndBody.indexOf('@')
  const queryIndex = urlAndBody.indexOf('?')
  const shouldSplitBody =
    bodySeparatorIndex > -1 &&
    (queryIndex === -1 || bodySeparatorIndex < queryIndex) &&
    (urlAndBody
      .slice(bodySeparatorIndex + 1)
      .trim()
      .startsWith('{') ||
      urlAndBody.slice(bodySeparatorIndex + 1).includes('='))
  if (!shouldSplitBody) {
    return { url: urlAndBody, body: inlineConfig.body, config: inlineConfig }
  }
  return {
    url: urlAndBody.slice(0, bodySeparatorIndex),
    body: urlAndBody.slice(bodySeparatorIndex + 1),
    config: inlineConfig,
  }
}

const renderSearchTemplateValue = (value, searchKey, options) => {
  if (typeof value === 'string') return fillSearchKey(value, searchKey, options)
  if (Array.isArray(value)) {
    return value.map(item =>
      renderSearchTemplateValue(item, searchKey, options),
    )
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        renderSearchTemplateValue(child, searchKey, options),
      ]),
    )
  }
  return value
}

const serializeSearchBody = (body, searchKey, options = {}) => {
  if (typeof body === 'string') {
    return {
      contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
      body: fillSearchKey(body, searchKey, options),
    }
  }
  if (isRecord(body) || Array.isArray(body)) {
    return {
      contentType: 'application/json;charset=UTF-8',
      body: JSON.stringify(
        renderSearchTemplateValue(body, searchKey, {
          ...options,
          encodeKey: false,
        }),
      ),
    }
  }
  return { contentType: 'application/x-www-form-urlencoded;charset=UTF-8' }
}

const applyDefaultSourceSearchHeaders = (headers, requestUrl, method) => {
  const origin = new URL(requestUrl).origin
  if (!hasHeader(headers, 'referer')) headers.Referer = `${origin}/`
  if (method === 'POST' && !hasHeader(headers, 'origin'))
    headers.Origin = origin
}

const buildSourceSearchRequest = (source, searchKey) => {
  const searchUrl = source.searchUrl?.trim()
  if (!searchUrl) throw new Error('未配置搜索地址')

  const { url, body, config } = splitSearchUrl(searchUrl)
  const templateOptions = { sourceBaseUrl: source.bookSourceUrl }
  const requestUrl = new URL(
    fillSearchKey(url, searchKey, templateOptions),
    source.bookSourceUrl,
  ).toString()
  const { headers, warnings } = parseSourceHeaders(source.header, {
    allowOriginReferer: true,
  })
  if (isRecord(config.headers)) {
    Object.entries(config.headers).forEach(([key, value]) => {
      const normalizedKey = normalizeHeaderToken(key)
      if (typeof value !== 'string' || !normalizedKey) return
      if (isForbiddenProxyHeader(normalizedKey, { allowOriginReferer: true })) {
        warnings.push(`已忽略代理禁止转发的请求头 ${normalizedKey}`)
      } else {
        headers[normalizedKey] = fillSearchKey(value, searchKey, {
          encodeKey: false,
          sourceBaseUrl: source.bookSourceUrl,
        })
      }
    })
  }
  const method =
    typeof config.method === 'string' ? config.method.toUpperCase() : undefined
  const charset =
    typeof config.charset === 'string'
      ? config.charset
      : typeof config.encoding === 'string'
        ? config.encoding
        : undefined

  const requestMethod =
    body === undefined && method !== 'POST'
      ? 'GET'
      : method === 'GET'
        ? 'GET'
        : 'POST'
  const serializedBody = serializeSearchBody(body, searchKey, templateOptions)
  applyDefaultSourceSearchHeaders(headers, requestUrl, requestMethod)

  if (requestMethod === 'GET') {
    return {
      url: requestUrl,
      method: requestMethod,
      headers,
      warnings,
      charset,
    }
  }

  if (!hasHeader(headers, 'content-type'))
    headers['Content-Type'] = serializedBody.contentType
  return {
    url: requestUrl,
    method: requestMethod,
    headers,
    body: serializedBody.body,
    warnings,
    charset,
  }
}

const RULE_ATTRIBUTE_NAMES = new Set([
  'text',
  'textnodes',
  'html',
  'href',
  'src',
  'alt',
  'title',
  'content',
])

const parseRule = rule => {
  const trimmed = rule?.trim()
  if (!trimmed) return undefined

  const [ruleBody, ...replacements] = trimmed.split('##')
  const ruleParts = ruleBody.split('@').map(part => part.trim())
  const singleRule = ruleParts[0]?.toLocaleLowerCase()
  if (ruleParts.length === 1)
    return RULE_ATTRIBUTE_NAMES.has(singleRule)
      ? {
          selectors: [],
          attribute: singleRule,
          replacements: replacements.filter(Boolean),
        }
      : {
          selectors: [ruleParts[0]].filter(Boolean),
          attribute: 'text',
          replacements: replacements.filter(Boolean),
        }

  return {
    selectors: ruleParts.slice(0, -1).filter(Boolean),
    attribute: ruleParts.at(-1) || 'text',
    replacements: replacements.filter(Boolean),
  }
}

const replaceRuleText = (value, pattern, replacement) => {
  const safePattern = String(pattern ?? '')
  if (!safePattern) return value
  if (safePattern.length > 512) return value.split(safePattern).join(replacement)
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(safePattern)) {
    return value.split(safePattern).join(replacement)
  }
  try {
    return value.replace(new RegExp(safePattern, 'g'), replacement)
  } catch {
    return value.split(safePattern).join(replacement)
  }
}

const applyRuleReplacements = (value, replacements) => {
  let text = value
  for (let index = 0; index < replacements.length; index += 1) {
    const pattern = replacements[index]
    const replacement =
      index + 1 < replacements.length ? replacements[index + 1] : ''
    text = replaceRuleText(text, pattern, replacement)
    if (index + 1 < replacements.length) index += 1
  }
  return text
}

const decodeStaticRuleString = value =>
  String(value ?? '')
    .replace(/\\\//g, '/')
    .replace(/\\(["'\\])/g, '$1')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')

const splitStaticResultTransformRule = rule => {
  const text = String(rule ?? '').trim()
  const blockMatch = text.match(STATIC_JS_BLOCK_PATTERN)
  if (blockMatch !== null && blockMatch.index !== undefined) {
    return {
      baseRule: text.slice(0, blockMatch.index).trim(),
      script: blockMatch[1],
    }
  }

  const inlineMatch = text.match(/@js\s*:/i)
  if (inlineMatch === null || inlineMatch.index === undefined) return undefined
  if (inlineMatch.index === 0) return undefined
  return {
    baseRule: text.slice(0, inlineMatch.index).trim(),
    script: text.slice(inlineMatch.index + inlineMatch[0].length),
  }
}

const readStaticReplaceChain = (chain, value) => {
  let rest = chain.trim()
  let text = value
  let count = 0

  while (rest) {
    const match = rest.match(
      /^\.replace\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1\s*,\s*(['"])((?:\\.|(?!\3)[\s\S])*?)\3\s*\)/,
    )
    if (match === null) return undefined
    text = text.replace(
      decodeStaticRuleString(match[2]),
      decodeStaticRuleString(match[4]),
    )
    rest = rest.slice(match[0].length).trim()
    count += 1
  }

  return count > 0 ? text : undefined
}

const applyStaticResultTransform = (value, script) => {
  const statements = String(script ?? '')
    .replace(/\/\/.*$/gm, '')
    .split(/;|\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
  if (statements.length === 0) return undefined

  let variable = 'result'
  let text = value
  let transformed = false

  for (const statement of statements) {
    const variableMatch = statement.match(
      /^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*result$/,
    )
    if (variableMatch !== null) {
      variable = variableMatch[1]
      continue
    }

    if (statement === variable || statement === 'result') continue

    const escapedVariable = variable.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )
    const assignMatch = statement.match(
      new RegExp(
        `^${escapedVariable}\\s*=\\s*(?:${escapedVariable}|result)([\\s\\S]+)$`,
      ),
    )
    const chainMatch =
      assignMatch?.[1] ??
      statement.match(
        new RegExp(`^(?:${escapedVariable}|result)([\\s\\S]+)$`),
      )?.[1]

    if (chainMatch === undefined) return undefined
    const nextText = readStaticReplaceChain(chainMatch, text)
    if (nextText === undefined) return undefined
    text = nextText
    transformed = true
  }

  return transformed ? text : undefined
}

const sourceBaseUrlFromPage = baseUrl => {
  try {
    return new URL(baseUrl).origin.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

const renderRuleSourceTemplates = (value, baseUrl) => {
  const sourceBaseUrl = sourceBaseUrlFromPage(baseUrl)
  return String(value ?? '')
    .replace(/\{\{\s*(?:ho|source\.key)\s*\}\}/gi, sourceBaseUrl)
    .replace(/\{\{\s*source\.bookSourceUrl\s*\}\}/gi, sourceBaseUrl)
}

const normalizeRuleText = value => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

const normalizeLegadoSelector = selector =>
  selector
    .trim()
    .replace(/^@@/, '')
    .replace(/^@?css:/i, '')
    .replace(/^class\./i, '.')
    .replace(/^id\./i, '#')
    .replace(/^tag\./i, '')
    .trim()

const looksLikeCssClassOrIdEndingWithDigit = selector =>
  /(^|[\s>+~,(])([.#])[A-Za-z_-][\w-]*\d$/.test(selector)

const selectorWithIndex = selector => {
  const trimmed = selector.trim()
  if (looksLikeCssClassOrIdEndingWithDigit(trimmed)) {
    return { selector: normalizeLegadoSelector(trimmed) }
  }
  const exclusionMatch = trimmed.match(SELECTOR_EXCLUSION_PATTERN)
  if (exclusionMatch !== null) {
    const cssSelector = exclusionMatch[1].trim()
    if (!cssSelector) return { selector: trimmed }
    return {
      selector: normalizeLegadoSelector(cssSelector),
      excludeStartIndex: Number(exclusionMatch[2]),
      excludeEndIndex:
        exclusionMatch[3] === undefined ? undefined : Number(exclusionMatch[3]),
    }
  }
  const match =
    trimmed.match(BRACKET_SELECTOR_INDEX_PATTERN) ??
    trimmed.match(SELECTOR_INDEX_PATTERN)
  if (match === null) return { selector: trimmed }

  const cssSelector = match[1].trim()
  if (!cssSelector) return { selector: trimmed }

  return {
    selector: normalizeLegadoSelector(cssSelector),
    startIndex: Number(match[2]),
    endIndex: match[3] === undefined ? undefined : Number(match[3]),
  }
}

const normalizeIndex = (index, length) => (index < 0 ? length + index : index)

const applySelectorIndex = (nodes, startIndex, endIndex) => {
  if (startIndex === undefined) return nodes

  const start = normalizeIndex(startIndex, nodes.length)
  if (start < 0 || start >= nodes.length) return []
  if (endIndex === undefined) return nodes.slice(start, start + 1)

  const end = normalizeIndex(endIndex, nodes.length)
  const upperBound = end < start ? start + 1 : end + 1
  return nodes.slice(start, upperBound)
}

const applySelectorExclusion = (nodes, startIndex, endIndex) => {
  if (startIndex === undefined) return nodes
  const start = normalizeIndex(startIndex, nodes.length)
  if (start < 0 || start >= nodes.length) return nodes
  const end =
    endIndex === undefined
      ? start
      : Math.max(start, normalizeIndex(endIndex, nodes.length))
  return nodes.filter((_, index) => index < start || index > end)
}

const findSelectorNodes = ($, scope, selector) => {
  if (selector === '') return [scope]
  if (selector === 'children') return $(scope).children().toArray()
  if (selector.startsWith('text.')) {
    const text = selector.slice(5)
    return $(scope)
      .find('*')
      .toArray()
      .filter(node => $(node).text().includes(text))
  }

  const currentNode =
    scope.type === 'root' || !$(scope).is(selector) ? [] : [scope]
  return currentNode.concat($(scope).find(selector).toArray())
}

const selectRuleNodes = ($, scopes, rawSelector) => {
  let lastError
  for (const alternative of splitRuleAlternatives(rawSelector)) {
    try {
      const {
        selector,
        startIndex,
        endIndex,
        excludeStartIndex,
        excludeEndIndex,
      } = selectorWithIndex(alternative)
      const nodes = scopes.flatMap(scope => {
        const normalizedSelector = normalizeLegadoSelector(selector)
        const selected = findSelectorNodes($, scope, normalizedSelector)
        return applySelectorExclusion(
          applySelectorIndex(selected, startIndex, endIndex),
          excludeStartIndex,
          excludeEndIndex,
        )
      })
      if (nodes.length > 0) return nodes
    } catch (error) {
      lastError = error
    }
  }
  if (lastError !== undefined) throw lastError
  return []
}

const selectRuleTarget = ($, scope, selectors) => {
  const nodes = selectors.reduce(
    (current, selector) => selectRuleNodes($, current, selector),
    [scope],
  )
  return nodes[0] === undefined ? undefined : $(nodes[0])
}

const selectRuleTargets = ($, scope, selectors) => {
  const nodes = selectors.reduce(
    (current, selector) => selectRuleNodes($, current, selector),
    [scope],
  )
  return nodes.length === 0 ? undefined : $(nodes)
}

const readSingleRuleValue = ($, scope, rule, baseUrl) => {
  const parsedRule = parseRule(rule)
  if (parsedRule === undefined) return ''

  const target =
    parsedRule.selectors.length === 0
      ? scope
      : selectRuleTarget($, scope.get(0), parsedRule.selectors)
  if (target === undefined || target.length === 0) return ''

  const attribute = parsedRule.attribute.toLocaleLowerCase()
  if (attribute === 'text') {
    return applyRuleReplacements(target.text().trim(), parsedRule.replacements)
  }
  if (attribute === 'textnodes' || attribute === 'owntext') {
    const text = target
      .contents()
      .toArray()
      .filter(node => node.type === 'text')
      .map(node => $(node).text())
      .join('')
      .trim()
    return applyRuleReplacements(text, parsedRule.replacements)
  }
  if (attribute === 'html') {
    return applyRuleReplacements(
      target.html()?.trim() ?? '',
      parsedRule.replacements,
    )
  }

  const attrValue = target.attr(parsedRule.attribute)?.trim() ?? ''
  if (!attrValue) return ''
  if (attribute === 'href' || attribute === 'src') {
    return applyRuleReplacements(
      new URL(attrValue, baseUrl).toString(),
      parsedRule.replacements,
    )
  }
  return applyRuleReplacements(attrValue, parsedRule.replacements)
}

const readSingleRuleValueWithStaticTransform = ($, scope, rule, baseUrl) => {
  const transform = splitStaticResultTransformRule(rule)
  if (transform === undefined) return readSingleRuleValue($, scope, rule, baseUrl)
  if (!transform.baseRule) throw new Error('静态 JS 规则缺少基础选择器')

  const value = readSingleRuleValue($, scope, transform.baseRule, baseUrl)
  if (!value) return ''

  const transformed = applyStaticResultTransform(value, transform.script)
  if (transformed === undefined) {
    throw new Error('静态 JS 结果转换只支持 result.replace 字符串替换')
  }
  return transformed
}

const hasEmbeddedRuleTemplate = rule =>
  /\{\{\s*@@[\s\S]*?\}\}/.test(String(rule ?? ''))

const readEmbeddedRuleTemplateValue = ($, scope, rule, baseUrl) => {
  EMBEDDED_RULE_TEMPLATE_PATTERN.lastIndex = 0
  const rendered = String(rule ?? '')
    .trim()
    .replace(EMBEDDED_RULE_TEMPLATE_PATTERN, (_, innerRule) =>
      readRuleValue($, scope, innerRule.trim(), baseUrl),
    )
  const [ruleBody, ...replacements] = rendered.split('##')
  return applyRuleReplacements(
    ruleBody.trim(),
    replacements.filter(Boolean),
  )
}

const readRuleValue = ($, scope, rule, baseUrl) => {
  const trimmed = rule?.trim()
  if (!trimmed) return ''
  if (hasEmbeddedRuleTemplate(trimmed)) {
    return renderRuleSourceTemplates(
      readEmbeddedRuleTemplateValue($, scope, trimmed, baseUrl),
      baseUrl,
    )
  }

  const [ruleBody, ...replacements] = trimmed.split('##')
  if (!ruleBody.trim() && replacements.length > 0) {
    return renderRuleSourceTemplates(
      applyRuleReplacements(
        scope.html()?.trim() ?? '',
        replacements.filter(Boolean),
      ),
      baseUrl,
    )
  }

  let lastError
  for (const alternative of splitRuleAlternatives(ruleBody)) {
    try {
      const value = splitRuleConjunctions(alternative)
        .map(part =>
          readSingleRuleValueWithStaticTransform($, scope, part, baseUrl),
        )
        .filter(Boolean)
        .join(' ')
      const normalizedValue = renderRuleSourceTemplates(
        applyRuleReplacements(value.trim(), replacements.filter(Boolean)),
        baseUrl,
      )
      if (normalizedValue) return normalizedValue
    } catch (error) {
      lastError = error
    }
  }
  if (lastError !== undefined) throw lastError
  return ''
}

const readOptionalRuleValue = ($, scope, rule, baseUrl) => {
  try {
    return readRuleValue($, scope, rule, baseUrl)
  } catch {
    return ''
  }
}

const normalizeJsonRule = rule =>
  String(rule ?? '')
    .trim()
    .replace(/^@?json:/i, '')
    .trim()

const isJsonPathRule = rule => /^\$/.test(normalizeJsonRule(rule))

const splitRuleAlternatives = rule =>
  String(rule ?? '')
    .split('||')
    .map(item => item.trim())
    .filter(Boolean)

const splitRuleConjunctions = rule =>
  String(rule ?? '')
    .split('&&')
    .map(item => item.trim())
    .filter(Boolean)

const selectBookListNodes = ($, listRule) => {
  let lastError
  for (const alternative of splitRuleAlternatives(listRule)) {
    if (isJsonAccessorRule(alternative)) continue
    try {
      const nodes = alternative
        .split('@')
        .map(item => item.trim())
        .filter(Boolean)
        .reduce(
          (current, selector) => selectRuleNodes($, current, selector),
          [$.root().get(0)],
        )
      if (nodes.length > 0) return nodes
    } catch (error) {
      lastError = error
    }
  }
  if (lastError !== undefined) throw lastError
  return []
}

const isJsonAccessorRule = rule => {
  const normalizedRule = normalizeJsonRule(rule)
  return (
    isJsonPathRule(normalizedRule) ||
    /^\[[^\]]+\]$/.test(normalizedRule) ||
    JSON_ACCESSOR_PATTERN.test(normalizedRule)
  )
}

const isJsonPathUnionRule = rule => {
  const alternatives = splitRuleAlternatives(rule)
  return alternatives.length > 0 && alternatives.every(isJsonAccessorRule)
}

const isExplicitJsonListRule = rule =>
  splitRuleAlternatives(rule).every(alternative => {
    const trimmed = alternative.trim()
    return /^@?json:/i.test(trimmed) || trimmed.startsWith('$')
  })

const shouldParseSearchResponseAsJson = (listRule, text) =>
  isJsonPathUnionRule(listRule) &&
  (isExplicitJsonListRule(listRule) || /^[\s\uFEFF]*[\[{]/.test(text))

const isJsonPathCompoundRule = rule => {
  const alternatives = splitRuleAlternatives(rule)
  return (
    alternatives.length > 0 &&
    alternatives.every(alternative =>
      splitRuleConjunctions(alternative).every(isJsonAccessorRule),
    )
  )
}

const collectJsonProperty = (value, property, results = []) => {
  if (Array.isArray(value)) {
    value.forEach(item => collectJsonProperty(item, property, results))
    return results
  }
  if (!isRecord(value)) return results

  Object.entries(value).forEach(([key, child]) => {
    if (key === property) results.push(child)
    collectJsonProperty(child, property, results)
  })
  return results
}

const selectJsonBracketValues = (value, selector) => {
  if (selector === '*') {
    if (Array.isArray(value)) return value
    return isRecord(value) ? Object.values(value) : []
  }

  if (selector.includes(':')) {
    if (!Array.isArray(value)) return []
    const [startText, endText] = selector.split(':')
    const start =
      startText === '' ? 0 : normalizeIndex(Number(startText), value.length)
    const end =
      endText === ''
        ? value.length
        : normalizeIndex(Number(endText), value.length)
    return value.slice(Math.max(0, start), Math.max(0, end))
  }

  if (!Array.isArray(value)) return []
  const normalizedIndex = normalizeIndex(Number(selector), value.length)
  return value[normalizedIndex] === undefined ? [] : [value[normalizedIndex]]
}

const expandJsonToken = (value, token) => {
  const bracketOnlyMatch = token.match(/^\[([^\]]+)\]$/)
  if (bracketOnlyMatch !== null) {
    return selectJsonBracketValues(value, bracketOnlyMatch[1])
  }

  if (token === '*') {
    if (Array.isArray(value)) return value
    return isRecord(value) ? Object.values(value) : []
  }

  const match = token.match(/^([^[\]]+)(?:\[([^\]]+)\])?$/)
  if (match === null || !isRecord(value)) return []

  const child = value[match[1]]
  const selector = match[2]
  return selector === undefined
    ? [child]
    : selectJsonBracketValues(child, selector)
}

const readJsonPathValues = (value, path) => {
  const trimmed = normalizeJsonRule(path)
  if (trimmed === '$') return [value]
  if (trimmed.startsWith('$..')) {
    const [property, ...rest] = trimmed.slice(3).split('.').filter(Boolean)
    if (!property) return []
    const propertyMatch = property.match(/^([^[\]]+)(?:\[([^\]]+)\])?$/)
    if (propertyMatch === null) return []
    const values = collectJsonProperty(value, propertyMatch[1])
    const selector = propertyMatch[2]
    const expanded =
      selector === undefined
        ? values
        : values.flatMap(item => selectJsonBracketValues(item, selector))
    return rest.reduce(
      (current, token) => current.flatMap(item => expandJsonToken(item, token)),
      expanded,
    )
  }
  if (!trimmed.startsWith('$.') && !trimmed.startsWith('$[')) return []

  return trimmed
    .slice(trimmed.startsWith('$.') ? 2 : 1)
    .split('.')
    .filter(Boolean)
    .reduce(
      (current, token) => current.flatMap(item => expandJsonToken(item, token)),
      [value],
    )
}

const readJsonAccessorValues = (value, path) => {
  const trimmed = normalizeJsonRule(path)
  if (isJsonPathRule(trimmed)) return readJsonPathValues(value, trimmed)
  const bracketOnlyMatch = trimmed.match(/^\[([^\]]+)\]$/)
  if (bracketOnlyMatch !== null) {
    return selectJsonBracketValues(value, bracketOnlyMatch[1])
  }
  if (!JSON_ACCESSOR_PATTERN.test(trimmed)) return []

  return trimmed
    .split('.')
    .filter(Boolean)
    .reduce(
      (current, token) => current.flatMap(item => expandJsonToken(item, token)),
      [value],
    )
}

const readJsonPathText = (value, path) =>
  readJsonAccessorValues(value, path)
    .flatMap(item => (Array.isArray(item) ? item : [item]))
    .map(normalizeRuleText)
    .filter(Boolean)
    .join(',')

const readJsonPathUnionValues = (
  value,
  rule,
  { flattenTerminalArrays = false } = {},
) => {
  const results = []
  const seen = new Set()
  splitRuleAlternatives(rule).forEach(path => {
    readJsonAccessorValues(value, normalizeJsonRule(path)).forEach(item => {
      const values =
        flattenTerminalArrays && Array.isArray(item) ? item : [item]
      values.forEach(result => {
        const key = JSON.stringify(result)
        if (seen.has(key)) return
        seen.add(key)
        results.push(result)
      })
    })
  })
  return results
}

const readJsonCompoundText = (item, ruleBody) =>
  splitRuleAlternatives(ruleBody)
    .map(alternative =>
      splitRuleConjunctions(alternative)
        .map(path => readJsonPathText(item, path))
        .filter(Boolean)
        .join(','),
    )
    .find(Boolean) ?? ''

const stripJsonVariableOperators = ruleBody =>
  normalizeJsonRule(ruleBody).replace(/@put:\{[^}]+\}/g, '')

const normalizeJsonRuleBody = (ruleBody, item) =>
  stripJsonVariableOperators(ruleBody).replace(
    /@get:\{([^}]+)\}/g,
    (_, expression) => readJsonPathText(item, expression.trim()),
  )

const readBookTemplateValue = (context, expression) => {
  const match = expression.trim().match(/^book\.([A-Za-z_$][\w$]*)$/)
  if (match === null || !isRecord(context?.book)) return undefined
  return normalizeRuleText(context.book[match[1]])
}

const renderBookTemplate = (ruleBody, context) =>
  ruleBody.replace(/\{\{\s*book\.([A-Za-z_$][\w$]*)\s*\}\}/g, (_, field) =>
    isRecord(context?.book) ? normalizeRuleText(context.book[field]) : '',
  )

const hasBookTemplate = rule => /\{\{\s*book\.[A-Za-z_$][\w$]*\s*\}\}/.test(rule)

const readBookTemplateRuleValue = (rule, context) => {
  const [ruleBody, ...replacements] = String(rule ?? '').trim().split('##')
  return applyRuleReplacements(
    renderBookTemplate(ruleBody, context),
    replacements.filter(Boolean),
  )
}

const isDirectUrlTemplateRule = rule => {
  const [ruleBody] = String(rule ?? '').trim().split('##')
  return /^(?:https?:\/\/|\/)/i.test(ruleBody.trim()) && /\{\{[\s\S]*?\}\}/.test(ruleBody)
}

const readSafeRuleTemplateExpression = (expression, context, baseUrl) => {
  const trimmed = expression.trim().replace(/;+\s*$/, '')
  const bookMatch = trimmed.match(/^book\.([A-Za-z_$][\w$]*)$/)
  if (bookMatch !== null && isRecord(context?.book)) {
    return normalizeRuleText(context.book[bookMatch[1]])
  }

  if (/^baseUrl$/i.test(trimmed)) return baseUrl
  const baseMatch = trimmed.match(
    /^baseUrl\.match\(\s*\/((?:\\\/|\\.|[^/])*)\/([gimsuy]*)\s*\)\s*(?:\[\s*(\d+)\s*\]|\?\.\[\s*(\d+)\s*\])$/i,
  )
  if (baseMatch !== null) {
    const flags = baseMatch[2].replace(/g/g, '')
    const regex = new RegExp(decodeStaticRuleString(baseMatch[1]), flags)
    const result = String(baseUrl ?? '').match(regex)
    return normalizeRuleText(result?.[Number(baseMatch[3] ?? baseMatch[4])])
  }

  if (/^cookie\.(?:getKey|getCookie)\s*\(/i.test(trimmed)) return ''

  const sourceMatch = trimmed.match(/^source\.(?:key|bookSourceUrl)$/i)
  if (sourceMatch !== null && isRecord(context?.source)) {
    return normalizeRuleText(context.source.bookSourceUrl)
  }

  throw new Error(`URL 模板表达式「{{${expression}}}」暂不支持`)
}

const readDirectUrlTemplateRuleValue = (rule, context, baseUrl) => {
  const [ruleBody, ...replacements] = String(rule ?? '').trim().split('##')
  const rendered = ruleBody.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression) =>
    readSafeRuleTemplateExpression(expression, context, baseUrl),
  )
  return applyRuleReplacements(rendered, replacements.filter(Boolean))
}

const renderJsonRuleTemplate = (ruleBody, item, context = {}) =>
  ruleBody
    .replace(/\{\{(.*?)\}\}/g, (_, expression) => {
      const path = expression.trim()
      return path === ''
        ? ''
        : (readBookTemplateValue(context, path) ?? readJsonPathText(item, path))
    })
    .replace(/\{(\$[\s\S]*?)\}/g, (_, expression) =>
      readJsonPathText(item, expression.trim()),
    )

const readJsonRuleValue = (item, rule, context = {}) => {
  const parsedRule = parseRule(rule)
  if (parsedRule === undefined) return ''

  const [ruleBody] = rule.trim().split('##')
  const normalizedRuleBody = normalizeJsonRuleBody(ruleBody, item)
  const hasTemplate = /\{\{[\s\S]*?\}\}|\{\$[\s\S]*?\}/.test(normalizedRuleBody)
  const templateValue = renderJsonRuleTemplate(normalizedRuleBody, item, context)
  const value = hasTemplate
    ? templateValue
    : isJsonPathCompoundRule(normalizedRuleBody)
      ? readJsonCompoundText(item, normalizedRuleBody)
      : templateValue
  return applyRuleReplacements(value, parsedRule.replacements)
}

const isHttpUrl = value => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const normalizeBookSourceUrl = value => {
  const trimmed = String(value ?? '').trim()
  if (isHttpUrl(trimmed)) return trimmed
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d+)?(?:\/.*)?$/.test(trimmed)) {
    return `http://${trimmed}`
  }
  return ''
}

const stripLegadoUrlOptions = value => {
  const trimmed = value.trim()
  if (!trimmed.endsWith('}')) return trimmed

  const optionMatch = trimmed.match(/,\s*(\{[\s\S]*\})$/)
  if (optionMatch === null || optionMatch.index === undefined) return trimmed

  try {
    const parsed = JSON.parse(optionMatch[1])
    return isRecord(parsed) ? trimmed.slice(0, optionMatch.index) : trimmed
  } catch {
    return trimmed
  }
}

const resolveHttpUrl = (value, baseUrl) => {
  const trimmed = stripLegadoUrlOptions(value)
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed, baseUrl)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

const resolveImageUrl = (value, baseUrl) => {
  const trimmed = stripLegadoUrlOptions(value)
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed, baseUrl)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString()
    }
    if (url.protocol === 'data:' && url.toString().startsWith('data:image/')) {
      return url.toString()
    }
    return ''
  } catch {
    return ''
  }
}

const isComplexLegadoRule = rule => {
  const [ruleBody] = String(rule ?? '')
    .trim()
    .split('##')
  if (isJsonPathCompoundRule(stripJsonVariableOperators(ruleBody))) {
    return false
  }
  return COMPLEX_LEGADO_RULE_PATTERN.test(rule ?? '')
}

const isSupportedStaticResultTransformRule = rule => {
  const transform = splitStaticResultTransformRule(rule)
  return (
    transform !== undefined &&
    Boolean(transform.baseRule) &&
    applyStaticResultTransform('__probe__', transform.script) !== undefined
  )
}

const isSupportedSearchRulePart = rule =>
  !isComplexLegadoRule(rule) || isSupportedStaticResultTransformRule(rule)

const isSupportedSearchRuleAlternative = rule =>
  splitRuleConjunctions(rule).every(isSupportedSearchRulePart)

const hasSupportedSearchRulePath = rule => {
  const text = String(rule ?? '').trim()
  if (hasEmbeddedRuleTemplate(text)) return true
  const [ruleBody] = text.split('##')
  if (!ruleBody.trim() && text.startsWith('##')) return true
  if (!ruleBody) return false
  if (isJsonPathCompoundRule(stripJsonVariableOperators(ruleBody))) return true
  return splitRuleAlternatives(ruleBody).some(isSupportedSearchRuleAlternative)
}

const buildSourceSearchBook = ($, source, node, baseUrl, index) => {
  const rule = source.ruleSearch ?? {}
  const scope = $(node)
  const name = readRuleValue($, scope, rule.name, baseUrl)
  if (!name) return undefined

  const author = readOptionalRuleValue($, scope, rule.author, baseUrl)
  const kind = readOptionalRuleValue($, scope, rule.kind, baseUrl) || undefined
  const wordCount =
    readOptionalRuleValue($, scope, rule.wordCount, baseUrl) || undefined
  const templateContext = { book: { name, author, kind, wordCount } }
  const bookUrl = resolveHttpUrl(
    hasBookTemplate(rule.bookUrl)
      ? readBookTemplateRuleValue(rule.bookUrl, templateContext)
      : readRuleValue($, scope, rule.bookUrl, baseUrl),
    baseUrl,
  )
  if (!bookUrl) return undefined

  const coverUrl = resolveImageUrl(
    readOptionalRuleValue($, scope, rule.coverUrl, baseUrl),
    baseUrl,
  )
  const now = Date.now()
  return attachSourceSearchBookSignature({
    entryType: 'source-search',
    name,
    author,
    bookUrl,
    kind,
    wordCount,
    sourceName: source.bookSourceName,
    sourceUrl: source.bookSourceUrl,
    origin: source.bookSourceUrl,
    originName: source.bookSourceName,
    type: source.bookSourceType,
    coverUrl: coverUrl || undefined,
    intro: readOptionalRuleValue($, scope, rule.intro, baseUrl) || undefined,
    latestChapterTitle:
      readOptionalRuleValue($, scope, rule.lastChapter, baseUrl) || undefined,
    tocUrl: bookUrl,
    resultKey: `${source.bookSourceUrl}\u0000${bookUrl}`,
    resultIndex: index,
    originOrder: source.customOrder,
    weight: source.weight,
    searchedAt: now,
    time: now,
  })
}

const buildJsonSourceSearchBook = (source, item, baseUrl, index) => {
  const rule = source.ruleSearch ?? {}
  const name = readJsonRuleValue(item, rule.name)
  if (!name) return undefined

  const author = readJsonRuleValue(item, rule.author)
  const kind = readJsonRuleValue(item, rule.kind) || undefined
  const wordCount = readJsonRuleValue(item, rule.wordCount) || undefined
  const templateContext = { book: { name, author, kind, wordCount } }
  const bookUrl = resolveHttpUrl(
    readJsonRuleValue(item, rule.bookUrl, templateContext),
    baseUrl,
  )
  if (!bookUrl) return undefined

  const coverUrl = resolveImageUrl(
    readJsonRuleValue(item, rule.coverUrl),
    baseUrl,
  )
  const now = Date.now()
  return attachSourceSearchBookSignature({
    entryType: 'source-search',
    name,
    author,
    bookUrl,
    kind,
    wordCount,
    sourceName: source.bookSourceName,
    sourceUrl: source.bookSourceUrl,
    origin: source.bookSourceUrl,
    originName: source.bookSourceName,
    type: source.bookSourceType,
    coverUrl: coverUrl || undefined,
    intro: readJsonRuleValue(item, rule.intro) || undefined,
    latestChapterTitle: readJsonRuleValue(item, rule.lastChapter) || undefined,
    tocUrl: bookUrl,
    resultKey: `${source.bookSourceUrl}\u0000${bookUrl}`,
    resultIndex: index,
    originOrder: source.customOrder,
    weight: source.weight,
    searchedAt: now,
    time: now,
  })
}

const appendWarnings = (message, warnings) => {
  const text = unique(warnings).join('；')
  return text ? `${message}；${text}` : message
}

const isSelectorSyntaxError = error =>
  error instanceof Error &&
  /(selector|pseudo|expected|unmatched|empty sub-selector|not a valid selector)/i.test(
    error.message,
  )

const isAnonymousAccessRejected = (error, source) =>
  error instanceof Error &&
  /HTTP 40[13]/.test(error.message) &&
  (source.enabledCookieJar ||
    Boolean(source.loginUrl) ||
    Boolean(source.loginUi) ||
    Boolean(source.loginCheckJs))

const parseJsonSearchResponse = text => {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw Object.assign(
      new Error(
        `响应不是合法 JSON，无法按 JSONPath 搜索列表规则解析：${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
      { sourceSearchCode: 'JSON_RESPONSE_PARSE' },
    )
  }
}

const isJsonResponseParseError = error =>
  isRecord(error) && error.sourceSearchCode === 'JSON_RESPONSE_PARSE'

const searchSingleBookSource = async (source, searchKey) => {
  if (source.bookSourceUrl === 'https://example.com') {
    return {
      books: [],
      report: sourceSearchReport(
        source,
        'skipped',
        '示例书源不会参与搜索，请在书源管理中导入真实书源。',
      ),
    }
  }

  if (!source.enabled) {
    return {
      books: [],
      report: sourceSearchReport(source, 'skipped', '书源未启用'),
    }
  }

  if (!source.searchUrl?.trim()) {
    return {
      books: [],
      report: sourceSearchReport(source, 'skipped', '未配置搜索地址'),
    }
  }
  const unsupportedSearchUrlExpression = findUnsupportedSearchUrlExpression(
    source.searchUrl,
  )
  if (unsupportedSearchUrlExpression) {
    return {
      books: [],
      report: sourceSearchReport(
        source,
        'unsupported',
        `搜索地址表达式「${unsupportedSearchUrlExpression}」需要执行 JS 或动态请求，当前 Web 服务端搜索暂不支持`,
      ),
    }
  }
  const normalizedBookSourceUrl = normalizeBookSourceUrl(source.bookSourceUrl)
  if (!normalizedBookSourceUrl) {
    return {
      books: [],
      report: sourceSearchReport(
        source,
        'unsupported',
        '书源域名必须是 http/https URL',
      ),
    }
  }
  const searchableSource =
    normalizedBookSourceUrl === source.bookSourceUrl
      ? source
      : { ...source, bookSourceUrl: normalizedBookSourceUrl }

  const ruleSearch = source.ruleSearch ?? {}
  const listRule = ruleSearch.bookList?.trim()
  if (!listRule) {
    return {
      books: [],
      report: sourceSearchReport(
        searchableSource,
        'skipped',
        '未配置搜索列表规则',
      ),
    }
  }
  if (!ruleSearch.name?.trim()) {
    return {
      books: [],
      report: sourceSearchReport(searchableSource, 'skipped', '未配置书名规则'),
    }
  }
  if (!ruleSearch.bookUrl?.trim()) {
    return {
      books: [],
      report: sourceSearchReport(
        searchableSource,
        'skipped',
        '未配置详情地址规则',
      ),
    }
  }

  const unsupportedRequiredRule = [
    listRule,
    ruleSearch.name,
    ruleSearch.bookUrl,
  ].find(rule => !hasSupportedSearchRulePath(rule))
  if (unsupportedRequiredRule !== undefined) {
    return {
      books: [],
      report: sourceSearchReport(
        searchableSource,
        'unsupported',
        `规则「${unsupportedRequiredRule}」超出当前 Web 搜索支持范围`,
      ),
    }
  }

  const warnings = []
  if (source.enabledCookieJar) {
    warnings.push('该书源启用了 CookieJar，服务端本次按匿名请求搜索')
  }
  if (source.jsLib) warnings.push('jsLib 暂不执行')
  if (source.loginUi || source.loginCheckJs) warnings.push('登录脚本暂不执行')
  if (source.coverDecodeJs) warnings.push('封面解密 JS 暂不执行')

  try {
    const request = buildSourceSearchRequest(searchableSource, searchKey)
    warnings.push(...request.warnings)
    const { finalUrl, headers, content } = await requestBytes(request.url, {
      method: request.method,
      headers: normalizeProxyHeaders(request.headers, {
        allowOriginReferer: true,
      }),
      body: request.body,
      timeout: SOURCE_SEARCH_TIMEOUT_MS,
      urlLabel: '搜索地址',
    })
    const text = decodeSourceText(content, headers, request.charset)
    const books = shouldParseSearchResponseAsJson(listRule, text)
      ? readJsonPathUnionValues(parseJsonSearchResponse(text), listRule, {
          flattenTerminalArrays: true,
        })
          .map((item, index) =>
            buildJsonSourceSearchBook(searchableSource, item, finalUrl, index),
          )
          .filter(Boolean)
          .slice(0, SOURCE_SEARCH_RESULT_LIMIT)
      : (() => {
          const $ = cheerio.load(text)
          return selectBookListNodes($, listRule)
            .map((node, index) =>
              buildSourceSearchBook($, searchableSource, node, finalUrl, index),
            )
            .filter(Boolean)
            .slice(0, SOURCE_SEARCH_RESULT_LIMIT)
        })()

    return {
      books,
      report: sourceSearchReport(
        searchableSource,
        books.length > 0 ? 'success' : 'empty',
        appendWarnings(
          books.length > 0
            ? `找到 ${books.length} 条结果，最多显示前 ${SOURCE_SEARCH_RESULT_LIMIT} 条`
            : '请求成功，但搜索规则没有解析出书籍',
          warnings,
        ),
        books.length,
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status =
      !isJsonResponseParseError(error) &&
      (isSelectorSyntaxError(error) ||
        isAnonymousAccessRejected(error, searchableSource))
        ? 'unsupported'
        : 'failed'
    return {
      books: [],
      report: sourceSearchReport(
        searchableSource,
        status,
        appendWarnings(
          isAnonymousAccessRejected(error, searchableSource)
            ? `目标站拒绝匿名搜索请求：${message}`
            : status === 'unsupported'
              ? `规则语法不支持：${message}`
              : isJsonResponseParseError(error)
                ? message
                : `搜索失败：${message}`,
          warnings,
        ),
      ),
    }
  }
}

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await mapper(items[index], index)
      }
    }),
  )
  return results.filter(Boolean)
}

const compareBookSources = (left, right) =>
  (left.customOrder ?? 0) - (right.customOrder ?? 0) ||
  (right.weight ?? 0) - (left.weight ?? 0) ||
  String(left.bookSourceName).localeCompare(String(right.bookSourceName))

const normalizeSearchText = value =>
  String(value ?? '')
    .trim()
    .toLocaleLowerCase()

const collectSourceRuleStrings = (value, output = []) => {
  if (value === undefined || value === null) return output
  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value))
    return output
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectSourceRuleStrings(item, output))
    return output
  }
  if (typeof value === 'object') {
    Object.values(value).forEach(item => collectSourceRuleStrings(item, output))
  }
  return output
}

const sourceHasSearchRule = source =>
  Boolean(
    source.searchUrl?.trim() &&
      source.ruleSearch?.bookList?.trim() &&
      source.ruleSearch?.name?.trim() &&
      source.ruleSearch?.bookUrl?.trim(),
  )

const sourceNeedsCookieJar = source => source.enabledCookieJar === true
const sourceNeedsLogin = source =>
  Boolean(source.loginUi?.trim() || source.loginCheckJs?.trim())
const sourceUsesJsRule = source =>
  Boolean(
    source.jsLib?.trim() ||
      source.loginUi?.trim() ||
      source.loginCheckJs?.trim() ||
      source.coverDecodeJs?.trim() ||
      collectSourceRuleStrings([
        source.searchUrl,
        source.ruleSearch,
        source.ruleBookInfo,
        source.ruleToc,
        source.ruleContent,
        source.ruleExplore,
      ]).some(rule =>
        /(^\s*(?:@?js:|<js>)|<js>|java\.|source\.getVariable|source\.setVariable)/i.test(
          rule,
        ),
      ),
  )

const sourceFeatureMatches = (source, feature) => {
  if (feature === 'searchable') return sourceHasSearchRule(source)
  if (feature === 'unsearchable') return !sourceHasSearchRule(source)
  if (feature === 'cookie') return sourceNeedsCookieJar(source)
  if (feature === 'js') return sourceUsesJsRule(source)
  if (feature === 'login') return sourceNeedsLogin(source)
  return true
}

const sourceEnabledMatches = (source, enabled) => {
  if (enabled === 'enabled') return source.enabled === true
  if (enabled === 'disabled') return source.enabled !== true
  return true
}

const sourceFilterTexts = source => {
  const rule = collectSourceRuleStrings([
    source.searchUrl,
    source.exploreUrl,
    source.bookUrlPattern,
    source.ruleSearch,
    source.ruleBookInfo,
    source.ruleToc,
    source.ruleContent,
    source.ruleExplore,
  ])
  const group = source.bookSourceGroup
  const comment = source.bookSourceComment
  return {
    all: [
      source.bookSourceName,
      source.bookSourceUrl,
      group,
      comment,
      source.variableComment,
      ...rule,
    ].filter(value => typeof value === 'string'),
    name: [source.bookSourceName],
    url: [source.bookSourceUrl],
    group: group ? [group] : [],
    comment: comment ? [comment] : [],
    rule,
  }
}

const sourceFilterFieldAlias = {
  n: 'name',
  name: 'name',
  名称: 'name',
  u: 'url',
  url: 'url',
  地址: 'url',
  g: 'group',
  group: 'group',
  分组: 'group',
  c: 'comment',
  comment: 'comment',
  备注: 'comment',
  r: 'rule',
  rule: 'rule',
  规则: 'rule',
}

const sourceFilterTokenMatches = (source, token, defaultField) => {
  const match = token.match(/^([^:：]+)[:：](.+)$/)
  const field = match?.[1] ? sourceFilterFieldAlias[match[1]] : defaultField
  const keyword = match?.[2] ?? token
  if (!keyword) return true
  return sourceFilterTexts(source)[field ?? defaultField].some(value =>
    normalizeSearchText(value).includes(keyword),
  )
}

const sourceMatchesSearchFilter = (source, filter) => {
  const enabled = filter?.enabled ?? 'all'
  const feature = filter?.feature ?? 'all'
  const field = filter?.field ?? 'all'
  if (!sourceEnabledMatches(source, enabled)) return false
  if (!sourceFeatureMatches(source, feature)) return false
  const tokens = normalizeSearchText(filter?.keyword)
    .split(/\s+/)
    .filter(Boolean)
  return tokens.every(token => sourceFilterTokenMatches(source, token, field))
}

const searchBookSources = async (keyword, sourceFilter = {}) => {
  const searchKey = keyword.trim()
  if (!searchKey) return { books: [], reports: [] }
  if (searchKey.length > SEARCH_KEYWORD_MAX_LENGTH) {
    throw badRequest(`搜索关键词不能超过 ${SEARCH_KEYWORD_MAX_LENGTH} 个字符`)
  }

  const sources = (await getSources('bookSource')).sort(compareBookSources)
  const filteredSources = sources.filter(source =>
    sourceMatchesSearchFilter(source, sourceFilter),
  )
  const results = await mapWithConcurrency(
    filteredSources,
    SOURCE_SEARCH_CONCURRENCY,
    source => searchSingleBookSource(source, searchKey),
  )
  const bookMap = new Map()
  const reports = []
  if (filteredSources.length < sources.length) {
    reports.push({
      sourceName: '系统',
      sourceUrl: '',
      status: 'skipped',
      count: sources.length - filteredSources.length,
      message: `已按书源筛选条件搜索 ${filteredSources.length}/${sources.length} 个书源，跳过 ${sources.length - filteredSources.length} 个`,
    })
  }
  let truncatedCount = 0
  results.forEach(result => {
    reports.push(result.report)
    result.books.forEach(book => {
      if (bookMap.has(book.resultKey)) return
      if (bookMap.size >= SOURCE_SEARCH_TOTAL_RESULT_LIMIT) {
        truncatedCount += 1
        return
      }
      bookMap.set(book.resultKey, book)
    })
  })
  if (truncatedCount > 0) {
    reports.push({
      sourceName: '系统',
      sourceUrl: '',
      status: 'truncated',
      count: truncatedCount,
      message: `搜索结果已限制为 ${SOURCE_SEARCH_TOTAL_RESULT_LIMIT} 条，另有 ${truncatedCount} 条未返回`,
    })
  }

  return { books: Array.from(bookMap.values()), reports }
}

const isSourceSearchBookPayload = value =>
  isRecord(value) &&
  value.entryType === 'source-search' &&
  typeof value.name === 'string' &&
  typeof value.bookUrl === 'string' &&
  typeof value.sourceUrl === 'string'

const requireSourceSearchBook = value => {
  if (!isSourceSearchBookPayload(value)) {
    throw badRequest('加入书架请求缺少有效的书源搜索结果')
  }
  verifySourceSearchBookSignature(value)
  const name = requireNonEmptyString(value.name, '书名')
  const sourceUrl = resolveHttpUrl(value.sourceUrl, value.sourceUrl)
  if (!sourceUrl) throw badRequest('书源地址必须是 http/https URL')
  const bookUrl = resolveHttpUrl(value.bookUrl, value.sourceUrl)
  if (!bookUrl) throw badRequest('书籍详情地址必须是 http/https URL')
  const tocUrl =
    value.tocUrl === undefined || value.tocUrl === ''
      ? value.tocUrl
      : resolveHttpUrl(value.tocUrl, bookUrl)
  if (value.tocUrl && !tocUrl) throw badRequest('目录地址必须是 http/https URL')
  return { ...value, name, sourceUrl, bookUrl, tocUrl }
}

const normalizedSourceUrlEquals = (left, right) => {
  const normalizedLeft = normalizeBookSourceUrl(left)
  const normalizedRight = normalizeBookSourceUrl(right)
  return (
    normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    normalizedLeft === normalizedRight
  )
}

const normalizeComparableHttpUrl = value => {
  try {
    const url = new URL(value)
    url.hash = ''
    if (
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    ) {
      url.port = ''
    }
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    return url.toString()
  } catch {
    return String(value ?? '').trim()
  }
}

const sourcePageUrlEquals = (left, right) =>
  Boolean(left) &&
  Boolean(right) &&
  normalizeComparableHttpUrl(left) === normalizeComparableHttpUrl(right)

const findBookSourceInList = (sources, sourceUrl) =>
  sources.find(
    source =>
      source.bookSourceUrl === sourceUrl ||
      normalizedSourceUrlEquals(source.bookSourceUrl, sourceUrl),
  )

const findBookSourceByUrl = async sourceUrl => {
  const sources = await getSources('bookSource')
  return findBookSourceInList(sources, sourceUrl)
}

const findBookSourceForSearchBook = async searchBook => {
  const sources = await getSources('bookSource')
  const source =
    findBookSourceInList(sources, searchBook.sourceUrl) ??
    findBookSourceInList(sources, searchBook.origin)
  if (source === undefined) {
    throw new Error(`未找到书源「${searchBook.sourceName}」配置，无法加入书架`)
  }
  return source
}

const findBookSourceForBook = async book => {
  const source = await findBookSourceByUrl(book.origin)
  if (source === undefined) {
    throw new Error(
      `书源「${book.originName ?? book.origin}」不存在，无法解析正文`,
    )
  }
  return source
}

const sourceRuntimeNotes = source => {
  const notes = []
  if (source.enabledCookieJar) {
    notes.push('该书源启用了 CookieJar，服务端按匿名请求解析')
  }
  if (source.jsLib) notes.push('jsLib 暂不执行')
  if (source.loginUi || source.loginCheckJs) notes.push('登录脚本暂不执行')
  if (source.coverDecodeJs) notes.push('封面解密 JS 暂不执行')
  return notes
}

const fetchSourcePageText = async (
  source,
  rawUrl,
  label,
  requestOptions = {},
) => {
  const url = resolveHttpUrl(rawUrl, source.bookSourceUrl)
  if (!url) throw new SourceParseError(`${label}必须是 http/https URL`)
  const method = requestOptions.method === 'POST' ? 'POST' : 'GET'

  const { headers, warnings } = parseSourceHeaders(source.header, {
    allowOriginReferer: true,
  })
  applyDefaultSourceSearchHeaders(headers, url, method)
  if (
    method === 'POST' &&
    requestOptions.contentType &&
    !hasHeader(headers, 'content-type')
  ) {
    headers['Content-Type'] = requestOptions.contentType
  }

  try {
    const response = await requestBytes(url, {
      method,
      headers: normalizeProxyHeaders(headers, { allowOriginReferer: true }),
      body:
        typeof requestOptions.body === 'string'
          ? requestOptions.body
          : undefined,
      timeout: SOURCE_FETCH_TIMEOUT_MS,
      urlLabel: label,
    })
    return {
      finalUrl: response.finalUrl,
      text: decodeSourceText(
        response.content,
        response.headers,
        source.charset ?? source.bookSourceCharset ?? source.bookSourceEncoding,
      ),
      warnings,
    }
  } catch (error) {
    throw new SourceParseError(
      appendWarnings(
        `${label}抓取失败：${error instanceof Error ? error.message : String(error)}`,
        warnings.concat(sourceRuntimeNotes(source)),
      ),
    )
  }
}

const decodeStaticJsString = decodeStaticRuleString

const parseStaticObjectParams = objectText => {
  const params = new URLSearchParams()
  for (const match of objectText.matchAll(
    /['"]?([A-Za-z_$][\w$-]*)['"]?\s*:\s*(?:(['"])((?:\\.|(?!\2)[\s\S])*?)\2|(-?\d+(?:\.\d+)?)\b|(true|false|null)\b)/g,
  )) {
    const value =
      match[3] !== undefined
        ? decodeStaticJsString(match[3])
        : match[4] !== undefined
          ? match[4]
          : match[5] === 'null'
            ? ''
            : match[5]
    params.set(match[1], value)
  }
  return params
}

const serializeStaticJqueryBody = (dataText, contentType) => {
  const trimmed = dataText.trim()
  if (trimmed.startsWith('{')) {
    const params = parseStaticObjectParams(trimmed)
    if (Array.from(params.keys()).length === 0) return undefined
    if (/application\/json/i.test(contentType ?? '')) {
      return JSON.stringify(Object.fromEntries(params.entries()))
    }
    return params.toString()
  }
  const stringMatch = trimmed.match(/^(['"])((?:\\.|(?!\1)[\s\S])*)\1$/)
  return stringMatch === null ? undefined : decodeStaticJsString(stringMatch[2])
}

const buildStaticJqueryRequest = ({
  rawUrl,
  rawData,
  baseUrl,
  method = 'POST',
  contentType = 'application/x-www-form-urlencoded; charset=UTF-8',
}) => {
  const resolvedUrl = resolveHttpUrl(rawUrl, baseUrl)
  const body = serializeStaticJqueryBody(rawData, contentType)
  if (!resolvedUrl || body === undefined) return undefined
  const normalizedMethod = method.toUpperCase() === 'GET' ? 'GET' : 'POST'
  if (normalizedMethod === 'GET') {
    const url = new URL(resolvedUrl)
    const params = new URLSearchParams(body)
    params.forEach((value, key) => url.searchParams.set(key, value))
    return { url: url.toString(), method: 'GET' }
  }
  return { url: resolvedUrl, method: normalizedMethod, body, contentType }
}

const findStaticJqueryContentRequest = (text, baseUrl) => {
  const contentAccessorPattern = String.raw`(?:[A-Za-z_$][\w$]*(?:\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\]))*\s*(?:\[\s*['"]content['"]\s*\]|\.\s*content))`
  const postMatch = text.match(
    new RegExp(
      String.raw`\$\.post\(\s*(['"])(.*?)\1\s*,\s*(\{[\s\S]*?\}|(['"])(?:\\.|(?!\4)[\s\S])*?\4)\s*,[\s\S]{0,2000}?${contentAccessorPattern}[\s\S]{0,2000}?(?:['"]json['"])?\s*\)`,
      'i',
    ),
  )
  if (postMatch !== null) {
    return buildStaticJqueryRequest({
      rawUrl: postMatch[2],
      rawData: postMatch[3],
      baseUrl,
    })
  }

  const ajaxMatch = text.match(
    new RegExp(
      String.raw`\$\.ajax\(\s*\{[\s\S]*?url\s*:\s*(['"])(.*?)\1[\s\S]*?data\s*:\s*(\{[\s\S]*?\}|(['"])(?:\\.|(?!\4)[\s\S])*?\4)[\s\S]*?${contentAccessorPattern}`,
      'i',
    ),
  )
  if (ajaxMatch === null) return undefined
  const method =
    ajaxMatch[0].match(/(?:type|method)\s*:\s*(['"])(GET|POST)\1/i)?.[2] ??
    'POST'
  const contentType =
    ajaxMatch[0].match(/contentType\s*:\s*(['"])(.*?)\1/i)?.[2] ??
    'application/x-www-form-urlencoded; charset=UTF-8'
  return buildStaticJqueryRequest({
    rawUrl: ajaxMatch[2],
    rawData: ajaxMatch[3],
    baseUrl,
    method,
    contentType,
  })
}

const DYNAMIC_CONTENT_TEXT_KEYS = [
  'content',
  'chapterContent',
  'chapter_content',
  'html',
  'text',
  'body',
]
const DYNAMIC_CONTENT_CONTAINER_KEYS = [
  'data',
  'ret_data',
  'chapter',
  'book',
  'result',
]
const DYNAMIC_CONTENT_SUCCESS_STRINGS = new Set([
  '0',
  '1',
  '200',
  'ok',
  'success',
])

const dynamicPayloadLooksFailed = value => {
  if (!isRecord(value)) return false
  if (value.success === false || value.ok === false) return true
  const status = value.code ?? value.status ?? value.errno
  if (status === true) return false
  if (status === false) return true
  if (status === undefined || status === null || status === '') return false
  const normalized = String(status).toLowerCase()
  return !DYNAMIC_CONTENT_SUCCESS_STRINGS.has(normalized)
}

const looksLikeDynamicErrorText = value =>
  /(请登录|登录后|访问过于频繁|频繁访问|验证码|验证失败|无权限|禁止访问|错误|失败|异常|not\s+found|forbidden|unauthorized)/i.test(
    String(value ?? ''),
  )

const findContentTextInPayload = (value, depth = 0) => {
  if (depth > 4 || value === undefined || value === null) return ''
  if (typeof value === 'string') {
    return looksLikeDynamicErrorText(value) ? '' : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return ''
  if (Array.isArray(value)) {
    return value
      .map(item => findContentTextInPayload(item, depth + 1))
      .find(Boolean)
  }
  if (!isRecord(value)) return ''
  if (dynamicPayloadLooksFailed(value)) return ''

  for (const key of DYNAMIC_CONTENT_TEXT_KEYS) {
    const content = findContentTextInPayload(value[key], depth + 1)
    if (content) return content
  }

  const resultText =
    typeof value.result === 'string' && value.result.length > 20
      ? findContentTextInPayload(value.result, depth + 1)
      : ''
  if (resultText) return resultText

  for (const key of DYNAMIC_CONTENT_CONTAINER_KEYS) {
    if (typeof value[key] === 'string') continue
    const content = findContentTextInPayload(value[key], depth + 1)
    if (content) return content
  }
  return ''
}

const fetchStaticJqueryContent = async (
  source,
  page,
  request = findStaticJqueryContentRequest(page.text, page.finalUrl),
) => {
  if (request === undefined) return ''

  const { headers, warnings } = parseSourceHeaders(source.header, {
    allowOriginReferer: true,
  })
  headers.Accept = 'application/json, text/javascript, */*; q=0.01'
  if (request.contentType) headers['Content-Type'] = request.contentType
  headers['X-Requested-With'] = 'XMLHttpRequest'
  headers.Referer = page.finalUrl
  headers.Origin = new URL(page.finalUrl).origin

  try {
    const response = await requestBytes(request.url, {
      method: request.method ?? 'POST',
      headers: normalizeProxyHeaders(headers, { allowOriginReferer: true }),
      body: request.body,
      timeout: SOURCE_FETCH_TIMEOUT_MS,
      urlLabel: '正文动态接口',
    })
    const text = decodeSourceText(
      response.content,
      response.headers,
      source.charset ?? source.bookSourceCharset ?? source.bookSourceEncoding,
    )
    const payload = JSON.parse(text)
    return normalizeRuleText(findContentTextInPayload(payload))
  } catch (error) {
    throw new Error(
      appendWarnings(
        `正文动态接口抓取失败：${error instanceof Error ? error.message : String(error)}`,
        warnings.concat(sourceRuntimeNotes(source)),
      ),
    )
  }
}

const stripRuleReplacements = rule =>
  String(rule ?? '')
    .trim()
    .split('##')[0]
    .trim()

const isJsonReadableRule = rule => {
  const body = stripJsonVariableOperators(stripRuleReplacements(rule))
  return (
    isJsonPathCompoundRule(body) ||
    isJsonAccessorRule(body) ||
    /\{\{\s*\$/.test(body) ||
    /\{\s*\$/.test(body)
  )
}

const tryParseJsonPage = (text, rules) => {
  if (!/^[\s\uFEFF]*[\[{]/.test(text)) return undefined
  if (!rules.some(isJsonReadableRule)) return undefined
  return parseJsonSearchResponse(text)
}

const assertSupportedRule = (rule, label) => {
  if (isComplexLegadoRule(rule)) {
    throw new Error(`规则「${rule}」超出当前 Web ${label}支持范围`)
  }
}

const readOptionalSourceRuleValue = ($, scope, jsonData, rule, baseUrl) => {
  if (!rule?.trim() || isComplexLegadoRule(rule)) return ''
  try {
    return jsonData !== undefined && isJsonReadableRule(rule)
      ? readJsonRuleValue(jsonData, rule)
      : readRuleValue($, scope, rule, baseUrl)
  } catch {
    return ''
  }
}

const getErrorMessage = error =>
  error instanceof Error ? error.message : String(error)

const sourcePageNotes = (source, page) =>
  unique([
    ...(page.warnings ?? []),
    ...sourceRuntimeNotes(source),
    `当前地址：${page.finalUrl}`,
  ])

const wrapSourcePageParseError = (source, page, stage, error) =>
  new SourceParseError(
    appendWarnings(
      `${stage}解析失败：${getErrorMessage(error)}`,
      sourcePageNotes(source, page),
    ),
  )

const readOptionalCriticalSourceRuleValue = (
  $,
  scope,
  jsonData,
  rule,
  baseUrl,
  label,
  context = {},
) => {
  if (!rule?.trim()) return ''
  assertSupportedRule(rule, label)
  try {
    if (isDirectUrlTemplateRule(rule)) {
      return readDirectUrlTemplateRuleValue(rule, context, baseUrl)
    }
    if (hasBookTemplate(rule)) return readBookTemplateRuleValue(rule, context)
    if (jsonData !== undefined && !isJsonReadableRule(rule)) {
      throw new Error('JSON 页面规则必须使用 JSONPath、JSON accessor 或模板')
    }
    return jsonData !== undefined && isJsonReadableRule(rule)
      ? readJsonRuleValue(jsonData, rule)
      : readRuleValue($, scope, rule, baseUrl)
  } catch (error) {
    throw new Error(`规则「${rule}」解析失败：${getErrorMessage(error)}`)
  }
}

const readRequiredSourceRuleValue = (
  $,
  scope,
  jsonData,
  rule,
  baseUrl,
  label,
) => {
  assertSupportedRule(rule, label)
  if (jsonData !== undefined && !isJsonReadableRule(rule)) {
    throw new Error(
      `规则「${rule}」解析失败：JSON 页面规则必须使用 JSONPath、JSON accessor 或模板`,
    )
  }
  const value =
    jsonData !== undefined && isJsonReadableRule(rule)
      ? readJsonRuleValue(jsonData, rule)
      : readRuleValue($, scope, rule, baseUrl)
  return value.trim()
}

const resolveOptionalHttpUrl = (value, baseUrl) =>
  resolveHttpUrl(String(value ?? ''), baseUrl)

const parseRuleBoolean = value =>
  /^(true|1|yes|y|是|vip|收费|付费)$/i.test(String(value ?? '').trim())

const parseSourceBookInfo = (source, searchBook, page) => {
  const rule = source.ruleBookInfo ?? {}
  const rules = [
    rule.name,
    rule.author,
    rule.kind,
    rule.wordCount,
    rule.lastChapter,
    rule.intro,
    rule.coverUrl,
    rule.tocUrl,
  ]
  const jsonData = tryParseJsonPage(page.text, rules)
  const $ = cheerio.load(page.text)
  const root = $.root()
  const read = item =>
    readOptionalSourceRuleValue($, root, jsonData, item, page.finalUrl)
  const baseInfo = {
    name: read(rule.name) || searchBook.name,
    author: read(rule.author) || searchBook.author || '作者未知',
    kind: read(rule.kind) || searchBook.kind,
    wordCount: read(rule.wordCount) || searchBook.wordCount,
    latestChapterTitle: read(rule.lastChapter) || searchBook.latestChapterTitle,
    intro: read(rule.intro) || searchBook.intro,
  }
  const templateContext = {
    book: { ...searchBook, ...baseInfo },
    source,
  }
  const readCritical = (item, label) =>
    readOptionalCriticalSourceRuleValue(
      $,
      root,
      jsonData,
      item,
      page.finalUrl,
      label,
      templateContext,
    )
  const tocUrl =
    resolveOptionalHttpUrl(
      readCritical(rule.tocUrl, '详情目录地址'),
      page.finalUrl,
    ) ||
    resolveOptionalHttpUrl(searchBook.tocUrl, page.finalUrl) ||
    searchBook.bookUrl

  return {
    ...baseInfo,
    coverUrl:
      resolveImageUrl(read(rule.coverUrl), page.finalUrl) ||
      searchBook.coverUrl,
    tocUrl,
  }
}

const buildSourceChapterRecord = ({
  bookUrl,
  title,
  chapterUrl,
  tocUrl,
  index,
  isVolume,
  isVip,
  isPay,
  tag,
  contentRequest,
}) => ({
  id: chapterId(bookUrl, index),
  url: chapterUrl,
  title,
  isVolume,
  baseUrl: tocUrl,
  bookUrl,
  index,
  isVip,
  isPay,
  tag: tag || undefined,
  contentRequest,
  content: '',
})

const parseHtmlSourceTocPage = (source, page) => {
  const rule = source.ruleToc ?? {}
  const $ = cheerio.load(page.text)
  const nodes = selectBookListNodes($, rule.chapterList)
  const chapters = nodes
    .map(node => {
      const scope = $(node)
      const title = readRequiredSourceRuleValue(
        $,
        scope,
        undefined,
        rule.chapterName,
        page.finalUrl,
        '目录解析',
      )
      const chapterUrl = resolveHttpUrl(
        readRequiredSourceRuleValue(
          $,
          scope,
          undefined,
          rule.chapterUrl,
          page.finalUrl,
          '目录解析',
        ),
        page.finalUrl,
      )
      if (!title || !chapterUrl) return undefined
      return {
        title,
        chapterUrl,
        isVolume: parseRuleBoolean(
          readOptionalSourceRuleValue(
            $,
            scope,
            undefined,
            rule.isVolume,
            page.finalUrl,
          ),
        ),
        isVip: parseRuleBoolean(
          readOptionalSourceRuleValue(
            $,
            scope,
            undefined,
            rule.isVip,
            page.finalUrl,
          ),
        ),
        isPay: rule.isPay
          ? parseRuleBoolean(
              readOptionalSourceRuleValue(
                $,
                scope,
                undefined,
                rule.isPay,
                page.finalUrl,
              ),
            )
          : true,
        tag: readOptionalSourceRuleValue(
          $,
          scope,
          undefined,
          rule.updateTime,
          page.finalUrl,
        ),
      }
    })
    .filter(Boolean)

  const nextTocUrl = resolveOptionalHttpUrl(
    readOptionalCriticalSourceRuleValue(
      $,
      $.root(),
      undefined,
      rule.nextTocUrl,
      page.finalUrl,
      '目录下一页',
    ),
    page.finalUrl,
  )
  return { chapters, nextTocUrl }
}

const readStaticJsChapterName = (rule, item) => {
  const text = String(rule ?? '')
  if (!/^@js:/i.test(text) || !/\bresult\.serialName\b/.test(text)) return ''
  const title = normalizeRuleText(item?.serialName)
  if (!title) return ''
  if (!/\bisFree\b|\bchargeStatus\b/.test(text)) return title
  const isFree =
    item?.isFree === true || item?.isFree === 1 || item?.chargeStatus === 0
  return `${isFree ? '【👀】' : '【收💰费】'}${title}`
}

const buildStaticJsChapterContentRequest = (rule, item, context) => {
  const text = String(rule ?? '')
  if (
    !/^@js:/i.test(text) ||
    !text.includes('ContentAnchorBatch') ||
    !text.includes('ChapterSeqNo')
  ) {
    return undefined
  }
  const endpoint =
    text.match(/["'](https?:\/\/[^"']*\/be-api\/content\/ads-read),?["']/)?.[1] ??
    text.match(/["'](\/be-api\/content\/ads-read),?["']/)?.[1]
  const url = resolveHttpUrl(endpoint ?? '', context.bookSourceUrl)
  const bookId = normalizeRuleText(context.book?.kind ?? context.book?.bookId)
  const chapterSeqNo = Number(
    item?.serialID ?? item?.serialId ?? item?.chapterId,
  )
  if (!url || !bookId || !Number.isSafeInteger(chapterSeqNo)) return undefined
  return {
    url,
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({
      ContentAnchorBatch: [
        {
          BookID: bookId,
          ChapterSeqNo: [chapterSeqNo],
        },
      ],
      Scene: 'chapter',
    }),
  }
}

const readJsonTocChapterName = (item, rule, page, context) => {
  if (!isComplexLegadoRule(rule)) {
    return readRequiredSourceRuleValue(
      undefined,
      undefined,
      item,
      rule,
      page.finalUrl,
      '目录解析',
    )
  }
  const title = readStaticJsChapterName(rule, item, context)
  if (title) return title
  throw new Error(`规则「${rule}」超出当前 Web 目录解析支持范围`)
}

const readJsonTocChapterRequest = (item, rule, page, context) => {
  if (!isComplexLegadoRule(rule)) {
    const chapterUrl = resolveHttpUrl(
      readRequiredSourceRuleValue(
        undefined,
        undefined,
        item,
        rule,
        page.finalUrl,
        '目录解析',
      ),
      page.finalUrl,
    )
    return chapterUrl ? { url: chapterUrl } : undefined
  }
  const request = buildStaticJsChapterContentRequest(rule, item, context)
  if (request !== undefined) return request
  throw new Error(`规则「${rule}」超出当前 Web 目录解析支持范围`)
}

const parseJsonSourceTocPage = (source, page, jsonData, context) => {
  const rule = source.ruleToc ?? {}
  const items = readJsonPathUnionValues(jsonData, rule.chapterList, {
    flattenTerminalArrays: true,
  })
  const chapters = items
    .map(item => {
      const title = readJsonTocChapterName(item, rule.chapterName, page, context)
      const chapterRequest = readJsonTocChapterRequest(
        item,
        rule.chapterUrl,
        page,
        context,
      )
      if (!title || chapterRequest === undefined) return undefined
      return {
        title,
        chapterUrl: chapterRequest.url,
        contentRequest:
          chapterRequest.method === undefined
            ? undefined
            : {
                method: chapterRequest.method,
                body: chapterRequest.body,
                contentType: chapterRequest.contentType,
              },
        isVolume: parseRuleBoolean(
          readOptionalSourceRuleValue(
            undefined,
            undefined,
            item,
            rule.isVolume,
            page.finalUrl,
          ),
        ),
        isVip: parseRuleBoolean(
          readOptionalSourceRuleValue(
            undefined,
            undefined,
            item,
            rule.isVip,
            page.finalUrl,
          ),
        ),
        isPay: rule.isPay
          ? parseRuleBoolean(
              readOptionalSourceRuleValue(
                undefined,
                undefined,
                item,
                rule.isPay,
                page.finalUrl,
              ),
            )
          : true,
        tag: readOptionalSourceRuleValue(
          undefined,
          undefined,
          item,
          rule.updateTime,
          page.finalUrl,
        ),
      }
    })
    .filter(Boolean)

  const nextTocUrl = resolveOptionalHttpUrl(
    readOptionalCriticalSourceRuleValue(
      undefined,
      undefined,
      jsonData,
      rule.nextTocUrl,
      page.finalUrl,
      '目录下一页',
    ),
    page.finalUrl,
  )
  return { chapters, nextTocUrl }
}

const extractQidianPageData = text => {
  for (const match of String(text ?? '').matchAll(
    /<script[^>]*>\s*(\{"pageContext"[\s\S]*?)<\/script>/g,
  )) {
    try {
      const parsed = JSON.parse(match[1])
      const pageData = parsed?.pageContext?.pageProps?.pageData
      if (isRecord(pageData)) return pageData
    } catch {
      // Continue scanning other scripts.
    }
  }
  return undefined
}

const getQidianBookId = (...values) => {
  for (const value of values) {
    const text = String(value ?? '')
    const id =
      text.match(/(?:bookId=|\/book\/|\/chapter\/)(\d{4,})/)?.[1] ??
      (text.match(/^\d{4,}$/)?.[0] ?? '')
    if (id) return id
  }
  return ''
}

const isQidianSourceContext = (source, book, tocUrl) =>
  [source.bookSourceUrl, source.bookSourceName, book.bookUrl, tocUrl].some(
    value => /qidian\.com|起点/i.test(String(value ?? '')),
  )

const parseQidianMobileCatalogPage = (book, page, bookId) => {
  const pageData = extractQidianPageData(page.text)
  const volumes = Array.isArray(pageData?.vs) ? pageData.vs : []
  const chapters = []
  const seen = new Set()

  for (const volume of volumes) {
    const items = Array.isArray(volume?.cs) ? volume.cs : []
    for (const item of items) {
      const chapterId = normalizeRuleText(item?.id)
      const title = normalizeRuleText(item?.cN)
      if (!chapterId || !title || seen.has(chapterId)) continue
      seen.add(chapterId)
      const isVip = !(item?.sS === 1 || item?.sS === '1')
      chapters.push(
        buildSourceChapterRecord({
          bookUrl: book.bookUrl,
          title,
          chapterUrl: `https://m.qidian.com/chapter/${bookId}/${chapterId}/`,
          tocUrl: page.finalUrl,
          index: chapters.length,
          isVolume: false,
          isVip,
          isPay: !isVip,
          tag: [item?.uT, item?.cnt ? `${item.cnt}字` : '']
            .map(normalizeRuleText)
            .filter(Boolean)
            .join('  '),
        }),
      )
    }
  }

  if (chapters.length === 0) {
    throw new Error('起点移动目录页面没有解析出章节')
  }
  return chapters
}

const parseQidianMobileCatalog = async (source, book, tocUrl) => {
  const bookId = getQidianBookId(book.kind, book.bookUrl, book.tocUrl, tocUrl)
  if (!bookId || !isQidianSourceContext(source, book, tocUrl)) return undefined
  const page = await fetchSourcePageText(
    source,
    `https://m.qidian.com/book/${bookId}/catalog/`,
    '起点移动目录地址',
  )
  return parseQidianMobileCatalogPage(book, page, bookId)
}

const isSupportedJsonTocJsRule = rule =>
  readStaticJsChapterName(rule, { serialName: 'x' }) !== '' ||
  (/^@js:/i.test(String(rule ?? '')) &&
    String(rule ?? '').includes('ContentAnchorBatch') &&
    String(rule ?? '').includes('ChapterSeqNo'))

const assertSupportedTocRule = (rule, label) => {
  if (!isComplexLegadoRule(rule)) return
  if (isSupportedJsonTocJsRule(rule)) return
  assertSupportedRule(rule, label)
}

const parseSourceTocPage = (source, page, context) => {
  const rule = source.ruleToc ?? {}
  if (!rule.chapterList?.trim()) throw new Error('书源未配置目录列表规则')
  if (!rule.chapterName?.trim()) throw new Error('书源未配置章节名称规则')
  if (!rule.chapterUrl?.trim()) throw new Error('书源未配置章节地址规则')
  assertSupportedRule(rule.chapterList, '目录解析')
  assertSupportedTocRule(rule.chapterName, '目录解析')
  assertSupportedTocRule(rule.chapterUrl, '目录解析')

  const jsonData = shouldParseSearchResponseAsJson(rule.chapterList, page.text)
    ? parseJsonSearchResponse(page.text)
    : undefined
  return jsonData === undefined
    ? parseHtmlSourceTocPage(source, page)
    : parseJsonSourceTocPage(source, page, jsonData, context)
}

const parseSourceBookChapters = async (source, book, tocUrl) => {
  const qidianChapters = await parseQidianMobileCatalog(
    source,
    book,
    tocUrl,
  ).catch(() => undefined)
  if (qidianChapters !== undefined) return qidianChapters

  const chapters = []
  const seenChapterUrls = new Set()
  const seenTocUrls = new Set()
  let nextTocUrl = tocUrl
  let pageIndex = 0

  while (nextTocUrl) {
    const nextTocKey = normalizeComparableHttpUrl(nextTocUrl)
    if (seenTocUrls.has(nextTocKey)) {
      throw new Error(`目录下一页出现循环：${nextTocUrl}`)
    }
    if (pageIndex >= SOURCE_TOC_PAGE_LIMIT) {
      throw new Error(
        `目录分页超过 ${SOURCE_TOC_PAGE_LIMIT} 页，已停止，未写入书架`,
      )
    }
    seenTocUrls.add(nextTocKey)

    const page = await fetchSourcePageText(source, nextTocUrl, '目录地址')
    let parsed
    try {
      parsed = parseSourceTocPage(source, page, {
        book,
        bookSourceUrl: source.bookSourceUrl,
      })
    } catch (error) {
      throw wrapSourcePageParseError(source, page, '目录', error)
    }
    for (const chapter of parsed.chapters) {
      const chapterKey = `${chapter.chapterUrl}\u0000${
        chapter.contentRequest?.body ?? ''
      }`
      if (seenChapterUrls.has(chapterKey)) continue
      if (chapters.length >= SOURCE_CHAPTER_LIMIT) {
        throw new Error(
          `目录章节数超过 ${SOURCE_CHAPTER_LIMIT} 章，已停止，未写入书架`,
        )
      }
      seenChapterUrls.add(chapterKey)
      chapters.push(
        buildSourceChapterRecord({
          ...chapter,
          bookUrl: book.bookUrl,
          tocUrl: page.finalUrl,
          index: chapters.length,
        }),
      )
    }
    nextTocUrl = parsed.nextTocUrl
    pageIndex += 1
  }

  if (chapters.length === 0) throw new Error('目录规则没有解析出章节')
  return chapters
}

const buildSourceShelfBook = (source, searchBook, info, chapters) => {
  const now = Date.now()
  const firstChapterTitle = chapters[0]?.title ?? '正文'
  const latestChapterTitle =
    info.latestChapterTitle ??
    searchBook.latestChapterTitle ??
    chapters.at(-1)?.title ??
    firstChapterTitle

  return {
    name: info.name || searchBook.name,
    author: info.author || searchBook.author || '作者未知',
    bookUrl: searchBook.bookUrl,
    kind: info.kind || searchBook.kind || undefined,
    wordCount: info.wordCount || searchBook.wordCount || undefined,
    tocUrl: info.tocUrl,
    origin: source.bookSourceUrl,
    originName: source.bookSourceName,
    coverUrl: info.coverUrl || searchBook.coverUrl || undefined,
    intro: info.intro || searchBook.intro || undefined,
    type: source.bookSourceType ?? searchBook.type ?? 0,
    group: 0,
    latestChapterTitle,
    latestChapterTime: now,
    lastCheckTime: now,
    lastCheckCount: 0,
    totalChapterNum: chapters.length,
    durChapterTitle: firstChapterTitle,
    durChapterIndex: 0,
    durChapterPos: 0,
    durChapterTime: now,
    canUpdate: true,
    order: now,
    originOrder: source.customOrder ?? searchBook.originOrder ?? 0,
    syncTime: now,
  }
}

const parseSourceSearchBookForShelf = async searchBook => {
  const source = await findBookSourceForSearchBook(searchBook)
  const detailPage = await fetchSourcePageText(
    source,
    searchBook.bookUrl,
    '书籍详情地址',
  )
  let info
  try {
    info = parseSourceBookInfo(source, searchBook, detailPage)
  } catch (error) {
    throw wrapSourcePageParseError(source, detailPage, '详情', error)
  }
  const chapters = await parseSourceBookChapters(
    source,
    { ...searchBook, ...info, bookUrl: searchBook.bookUrl },
    info.tocUrl,
  )
  return { source, info, chapters }
}

const previewChapterRecord = chapter => ({
  index: chapter.index,
  title: chapter.title,
  url: chapter.url,
  isVolume: chapter.isVolume,
  isVip: chapter.isVip,
  isPay: chapter.isPay,
  tag: chapter.tag,
})

const SOURCE_PREVIEW_CHAPTER_LIMIT = 80

const previewSourceBook = async payload => {
  const searchBook = requireSourceSearchBook(payload)
  const existingBook = await getBook(searchBook.bookUrl)
  if (existingBook !== undefined) {
    const chapters = await getChapters(searchBook.bookUrl)
    return {
      book: existingBook,
      chapterCount: chapters.length,
      chapters: chapters.slice(0, SOURCE_PREVIEW_CHAPTER_LIMIT).map(previewChapterRecord),
      alreadyOnShelf: true,
      notes: ['该书已在书架，预览展示已保存目录'],
    }
  }

  const { source, info, chapters } = await parseSourceSearchBookForShelf(
    searchBook,
  )
  return {
    book: buildSourceShelfBook(source, searchBook, info, chapters),
    chapterCount: chapters.length,
    chapters: chapters.slice(0, SOURCE_PREVIEW_CHAPTER_LIMIT).map(previewChapterRecord),
    alreadyOnShelf: false,
    notes: sourceRuntimeNotes(source),
  }
}

const importSourceBook = async payload => {
  const searchBook = requireSourceSearchBook(payload)
  const existingBook = await getBook(searchBook.bookUrl)
  if (existingBook !== undefined) {
    return {
      book: existingBook,
      chapterCount: existingBook.totalChapterNum ?? 0,
      alreadyOnShelf: true,
    }
  }

  const { source, info, chapters } = await parseSourceSearchBookForShelf(
    searchBook,
  )
  const book = buildSourceShelfBook(source, searchBook, info, chapters)
  await saveBookWithChapters(book, chapters)
  return { book, chapterCount: chapters.length, alreadyOnShelf: false }
}

const CONTENT_TAG_ALLOWLIST = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
])
const CONTENT_ATTR_ALLOWLIST = {
  a: new Set(['href', 'title']),
  img: new Set(['alt', 'src', 'title']),
}

const resolvedSafeContentUrl = (value, baseUrl) => {
  const resolved = resolveHttpUrl(value, baseUrl)
  if (!resolved) return ''
  try {
    const url = new URL(resolved)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : ''
  } catch {
    return ''
  }
}

const sanitizeContentHtml = (html, baseUrl) => {
  const $ = cheerio.load(`<main id="legado-content-root">${html}</main>`)
  const root = $('#legado-content-root')
  root
    .find(
      'script,style,iframe,object,embed,form,input,button,textarea,select,link,meta',
    )
    .remove()
  root.find('*').each((_, node) => {
    const tagName = String(node.name ?? '').toLocaleLowerCase()
    if (!CONTENT_TAG_ALLOWLIST.has(tagName)) {
      $(node).replaceWith($(node).contents())
      return
    }
    const allowedAttributes = CONTENT_ATTR_ALLOWLIST[tagName] ?? new Set()
    Object.keys(node.attribs ?? {}).forEach(attribute => {
      const lowerAttribute = attribute.toLocaleLowerCase()
      const value = node.attribs[attribute]
      if (lowerAttribute.startsWith('on') || !allowedAttributes.has(lowerAttribute)) {
        $(node).removeAttr(attribute)
        return
      }
      if (lowerAttribute !== 'src' && lowerAttribute !== 'href') return
      const resolved = resolvedSafeContentUrl(value, baseUrl)
      if (resolved) $(node).attr(attribute, resolved)
      else $(node).removeAttr(attribute)
    })
    if (tagName === 'a' && $(node).attr('href')) {
      $(node).attr('target', '_blank')
      $(node).attr('rel', 'noopener noreferrer')
    }
  })
  return root.html()?.trim() ?? ''
}

const normalizeChapterContent = (content, baseUrl) => {
  const text = normalizeText(String(content ?? ''))
  if (!/<\/?[a-z][\s\S]*>/i.test(text)) {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
  }
  return sanitizeContentHtml(text, baseUrl).replace(/\r\n?/g, '\n').trim()
}

const applyContentReplaceRegex = (content, replaceRegex) => {
  const trimmed = replaceRegex?.trim()
  if (!trimmed) return content
  return trimmed
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(Boolean)
    .reduce((text, item) => {
      const [pattern, replacement = ''] = item.split('##')
      return pattern.trim()
        ? replaceRuleText(text, pattern.trim(), replacement)
        : text
    }, content)
}

const BLOCK_CONTENT_SELECTOR = [
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
].join(',')

const structuredElementText = ($, target) => {
  const clone = target.clone()
  clone
    .find(
      'script,style,iframe,object,embed,form,input,button,textarea,select,link,meta',
    )
    .remove()
  clone.find('br').replaceWith('\n')
  clone.find(BLOCK_CONTENT_SELECTOR).each((_, node) => {
    $(node).before('\n')
    $(node).after('\n')
  })
  return clone
    .text()
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
}

const textNodesText = ($, target) =>
  target
    .contents()
    .toArray()
    .filter(node => node.type === 'text')
    .map(node => $(node).text().replace(/\u00a0/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

const readSingleContentRuleValue = ($, scope, rule, baseUrl) => {
  const parsedRule = parseRule(rule)
  if (parsedRule === undefined) return ''

  const target =
    parsedRule.selectors.length === 0
      ? scope
      : selectRuleTargets($, scope.get(0), parsedRule.selectors)
  if (target === undefined || target.length === 0) return ''

  const attribute = parsedRule.attribute.toLocaleLowerCase()
  if (attribute === 'text') {
    return applyRuleReplacements(
      structuredElementText($, target),
      parsedRule.replacements,
    )
  }
  if (attribute === 'textnodes') {
    return applyRuleReplacements(
      textNodesText($, target),
      parsedRule.replacements,
    )
  }
  if (attribute === 'html') {
    return applyRuleReplacements(
      target
        .toArray()
        .map(node => $(node).html()?.trim() ?? '')
        .filter(Boolean)
        .join('\n'),
      parsedRule.replacements,
    )
  }

  const attrValue = target.attr(parsedRule.attribute)?.trim() ?? ''
  if (!attrValue) return ''
  if (attribute === 'href' || attribute === 'src') {
    return applyRuleReplacements(
      new URL(attrValue, baseUrl).toString(),
      parsedRule.replacements,
    )
  }
  return applyRuleReplacements(attrValue, parsedRule.replacements)
}

const readContentRuleValue = ($, scope, rule, baseUrl) => {
  const trimmed = rule?.trim()
  if (!trimmed) return ''

  const [ruleBody, ...replacements] = trimmed.split('##')
  for (const alternative of splitRuleAlternatives(ruleBody)) {
    const value = splitRuleConjunctions(alternative)
      .map(part => readSingleContentRuleValue($, scope, part, baseUrl))
      .filter(Boolean)
      .join('\n')
    const normalizedValue = applyRuleReplacements(
      value.trim(),
      replacements.filter(Boolean),
    )
    if (normalizedValue) return normalizedValue
  }
  return ''
}

const readRequiredContentRuleValue = ($, scope, jsonData, rule, baseUrl) => {
  assertSupportedRule(rule, '正文解析')
  if (jsonData !== undefined && !isJsonReadableRule(rule)) {
    throw new Error(
      `规则「${rule}」解析失败：JSON 页面规则必须使用 JSONPath、JSON accessor 或模板`,
    )
  }
  return (
    jsonData !== undefined && isJsonReadableRule(rule)
      ? readJsonRuleValue(jsonData, rule)
      : readContentRuleValue($, scope, rule, baseUrl)
  ).trim()
}

const readQidianMobileChapterContent = page => {
  let hostname = ''
  try {
    hostname = new URL(page.finalUrl).hostname
  } catch {
    return ''
  }
  if (hostname !== 'm.qidian.com') return ''

  const pageData = extractQidianPageData(page.text)
  const content = pageData?.chapterInfo?.content
  return typeof content === 'string' ? content : ''
}

const parseSourceContentPage = async (source, page) => {
  const rule = source.ruleContent ?? {}
  if (!rule.content?.trim()) throw new Error('书源未配置正文规则')

  const qidianMobileContent = readQidianMobileChapterContent(page)
  if (qidianMobileContent) {
    return {
      content: normalizeChapterContent(qidianMobileContent, page.finalUrl),
      nextContentUrl: '',
    }
  }

  const jsonData = tryParseJsonPage(page.text, [rule.content])
  const $ = cheerio.load(page.text)
  const rawContent = readRequiredContentRuleValue(
    $,
    $.root(),
    jsonData,
    rule.content,
    page.finalUrl,
  )
  const replacedContent = applyContentReplaceRegex(
    rawContent,
    rule.replaceRegex,
  )
  let content = normalizeChapterContent(replacedContent, page.finalUrl)
  if (!content || isPlaceholderChapterContent(content)) {
    const dynamicRequest = findStaticJqueryContentRequest(
      page.text,
      page.finalUrl,
    )
    if (dynamicRequest === undefined && content) {
      throw new Error(
        '正文规则只解析出加载占位内容，未识别可静态解析的动态正文接口',
      )
    }
    if (dynamicRequest !== undefined) {
      const dynamicContent = await fetchStaticJqueryContent(
        source,
        page,
        dynamicRequest,
      )
      if (!dynamicContent) {
        throw new Error('正文动态接口没有返回可用内容')
      }
      content = normalizeChapterContent(
        applyContentReplaceRegex(dynamicContent, rule.replaceRegex),
        page.finalUrl,
      )
    }
  }
  if (!content) throw new Error('正文规则没有解析出内容')
  if (isPlaceholderChapterContent(content)) {
    throw new Error('正文规则只解析出加载占位内容，当前不执行页面 JS')
  }

  const nextContentUrl = resolveOptionalHttpUrl(
    readOptionalCriticalSourceRuleValue(
      $,
      $.root(),
      jsonData,
      rule.nextContentUrl,
      page.finalUrl,
      '正文下一页',
    ),
    page.finalUrl,
  )
  return { content, nextContentUrl }
}

const parseSourceChapterContent = async (book, chapter) => {
  const source = await findBookSourceForBook(book)
  const nextChapterUrl = (
    await getChapterRecord(book.bookUrl, chapter.index + 1)
  )?.url
  const contents = []
  const seenUrls = new Set()
  let nextUrl = chapter.url
  let pageIndex = 0
  let contentBytes = 0

  while (nextUrl) {
    const nextUrlKey = normalizeComparableHttpUrl(nextUrl)
    if (seenUrls.has(nextUrlKey)) {
      throw new Error(`正文下一页出现循环：${nextUrl}`)
    }
    if (pageIndex >= SOURCE_CONTENT_PAGE_LIMIT) {
      throw new Error(
        `章节正文分页超过 ${SOURCE_CONTENT_PAGE_LIMIT} 页，未缓存不完整正文`,
      )
    }
    seenUrls.add(nextUrlKey)
    const page = await fetchSourcePageText(
      source,
      nextUrl,
      '章节地址',
      chapter.contentRequest,
    )
    let parsed
    try {
      parsed = await parseSourceContentPage(source, page)
    } catch (error) {
      throw wrapSourcePageParseError(source, page, '正文', error)
    }
    contentBytes += Buffer.byteLength(parsed.content, 'utf8')
    if (contentBytes > SOURCE_CHAPTER_CONTENT_MAX_BYTES) {
      throw new Error(
        `章节正文超过 ${SOURCE_CHAPTER_CONTENT_MAX_BYTES} 字节，未缓存异常正文`,
      )
    }
    contents.push(parsed.content)
    nextUrl =
      parsed.nextContentUrl &&
      !sourcePageUrlEquals(parsed.nextContentUrl, nextChapterUrl)
        ? parsed.nextContentUrl
        : ''
    pageIndex += 1
  }

  if (contents.length === 0) throw new Error('正文规则没有解析出内容')
  return normalizeText(contents.join('\n\n'))
}

const fetchSubscriptionJson = async rawUrl => {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    url = undefined
  }
  const headers = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  }
  if (url?.hostname === YIOVE_API_HOSTNAME) {
    headers.Origin = YIOVE_SITE_ORIGIN
    headers.Referer = `${YIOVE_SITE_ORIGIN}/`
  }

  const { content } = await requestBytes(rawUrl, {
    headers,
    timeout: SUBSCRIPTION_TIMEOUT_MS,
    limit: MAX_SUBSCRIPTION_BYTES,
    urlLabel: '订阅地址',
  })
  JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''))
  return content
}

const handleApi = async (req, res, url) => {
  if (req.method === 'OPTIONS') {
    try {
      assertSameOriginApiRequest(req, url)
      send(res, 204, '')
    } catch (error) {
      sendApiError(
        res,
        error instanceof ApiError ? error.status : 403,
        error instanceof Error ? error.message : String(error),
        error instanceof ApiError ? error.errorCode : undefined,
      )
    }
    return true
  }

  if (url.pathname === '/api/source-subscription' && req.method === 'GET') {
    try {
      assertSameOriginApiRequest(req, url)
      const rawUrl = url.searchParams.get('url') ?? ''
      const content = await fetchSubscriptionJson(rawUrl)
      send(res, 200, content, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      })
    } catch (error) {
      sendApiError(
        res,
        error instanceof ApiError ? error.status : 400,
        error instanceof Error ? error.message : String(error),
        error instanceof ApiError ? error.errorCode : undefined,
      )
    }
    return true
  }

  if (url.pathname === '/api/source-fetch' && req.method === 'POST') {
    try {
      assertSameOriginApiRequest(req, url)
      sendApiOk(res, await fetchSourceText(await readJsonBody(req)))
    } catch (error) {
      sendApiError(
        res,
        error instanceof ApiError ? error.status : 400,
        error instanceof Error ? error.message : String(error),
        error instanceof ApiError ? error.errorCode : undefined,
      )
    }
    return true
  }

  if (!url.pathname.startsWith('/api/')) return false

  try {
    assertSameOriginApiRequest(req, url)
    try {
      await ensureDatabase()
    } catch (error) {
      sendApiError(
        res,
        500,
        `PostgreSQL persistence unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'DATABASE_UNAVAILABLE',
      )
      return true
    }

    if (url.pathname === '/api/health' && req.method === 'GET') {
      const result = await query('SELECT 1 AS ok')
      sendApiOk(res, { database: result.rows[0]?.ok === 1 ? 'ok' : 'unknown' })
      return true
    }

    if (url.pathname === '/api/read-config' && req.method === 'GET') {
      sendApiOk(res, await getReadConfig())
      return true
    }

    if (url.pathname === '/api/read-config' && req.method === 'PUT') {
      const config = await readJsonBody(req)
      if (!isRecord(config)) throw badRequest('阅读配置必须是对象')
      await saveReadConfig(config)
      sendApiOk(res, '阅读配置已保存到 PG')
      return true
    }

    if (url.pathname === '/api/book-source-search' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (!isRecord(body) || typeof body.keyword !== 'string') {
        throw badRequest('搜索请求缺少 keyword')
      }
      sendApiOk(
        res,
        await searchBookSources(
          body.keyword,
          isRecord(body.sourceFilter) ? body.sourceFilter : {},
        ),
      )
      return true
    }

    if (url.pathname === '/api/books/import-source' && req.method === 'POST') {
      sendApiOk(res, await importSourceBook(await readJsonBody(req)))
      return true
    }

    if (url.pathname === '/api/books/preview-source' && req.method === 'POST') {
      sendApiOk(res, await previewSourceBook(await readJsonBody(req)))
      return true
    }

    if (url.pathname === '/api/sources' && req.method === 'GET') {
      sendApiOk(res, await getSources(requireKind(url)))
      return true
    }

    if (url.pathname === '/api/sources' && req.method === 'PUT') {
      sendApiOk(
        res,
        await replaceSources(requireKind(url), await readJsonBody(req)),
      )
      return true
    }

    if (url.pathname === '/api/source' && req.method === 'POST') {
      await upsertSource(requireKind(url), await readJsonBody(req))
      sendApiOk(res, '源已保存到 PG')
      return true
    }

    if (url.pathname === '/api/sources' && req.method === 'DELETE') {
      const kind = requireKind(url)
      await deleteSources(kind, await readJsonBody(req))
      sendApiOk(res, '源已从 PG 删除')
      return true
    }

    if (url.pathname === '/api/books' && req.method === 'GET') {
      sendApiOk(res, await getBooks())
      return true
    }

    if (url.pathname === '/api/books/import-text' && req.method === 'POST') {
      const file = await readJsonBody(req)
      if (
        !isRecord(file) ||
        typeof file.name !== 'string' ||
        typeof file.text !== 'string'
      ) {
        throw badRequest('导入 TXT 请求缺少 name/text')
      }
      const fileName = requireNonEmptyString(file.name, 'TXT 文件名')
      const fileText = requireNonEmptyString(file.text, 'TXT 内容')
      if (fileName.length > 255) {
        throw badRequest('TXT 文件名不能超过 255 个字符')
      }
      if (
        !fileName.toLocaleLowerCase().endsWith('.txt') &&
        file.type !== 'text/plain'
      ) {
        throw badRequest('当前纯 Web 版本仅支持导入 TXT 文本书籍')
      }
      const chapters = parseTextChapters(fileText)
      const book = buildBook(
        {
          name: fileName,
          size: Number(file.size) || Buffer.byteLength(fileText),
          lastModified: Number(file.lastModified) || Date.now(),
        },
        chapters,
      )
      const records = chapters.map((chapter, index) =>
        chapterToRecord(book.bookUrl, chapter, index),
      )
      await saveBookWithChapters(book, records)
      sendApiOk(res, book)
      return true
    }

    if (url.pathname === '/api/book-progress' && req.method === 'POST') {
      sendApiOk(res, await saveBookProgress(await readJsonBody(req)))
      return true
    }

    if (url.pathname === '/api/chapters' && req.method === 'GET') {
      const bookUrl = requireQueryParam(url, 'bookUrl', '书籍地址')
      const chapters = await getChapters(bookUrl)
      if (chapters.length === 0)
        sendApiError(res, 404, '这本书还没有章节，请重新导入')
      else sendApiOk(res, chapters)
      return true
    }

    if (url.pathname === '/api/chapter-content' && req.method === 'GET') {
      const bookUrl = requireQueryParam(url, 'bookUrl', '书籍地址')
      const index = requireNonNegativeIntegerParam(url, 'index', '章节序号')
      const content = await getChapterContent(bookUrl, index)
      if (content === undefined) sendApiError(res, 404, '章节不存在或已被删除')
      else sendApiOk(res, content)
      return true
    }

    if (url.pathname === '/api/book' && req.method === 'DELETE') {
      const bookUrl = requireQueryParam(url, 'bookUrl', '书籍地址')
      await query(`DELETE FROM ${SCHEMA}.books WHERE book_url = $1`, [bookUrl])
      sendApiOk(res, '书籍已从 PG 删除')
      return true
    }

    if (url.pathname === '/api/backup' && req.method === 'GET') {
      sendApiOk(res, await exportBackup())
      return true
    }

    if (url.pathname === '/api/backup' && req.method === 'PUT') {
      await importBackup(await readJsonBody(req))
      sendApiOk(res, 'PG 数据已从备份导入')
      return true
    }

    if (url.pathname === '/api/standalone' && req.method === 'DELETE') {
      await clearData()
      sendApiOk(res, 'PG 数据已清空')
      return true
    }

    sendApiError(res, 404, 'API 不存在')
  } catch (error) {
    sendApiError(
      res,
      error instanceof ApiError ? error.status : 500,
      error instanceof Error ? error.message : String(error),
      error instanceof ApiError ? error.errorCode : undefined,
    )
  }
  return true
}

const etag = buffer =>
  `"${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)}"`

const serveStatic = async (req, res, url) => {
  let decodedPath
  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    send(res, 400, 'Bad Request', {
      'Content-Type': 'text/plain; charset=utf-8',
    })
    return
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1)
  let filePath = path.resolve(staticDir, relativePath)
  const relativeToStaticDir = path.relative(staticDir, filePath)
  if (
    relativeToStaticDir.startsWith('..') ||
    path.isAbsolute(relativeToStaticDir)
  ) {
    send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' })
    return
  }

  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    if (path.extname(relativePath) === '')
      filePath = path.join(staticDir, 'index.html')
    else {
      send(res, 404, 'Not Found', {
        'Content-Type': 'text/plain; charset=utf-8',
      })
      return
    }
  }

  try {
    const buffer = await fs.readFile(filePath)
    const contentType =
      mimeTypes.get(path.extname(filePath)) ?? 'application/octet-stream'
    const tag = etag(buffer)
    if (req.headers['if-none-match'] === tag) {
      send(res, 304, '', { ETag: tag })
      return
    }
    send(res, 200, buffer, {
      'Content-Type': contentType,
      ETag: tag,
      'Cache-Control':
        relativePath.startsWith('assets/') && !filePath.endsWith('.html')
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
    })
  } catch {
    send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' })
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(
      req.url ?? '/',
      `http://${req.headers.host ?? 'localhost'}`,
    )
    if (await handleApi(req, res, url)) return
    await serveStatic(req, res, url)
  } catch (error) {
    if (!res.headersSent) {
      send(res, 500, 'Internal Server Error', {
        'Content-Type': 'text/plain; charset=utf-8',
      })
    }
    console.error(error)
  }
})

server.listen(args.port, args.host, async () => {
  try {
    await ensureDatabase()
    console.log(
      `PostgreSQL persistence ready: ${args.databaseUrl.replace(/:[^:@/]+@/, ':***@')}`,
    )
  } catch (error) {
    console.error(
      `PostgreSQL persistence unavailable: ${error instanceof Error ? error.message : error}`,
    )
  }
  console.log(`Serving ${staticDir} on http://${args.host}:${args.port}`)
})

const shutdown = async () => {
  server.close()
  await pool.end().catch(() => undefined)
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
