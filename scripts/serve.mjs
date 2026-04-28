#!/usr/bin/env node
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import ipaddr from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
    if (typeof value !== 'string' || isForbiddenProxyHeader(key)) return
    result[key] = value
  })
  return result
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
        response.on('end', () =>
          resolve({
            finalUrl: response.responseUrl ?? url.toString(),
            content: Buffer.concat(chunks),
          }),
        )
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
      'Cache-Control': filePath.endsWith('index.html')
        ? 'no-store'
        : 'public, max-age=31536000, immutable',
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
