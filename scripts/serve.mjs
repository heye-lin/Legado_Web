#!/usr/bin/env node
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import ipaddr from 'node:net'
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
const FORBIDDEN_PROXY_HEADER_PREFIXES = ['proxy-', 'sec-']
const SOURCE_SEARCH_CONCURRENCY = 8
const SOURCE_SEARCH_TIMEOUT_MS = 6_000
const SOURCE_SEARCH_RESULT_LIMIT = 50
const SEARCH_KEY_TOKENS = ['{{key}}', '{{keyword}}', '{{searchKey}}']
const COMPLEX_LEGADO_RULE_PATTERN =
  /(^\s*(js:|@js:|xpath:|json:|regex:)|@js\b|<js>|&&|\|\|)/i
const SELECTOR_INDEX_PATTERN = /^(.*)\.(-?\d+)(?::(-?\d+))?$/
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
const fail = message => ({ isSuccess: false, errorMsg: message, data: null })
const clone = value => JSON.parse(JSON.stringify(value))

const parseArgs = argv => {
  const args = {
    host: '0.0.0.0',
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
const sendApiError = (res, status, message) =>
  sendJson(res, status, fail(message))

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
  return JSON.parse(body.toString('utf8'))
}

const isRecord = value =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireKind = url => {
  const kind = url.searchParams.get('kind') ?? ''
  if (kind !== 'bookSource' && kind !== 'rssSource') {
    throw new Error('kind 必须是 bookSource 或 rssSource')
  }
  return kind
}

const sourceKey = (kind, source) => {
  if (!isRecord(source)) throw new Error('源必须是对象')
  const key = kind === 'bookSource' ? source.bookSourceUrl : source.sourceUrl
  const name = kind === 'bookSource' ? source.bookSourceName : source.sourceName
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error(
      kind === 'bookSource' ? '书源缺少 bookSourceUrl' : '订阅源缺少 sourceUrl',
    )
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(
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
    `SELECT data FROM ${SCHEMA}.books ORDER BY COALESCE((data->>'durChapterTime')::bigint, 0) DESC`,
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

const getChapterContent = async (bookUrl, index) => {
  const result = await query(
    `SELECT content FROM ${SCHEMA}.chapters WHERE book_url = $1 AND chapter_index = $2`,
    [bookUrl, index],
  )
  return result.rows[0]?.content
}

const sameBook = (book, progress) =>
  progress.bookUrl?.length > 0
    ? book.bookUrl === progress.bookUrl
    : book.name === progress.name && book.author === progress.author

const saveBookProgress = async progress => {
  const book =
    progress.bookUrl?.length > 0
      ? await getBook(progress.bookUrl)
      : (await getBooks()).find(item => sameBook(item, progress))
  if (book === undefined) return '没有需要保存的 PG 进度'

  const updated = { ...book, ...progress, syncTime: Date.now() }
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
    `SELECT data FROM ${SCHEMA}.chapters ORDER BY book_url, chapter_index`,
  )
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    readConfig,
    bookSources,
    rssSources,
    books,
    chapters: chapterResult.rows.map(row => row.data),
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
  await query(`DELETE FROM ${SCHEMA}.chapters`)
  await query(`DELETE FROM ${SCHEMA}.books`)
  await query(`DELETE FROM ${SCHEMA}.sources`)
  await query(`DELETE FROM ${SCHEMA}.app_state`)
}

const isPrivateIp = ip => {
  if (ipaddr.isIPv4(ip)) {
    const parts = ip.split('.').map(Number)
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    )
  }
  if (ipaddr.isIPv6(ip)) {
    return (
      ip === '::1' ||
      ip.toLowerCase().startsWith('fc') ||
      ip.toLowerCase().startsWith('fd') ||
      ip.toLowerCase().startsWith('fe80:')
    )
  }
  return true
}

const validatePublicUrl = async rawUrl => {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('订阅地址必须是 http/https URL')
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true })
  if (
    addresses.length === 0 ||
    addresses.some(address => isPrivateIp(address.address))
  ) {
    throw new Error('订阅地址域名不是公网地址')
  }
  return parsed
}

const isForbiddenProxyHeader = name => {
  const lowerName = name.toLocaleLowerCase()
  return (
    FORBIDDEN_PROXY_HEADER_NAMES.has(lowerName) ||
    FORBIDDEN_PROXY_HEADER_PREFIXES.some(prefix => lowerName.startsWith(prefix))
  )
}

const normalizeProxyHeaders = headers => {
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
      isForbiddenProxyHeader(normalizedKey)
    ) {
      return
    }
    result[normalizedKey] = value
  })
  return result
}

const decodeResponseContent = (content, contentEncoding, limit) => {
  const encoding = String(contentEncoding ?? '').toLocaleLowerCase()
  let decoded = content

  if (
    encoding.includes('gzip') ||
    (content[0] === GZIP_MAGIC_0 && content[1] === GZIP_MAGIC_1)
  ) {
    decoded = zlib.gunzipSync(content)
  } else if (encoding.includes('br')) {
    decoded = zlib.brotliDecompressSync(content)
  } else if (encoding.includes('deflate')) {
    decoded = zlib.inflateSync(content)
  }

  if (decoded.byteLength > limit) {
    throw new Error('远程内容解压后超过大小限制')
  }
  return decoded
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
  } = {},
) => {
  const url = await validatePublicUrl(rawUrl)
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(
      url,
      { method, headers, timeout },
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
            resolve(
              await requestBytes(nextUrl, {
                method,
                headers,
                body,
                timeout,
                limit,
                redirect: redirect + 1,
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
    if (typeof body === 'string' && body.length > 0) request.write(body)
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
  const { finalUrl, content } = await requestBytes(requestBody.url, {
    method,
    headers: normalizeProxyHeaders(requestBody.headers),
    body: typeof requestBody.body === 'string' ? requestBody.body : undefined,
  })
  return { finalUrl, text: content.toString('utf8') }
}

const unique = values => Array.from(new Set(values))

const sourceSearchReport = (source, status, message, count = 0) => ({
  sourceName: source.bookSourceName,
  sourceUrl: source.bookSourceUrl,
  status,
  count,
  message,
})

const normalizeHeaderToken = value =>
  value
    .trim()
    .replace(/,$/, '')
    .replace(/^['"]|['"]$/g, '')
    .trim()

const parseSourceHeaders = rawHeader => {
  const headers = {}
  const warnings = []
  const trimmed = rawHeader?.trim()
  if (!trimmed) return { headers, warnings }

  const appendHeader = (rawKey, rawValue) => {
    const key = normalizeHeaderToken(rawKey)
    const value = normalizeHeaderToken(rawValue)
    if (!key || !value) return
    if (isForbiddenProxyHeader(key)) {
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

const fillSearchKey = (template, searchKey) => {
  const encodedKey = encodeURIComponent(searchKey)
  const withSearchKey = SEARCH_KEY_TOKENS.reduce(
    (text, token) => text.split(token).join(encodedKey),
    template,
  )
  return withSearchKey
    .replace(/\{\{\s*\(?\s*page\s*-\s*1\s*\)?\s*\*\s*\d+\s*\}\}/g, '0')
    .split('{{page}}')
    .join('1')
}

const splitSearchUrl = searchUrl => {
  const trimmed = searchUrl.trim()
  const configMatch = trimmed.match(/,\s*\{[\s\S]*\}\s*$/)
  const inlineConfig =
    configMatch === null
      ? {}
      : JSON.parse(trimmed.slice(configMatch.index + 1).trim())
  const urlAndBody =
    configMatch === null ? trimmed : trimmed.slice(0, configMatch.index).trim()
  const bodySeparatorIndex = urlAndBody.indexOf('@')
  if (bodySeparatorIndex === -1) {
    return { url: urlAndBody, body: inlineConfig.body, config: inlineConfig }
  }
  return {
    url: urlAndBody.slice(0, bodySeparatorIndex),
    body: urlAndBody.slice(bodySeparatorIndex + 1),
    config: inlineConfig,
  }
}

const buildSourceSearchRequest = (source, searchKey) => {
  const searchUrl = source.searchUrl?.trim()
  if (!searchUrl) throw new Error('未配置搜索地址')

  const { url, body, config } = splitSearchUrl(searchUrl)
  const requestUrl = new URL(
    fillSearchKey(url, searchKey),
    source.bookSourceUrl,
  ).toString()
  const { headers, warnings } = parseSourceHeaders(source.header)
  if (isRecord(config.headers)) {
    Object.entries(config.headers).forEach(([key, value]) => {
      const normalizedKey = normalizeHeaderToken(key)
      if (
        typeof value === 'string' &&
        normalizedKey &&
        !isForbiddenProxyHeader(normalizedKey)
      ) {
        headers[normalizedKey] = value
      }
    })
  }
  const method =
    typeof config.method === 'string' ? config.method.toUpperCase() : undefined

  if (body === undefined && method !== 'POST') {
    return { url: requestUrl, method: 'GET', headers, warnings }
  }

  if (
    !Object.keys(headers).some(
      key => key.toLocaleLowerCase() === 'content-type',
    )
  ) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
  }
  return {
    url: requestUrl,
    method: method === 'GET' ? 'GET' : 'POST',
    headers,
    body: typeof body === 'string' ? fillSearchKey(body, searchKey) : undefined,
    warnings,
  }
}

const parseRule = rule => {
  const trimmed = rule?.trim()
  if (!trimmed) return undefined

  const [ruleBody, ...replacements] = trimmed.split('##')
  const ruleParts = ruleBody.split('@').map(part => part.trim())
  if (ruleParts.length === 1)
    return {
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

const applyRuleReplacements = (value, replacements) =>
  replacements.reduce((text, pattern) => {
    try {
      return text.replace(new RegExp(pattern, 'g'), '')
    } catch {
      return text.split(pattern).join('')
    }
  }, value)

const normalizeRuleText = value => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

const selectorWithIndex = selector => {
  const trimmed = selector.trim()
  const match = trimmed.match(SELECTOR_INDEX_PATTERN)
  if (match === null) return { selector: trimmed }

  const cssSelector = match[1].trim()
  if (!cssSelector) return { selector: trimmed }

  return {
    selector: cssSelector,
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

const selectRuleNodes = ($, scopes, rawSelector) => {
  const { selector, startIndex, endIndex } = selectorWithIndex(rawSelector)
  return scopes.flatMap(scope => {
    const nodes = selector === '' ? [scope] : $(scope).find(selector).toArray()
    return applySelectorIndex(nodes, startIndex, endIndex)
  })
}

const selectRuleTarget = ($, scope, selectors) => {
  const nodes = selectors.reduce(
    (current, selector) => selectRuleNodes($, current, selector),
    [scope],
  )
  return nodes[0] === undefined ? undefined : $(nodes[0])
}

const readRuleValue = ($, scope, rule, baseUrl) => {
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

const readOptionalRuleValue = ($, scope, rule, baseUrl) => {
  try {
    return readRuleValue($, scope, rule, baseUrl)
  } catch {
    return ''
  }
}

const isJsonPathRule = rule => /^\s*\$/.test(rule ?? '')

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

const isJsonAccessorRule = rule =>
  isJsonPathRule(rule) || JSON_ACCESSOR_PATTERN.test(rule ?? '')

const isJsonPathUnionRule = rule => {
  const alternatives = splitRuleAlternatives(rule)
  return alternatives.length > 0 && alternatives.every(isJsonAccessorRule)
}

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

const expandJsonToken = (value, token) => {
  if (token === '*') {
    if (Array.isArray(value)) return value
    return isRecord(value) ? Object.values(value) : []
  }

  const match = token.match(/^([^[\]]+)(?:\[(-?\d+|\*)\])?$/)
  if (match === null || !isRecord(value)) return []

  const child = value[match[1]]
  const index = match[2]
  if (index === undefined) return [child]
  if (index === '*') {
    if (Array.isArray(child)) return child
    return isRecord(child) ? Object.values(child) : []
  }

  if (!Array.isArray(child)) return []
  const normalizedIndex = normalizeIndex(Number(index), child.length)
  return child[normalizedIndex] === undefined ? [] : [child[normalizedIndex]]
}

const readJsonPathValues = (value, path) => {
  const trimmed = path.trim()
  if (trimmed === '$') return [value]
  if (trimmed.startsWith('$..')) {
    const [property, ...rest] = trimmed.slice(3).split('.').filter(Boolean)
    if (!property) return []
    const propertyMatch = property.match(/^([^[\]]+)(?:\[\*\])?$/)
    if (propertyMatch === null) return []
    const values = collectJsonProperty(value, propertyMatch[1])
    const expanded =
      property.endsWith('[*]') || Array.isArray(values[0])
        ? values.flatMap(item => (Array.isArray(item) ? item : [item]))
        : values
    return rest.reduce(
      (current, token) => current.flatMap(item => expandJsonToken(item, token)),
      expanded,
    )
  }
  if (!trimmed.startsWith('$.')) return []

  return trimmed
    .slice(2)
    .split('.')
    .filter(Boolean)
    .reduce(
      (current, token) => current.flatMap(item => expandJsonToken(item, token)),
      [value],
    )
}

const readJsonAccessorValues = (value, path) => {
  const trimmed = path.trim()
  if (isJsonPathRule(trimmed)) return readJsonPathValues(value, trimmed)
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
    .map(normalizeRuleText)
    .filter(Boolean)
    .join(',')

const readJsonPathUnionValues = (value, rule) => {
  const results = []
  const seen = new Set()
  splitRuleAlternatives(rule).forEach(path => {
    readJsonAccessorValues(value, path).forEach(item => {
      const key = JSON.stringify(item)
      if (seen.has(key)) return
      seen.add(key)
      results.push(item)
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
  ruleBody.replace(/@put:\{[^}]+\}/g, '')

const normalizeJsonRuleBody = (ruleBody, item) =>
  stripJsonVariableOperators(ruleBody).replace(
    /@get:\{([^}]+)\}/g,
    (_, expression) => readJsonPathText(item, expression.trim()),
  )

const readJsonRuleValue = (item, rule) => {
  const parsedRule = parseRule(rule)
  if (parsedRule === undefined) return ''

  const [ruleBody] = rule.trim().split('##')
  const normalizedRuleBody = normalizeJsonRuleBody(ruleBody, item)
  const templateValue = normalizedRuleBody.replace(
    /\{\{(.*?)\}\}/g,
    (_, expression) => {
      const path = expression.trim()
      return path === '' ? '' : readJsonPathText(item, path)
    },
  )
  const value = normalizedRuleBody.includes('{{')
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

const resolveHttpUrl = (value, baseUrl) => {
  const trimmed = value.trim()
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
  const trimmed = value.trim()
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

const buildSourceSearchBook = ($, source, node, baseUrl, index) => {
  const rule = source.ruleSearch ?? {}
  const scope = $(node)
  const name = readRuleValue($, scope, rule.name, baseUrl)
  if (!name) return undefined

  const bookUrl = resolveHttpUrl(
    readRuleValue($, scope, rule.bookUrl, baseUrl),
    baseUrl,
  )
  if (!bookUrl) return undefined

  const coverUrl = resolveImageUrl(
    readOptionalRuleValue($, scope, rule.coverUrl, baseUrl),
    baseUrl,
  )
  const now = Date.now()
  return {
    entryType: 'source-search',
    name,
    author: readOptionalRuleValue($, scope, rule.author, baseUrl),
    bookUrl,
    kind: readOptionalRuleValue($, scope, rule.kind, baseUrl) || undefined,
    wordCount:
      readOptionalRuleValue($, scope, rule.wordCount, baseUrl) || undefined,
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
  }
}

const buildJsonSourceSearchBook = (source, item, baseUrl, index) => {
  const rule = source.ruleSearch ?? {}
  const name = readJsonRuleValue(item, rule.name)
  if (!name) return undefined

  const bookUrl = resolveHttpUrl(readJsonRuleValue(item, rule.bookUrl), baseUrl)
  if (!bookUrl) return undefined

  const coverUrl = resolveImageUrl(
    readJsonRuleValue(item, rule.coverUrl),
    baseUrl,
  )
  const now = Date.now()
  return {
    entryType: 'source-search',
    name,
    author: readJsonRuleValue(item, rule.author),
    bookUrl,
    kind: readJsonRuleValue(item, rule.kind) || undefined,
    wordCount: readJsonRuleValue(item, rule.wordCount) || undefined,
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
  }
}

const appendWarnings = (message, warnings) => {
  const text = unique(warnings).join('；')
  return text ? `${message}；${text}` : message
}

const isSelectorSyntaxError = error =>
  error instanceof Error &&
  /(selector|pseudo|expected|unmatched|empty sub-selector|invalid)/i.test(
    error.message,
  )

const isAnonymousAccessRejected = (error, source) =>
  error instanceof Error &&
  /HTTP 40[13]/.test(error.message) &&
  (source.enabledCookieJar ||
    Boolean(source.loginUrl) ||
    Boolean(source.loginUi) ||
    Boolean(source.loginCheckJs))

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

  if (!isHttpUrl(source.bookSourceUrl)) {
    return {
      books: [],
      report: sourceSearchReport(
        source,
        'unsupported',
        '书源域名必须是 http/https URL',
      ),
    }
  }

  if (!source.searchUrl?.trim()) {
    return {
      books: [],
      report: sourceSearchReport(source, 'skipped', '未配置搜索地址'),
    }
  }

  const ruleSearch = source.ruleSearch ?? {}
  const listRule = ruleSearch.bookList?.trim()
  if (!listRule) {
    return {
      books: [],
      report: sourceSearchReport(source, 'skipped', '未配置搜索列表规则'),
    }
  }
  if (!ruleSearch.name?.trim()) {
    return {
      books: [],
      report: sourceSearchReport(source, 'skipped', '未配置书名规则'),
    }
  }
  if (!ruleSearch.bookUrl?.trim()) {
    return {
      books: [],
      report: sourceSearchReport(source, 'skipped', '未配置详情地址规则'),
    }
  }

  const complexRule = [
    listRule,
    ruleSearch.name,
    ruleSearch.author,
    ruleSearch.kind,
    ruleSearch.wordCount,
    ruleSearch.lastChapter,
    ruleSearch.intro,
    ruleSearch.coverUrl,
    ruleSearch.bookUrl,
  ].find(isComplexLegadoRule)
  if (complexRule !== undefined) {
    return {
      books: [],
      report: sourceSearchReport(
        source,
        'unsupported',
        `规则「${complexRule}」超出当前 Web 搜索支持范围`,
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
    const request = buildSourceSearchRequest(source, searchKey)
    warnings.push(...request.warnings)
    const { finalUrl, content } = await requestBytes(request.url, {
      method: request.method,
      headers: normalizeProxyHeaders(request.headers),
      body: request.body,
      timeout: SOURCE_SEARCH_TIMEOUT_MS,
    })
    const text = content.toString('utf8')
    const books = isJsonPathUnionRule(listRule)
      ? readJsonPathUnionValues(
          JSON.parse(text.replace(/^\uFEFF/, '')),
          listRule,
        )
          .map((item, index) =>
            buildJsonSourceSearchBook(source, item, finalUrl, index),
          )
          .filter(Boolean)
          .slice(0, SOURCE_SEARCH_RESULT_LIMIT)
      : (() => {
          const $ = cheerio.load(text)
          return $(listRule)
            .toArray()
            .map((node, index) =>
              buildSourceSearchBook($, source, node, finalUrl, index),
            )
            .filter(Boolean)
            .slice(0, SOURCE_SEARCH_RESULT_LIMIT)
        })()

    return {
      books,
      report: sourceSearchReport(
        source,
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
      isSelectorSyntaxError(error) || isAnonymousAccessRejected(error, source)
        ? 'unsupported'
        : 'failed'
    return {
      books: [],
      report: sourceSearchReport(
        source,
        status,
        appendWarnings(
          isAnonymousAccessRejected(error, source)
            ? `目标站拒绝匿名搜索请求：${message}`
            : status === 'unsupported'
              ? `规则语法不支持：${message}`
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

const searchBookSources = async keyword => {
  const searchKey = keyword.trim()
  if (!searchKey) return { books: [], reports: [] }

  const sources = (await getSources('bookSource')).sort(compareBookSources)
  const results = await mapWithConcurrency(
    sources,
    SOURCE_SEARCH_CONCURRENCY,
    source => searchSingleBookSource(source, searchKey),
  )
  const bookMap = new Map()
  const reports = []
  results.forEach(result => {
    reports.push(result.report)
    result.books.forEach(book => bookMap.set(book.resultKey, book))
  })

  return { books: Array.from(bookMap.values()), reports }
}

const fetchSubscriptionJson = async rawUrl => {
  const url = await validatePublicUrl(rawUrl)
  const headers = {
    Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
  }
  if (url.hostname === YIOVE_API_HOSTNAME) {
    headers.Origin = YIOVE_SITE_ORIGIN
    headers.Referer = `${YIOVE_SITE_ORIGIN}/`
  }

  const { content } = await requestBytes(url.toString(), {
    headers,
    timeout: SUBSCRIPTION_TIMEOUT_MS,
    limit: MAX_SUBSCRIPTION_BYTES,
  })
  JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''))
  return content
}

const handleApi = async (req, res, url) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, '', {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return true
  }

  if (url.pathname === '/api/source-subscription' && req.method === 'GET') {
    try {
      const rawUrl = url.searchParams.get('url') ?? ''
      const content = await fetchSubscriptionJson(rawUrl)
      send(res, 200, content, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
    } catch (error) {
      sendApiError(
        res,
        400,
        error instanceof Error ? error.message : String(error),
      )
    }
    return true
  }

  if (url.pathname === '/api/source-fetch' && req.method === 'POST') {
    try {
      sendApiOk(res, await fetchSourceText(await readJsonBody(req)))
    } catch (error) {
      sendApiError(
        res,
        400,
        error instanceof Error ? error.message : String(error),
      )
    }
    return true
  }

  if (!url.pathname.startsWith('/api/')) return false

  try {
    await ensureDatabase()

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
      await saveReadConfig(await readJsonBody(req))
      sendApiOk(res, '阅读配置已保存到 PG')
      return true
    }

    if (url.pathname === '/api/book-source-search' && req.method === 'POST') {
      const body = await readJsonBody(req)
      if (!isRecord(body) || typeof body.keyword !== 'string') {
        throw new Error('搜索请求缺少 keyword')
      }
      sendApiOk(res, await searchBookSources(body.keyword))
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
        throw new Error('导入 TXT 请求缺少 name/text')
      }
      if (
        !file.name.toLocaleLowerCase().endsWith('.txt') &&
        file.type !== 'text/plain'
      ) {
        throw new Error('当前纯 Web 版本仅支持导入 TXT 文本书籍')
      }
      const chapters = parseTextChapters(file.text)
      const book = buildBook(
        {
          name: file.name,
          size: Number(file.size) || Buffer.byteLength(file.text),
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
      const bookUrl = url.searchParams.get('bookUrl') ?? ''
      const chapters = await getChapters(bookUrl)
      if (chapters.length === 0)
        sendApiError(res, 404, '这本书还没有章节，请重新导入')
      else sendApiOk(res, chapters)
      return true
    }

    if (url.pathname === '/api/chapter-content' && req.method === 'GET') {
      const bookUrl = url.searchParams.get('bookUrl') ?? ''
      const index = Number(url.searchParams.get('index') ?? '0')
      const content = await getChapterContent(bookUrl, index)
      if (content === undefined) sendApiError(res, 404, '章节不存在或已被删除')
      else sendApiOk(res, content)
      return true
    }

    if (url.pathname === '/api/book' && req.method === 'DELETE') {
      const bookUrl = url.searchParams.get('bookUrl') ?? ''
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
      500,
      error instanceof Error ? error.message : String(error),
    )
  }
  return true
}

const etag = buffer =>
  `"${crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16)}"`

const serveStatic = async (req, res, url) => {
  const decodedPath = decodeURIComponent(url.pathname)
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.slice(1)
  let filePath = path.resolve(staticDir, relativePath)
  if (!filePath.startsWith(staticDir)) {
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
      'Cache-Control': 'no-store',
    })
  } catch {
    send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' })
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`,
  )
  if (await handleApi(req, res, url)) return
  await serveStatic(req, res, url)
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
