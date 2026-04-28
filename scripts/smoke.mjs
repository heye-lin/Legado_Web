#!/usr/bin/env node
import process from 'node:process'

const DEFAULT_SUBSCRIPTION_URL = 'https://shuyuan.yiove.com/sub.json'
const DEFAULT_SOURCE_FILTER = Object.freeze({
  keyword: '',
  enabled: 'enabled',
  feature: 'web',
  field: 'all',
})

const parseArgs = argv => {
  const args = {
    base: process.env.LEGADO_SMOKE_BASE ?? 'http://127.0.0.1:8080',
    keyword: process.env.LEGADO_SMOKE_KEYWORD ?? '三体',
    preferredName: process.env.LEGADO_SMOKE_PREFERRED_NAME ?? '三体',
    preferredSource: process.env.LEGADO_SMOKE_PREFERRED_SOURCE ?? '爱看吧',
    keepImported: false,
    sourceWorkflow: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--') {
      continue
    } else if (arg === '--source-workflow') {
      args.sourceWorkflow = true
    } else if (arg === '--base') {
      args.base = argv[++i]
    } else if (arg.startsWith('--base=')) {
      args.base = arg.slice('--base='.length)
    } else if (arg === '--keyword') {
      args.keyword = argv[++i]
    } else if (arg.startsWith('--keyword=')) {
      args.keyword = arg.slice('--keyword='.length)
    } else if (arg === '--preferred-name') {
      args.preferredName = argv[++i]
    } else if (arg.startsWith('--preferred-name=')) {
      args.preferredName = arg.slice('--preferred-name='.length)
    } else if (arg === '--preferred-source') {
      args.preferredSource = argv[++i]
    } else if (arg.startsWith('--preferred-source=')) {
      args.preferredSource = arg.slice('--preferred-source='.length)
    } else if (arg === '--keep-imported') {
      args.keepImported = true
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }

  args.base = args.base.replace(/\/+$/, '')
  return args
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const requestText = async (base, path, options = {}) => {
  const response = await fetch(`${base}${path}`, options)
  const text = await response.text()
  return { response, text }
}

const requestJson = async (base, path, options = {}) => {
  const { response, text } = await requestText(base, path, options)
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${path} 响应不是 JSON：${text.slice(0, 180)}`)
  }
  return { response, payload }
}

const apiJson = async (base, path, options = {}) => {
  const { response, payload } = await requestJson(base, path, options)
  assert(response.ok, `${path} HTTP ${response.status}: ${payload.errorMsg}`)
  assert(payload.isSuccess === true, `${path} API 失败：${payload.errorMsg}`)
  return payload.data
}

const statusCheck = async (base, name, path, expectedStatus, options = {}) => {
  const { response } = await requestText(base, path, options)
  assert(
    response.status === expectedStatus,
    `${name} 状态码 ${response.status}，期望 ${expectedStatus}`,
  )
  console.log(`✓ ${name}: ${response.status}`)
}

const jsonHeaders = base => ({
  Origin: base,
  'Content-Type': 'application/json',
})

const smokeStaticAndApi = async base => {
  const index = await requestText(base, '/')
  assert(index.response.ok, `/ HTTP ${index.response.status}`)
  assert(
    index.text.includes('阅读 Web 端 - TXT 与书源在线阅读'),
    '首页未命中新标题',
  )
  assert(index.text.includes('assets/index-'), '首页未命中构建后的入口资源')
  console.log('✓ 首页可访问且命中新构建产物')

  const health = await apiJson(base, '/api/health')
  assert(health.database === 'ok', `数据库状态异常：${health.database}`)
  console.log('✓ /api/health PostgreSQL ok')

  await statusCheck(base, '同源 health', '/api/health', 200, {
    headers: { Origin: base },
  })
  await statusCheck(base, '跨站 health 拒绝', '/api/health', 403, {
    headers: { Origin: 'http://evil.example' },
  })
  await statusCheck(
    base,
    '非法章节序号拒绝',
    '/api/chapter-content?bookUrl=smoke&index=-1',
    400,
    { headers: { Origin: base } },
  )
}

const smokeSubscriptionProxy = async base => {
  const url = encodeURIComponent(DEFAULT_SUBSCRIPTION_URL)
  const { response, payload } = await requestJson(
    base,
    `/api/source-subscription?url=${url}`,
    { headers: { Origin: base } },
  )
  assert(response.ok, `/api/source-subscription HTTP ${response.status}`)
  assert(
    Array.isArray(payload) || (payload && typeof payload === 'object'),
    '订阅代理返回的 JSON 不是数组或对象',
  )
  const size = Array.isArray(payload)
    ? payload.length
    : Object.keys(payload ?? {}).length
  console.log(`✓ 订阅代理可用：${DEFAULT_SUBSCRIPTION_URL} (${size})`)
}

const pickSourceBook = (books, { preferredName, preferredSource }) =>
  books.find(
    book =>
      (!preferredName || book.name === preferredName) &&
      (!preferredSource || book.sourceName?.includes(preferredSource)),
  ) ?? books[0]

const deleteImportedSmokeBook = async (base, book) => {
  const bookUrl = encodeURIComponent(book.bookUrl)
  const { response, payload } = await requestJson(
    base,
    `/api/book?bookUrl=${bookUrl}`,
    {
      method: 'DELETE',
      headers: { Origin: base },
    },
  )
  assert(response.ok && payload.isSuccess === true, '清理 smoke 书籍失败')
  console.log(`✓ 已清理 smoke 新增书籍：《${book.name}》`)
}

const smokeSourceWorkflow = async (base, options) => {
  const { keyword } = options
  const invalidFeature = await requestJson(base, '/api/book-source-search', {
    method: 'POST',
    headers: jsonHeaders(base),
    body: JSON.stringify({
      keyword,
      sourceFilter: { ...DEFAULT_SOURCE_FILTER, feature: '__bad__' },
    }),
  })
  assert(invalidFeature.response.status === 400, '非法书源能力筛选未被拒绝')
  assert(
    invalidFeature.payload.isSuccess === false,
    '非法书源能力筛选响应格式异常',
  )
  console.log('✓ 非法书源能力筛选被拒绝')

  const search = await apiJson(base, '/api/book-source-search', {
    method: 'POST',
    headers: jsonHeaders(base),
    body: JSON.stringify({
      keyword,
      sourceFilter: DEFAULT_SOURCE_FILTER,
    }),
  })
  assert(Array.isArray(search.books), '书源搜索 books 不是数组')
  assert(Array.isArray(search.reports), '书源搜索 reports 不是数组')
  assert(search.books.length > 0, `书源搜索「${keyword}」没有结果`)
  const book = pickSourceBook(search.books, options)
  assert(book && typeof book.resultSig === 'string', '搜索结果缺少 resultSig')
  console.log(
    `✓ 书源搜索：${search.books.length} 本，${search.reports.length} 条报告，选中《${book.name}》/${book.sourceName}`,
  )

  const preview = await apiJson(base, '/api/books/preview-source', {
    method: 'POST',
    headers: jsonHeaders(base),
    body: JSON.stringify(book),
  })
  assert(preview.book?.bookUrl, '站内预览结果缺少 bookUrl')
  assert(preview.chapterCount > 0, '站内预览未解析出目录')
  assert(Array.isArray(preview.chapters), '站内预览 chapters 不是数组')
  assert(preview.chapters.length > 0, '站内预览没有目录样例')
  assert(
    typeof preview.alreadyOnShelf === 'boolean',
    '站内预览 alreadyOnShelf 不是布尔值',
  )
  console.log(
    `✓ 站内预览：目录 ${preview.chapterCount} 章，首章「${preview.chapters[0].title}」，alreadyOnShelf=${preview.alreadyOnShelf}`,
  )

  const unsignedPreview = await requestJson(base, '/api/books/preview-source', {
    method: 'POST',
    headers: jsonHeaders(base),
    body: JSON.stringify({ ...book, resultSig: '' }),
  })
  assert(unsignedPreview.response.status === 400, '未签名搜索结果预览未被拒绝')
  assert(
    unsignedPreview.payload.isSuccess === false,
    '未签名预览拒绝响应格式异常',
  )
  console.log('✓ 未签名搜索结果预览被拒绝')

  const imported = await apiJson(base, '/api/books/import-source', {
    method: 'POST',
    headers: jsonHeaders(base),
    body: JSON.stringify(book),
  })
  assert(imported.book?.bookUrl, '加入书架结果缺少 bookUrl')
  assert(imported.chapterCount > 0, '加入书架未解析出目录')
  console.log(
    `✓ 加入书架：${imported.book.name}，目录 ${imported.chapterCount} 章，alreadyOnShelf=${imported.alreadyOnShelf}`,
  )

  const bookUrl = encodeURIComponent(imported.book.bookUrl)
  const chapters = await apiJson(base, `/api/chapters?bookUrl=${bookUrl}`)
  assert(Array.isArray(chapters) && chapters.length > 0, '目录接口无章节')
  console.log(`✓ 目录解析：${chapters.length} 章，首章「${chapters[0].title}」`)

  const content = await apiJson(
    base,
    `/api/chapter-content?bookUrl=${bookUrl}&index=0`,
  )
  assert(typeof content === 'string' && content.length > 100, '正文内容过短')
  console.log(`✓ 正文解析/缓存：${content.length} 字`)

  const unsigned = await requestJson(base, '/api/books/import-source', {
    method: 'POST',
    headers: jsonHeaders(base),
    body: JSON.stringify({ ...book, resultSig: '' }),
  })
  assert(unsigned.response.status === 400, '未签名搜索结果未被拒绝')
  assert(unsigned.payload.isSuccess === false, '未签名拒绝响应格式异常')
  console.log('✓ 未签名搜索结果加入书架被拒绝')

  if (!imported.alreadyOnShelf && !options.keepImported) {
    await deleteImportedSmokeBook(base, imported.book)
  }
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  console.log(`Smoke base: ${args.base}`)
  await smokeStaticAndApi(args.base)
  await smokeSubscriptionProxy(args.base)
  if (args.sourceWorkflow) {
    await smokeSourceWorkflow(args.base, args)
  } else {
    console.log('ℹ 跳过书源搜索/入库/正文链路；需要时添加 --source-workflow')
  }
}

main().catch(error => {
  console.error(
    `✗ smoke failed: ${error instanceof Error ? error.message : error}`,
  )
  process.exitCode = 1
})
