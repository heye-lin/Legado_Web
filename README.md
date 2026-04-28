# 阅读 Web 端

这是 `legado` 的纯 Web 前端。当前版本直接在浏览器中使用，不再要求 Android App 或原 Android WebService；生产启动脚本会使用 PostgreSQL 持久化书源、订阅源、书架、章节和阅读配置，接口不可用时前端会降级到浏览器本地 IndexedDB/localStorage。

## 路由

- `http://localhost:8080/`：书架 / 阅读
- `http://localhost:8080/#/bookSource`：书源编辑
- `http://localhost:8080/#/rssSource`：订阅源编辑

## 纯 Web / PostgreSQL 模式

默认直接启动即可：

```bash
pnpm install
pnpm dev
```

浏览器打开：

```text
http://localhost:8080/
```

能力：

- 不依赖 Android App 或后端服务。
- 生产服务：书籍、章节、阅读进度、阅读配置、书源配置、订阅源配置优先保存在 PostgreSQL。
- 降级模式：如果同源 `/api/*` 不可用，前端继续使用浏览器 IndexedDB/localStorage。
- 书架页支持导入本地 `.txt` 文件，也支持拖拽 TXT 到书架区域导入。
- TXT 会在浏览器内按常见章节标题切分目录；识别不到章节标题时会按长度自动分章。
- 书架页提供「书源管理」入口和「在线搜书」按钮；生产服务会在服务端执行书源搜索，结果可在站内预览详情/目录，也可加入书架。
- 通过书源搜索结果加入书架时，生产服务会解析书籍详情和目录；章节正文会在阅读时按需抓取、解析并缓存到 PostgreSQL。
- 支持导出/恢复/清空纯 Web 本地数据备份，备份包含书籍、章节、阅读进度、阅读配置和源配置。
- 书源/订阅源编辑器可本地保存、拉取、推送配置，并支持源配置 JSON 文件导入/导出和 URL 订阅导入，例如 `https://shuyuan.yiove.com/sub.json`。

限制：

- 生产服务会通过同源 `/api/book-source-search` 在服务端抓取并解析书源搜索结果，避免浏览器 CORS 阻断；如果只用纯静态服务降级运行，则仍受目标网站 CORS 限制。
- 当前书源搜索是受限 MVP：支持 `searchUrl` + `ruleSearch` 中常见 CSS 选择器、`:contains(...)` 文本过滤、`##` 文本清理、`@text`、`@html`、`@href`、`@src`、`@属性名`、简单 Legado `@` 链式选择、简单位置选择（如 `a.1`、`span.0:-1`）、常见 JSONPath 搜索列表（如 `$.data[*]`、`$..book_info[*]`）和 `{{$.field}}` 模板；不执行 Legado/Rhino JS、XPath、复杂正则链式规则、CookieJar、登录流程、反爬绕过。
- 书源筛选中的「当前 Web 候选」是静态初筛：HTTP 地址、必要搜索规则完整，且没有明显 JS、登录或 CookieJar 依赖；它不能保证目标站网络、反爬或实际规则解析一定成功，生产服务会在搜索报告中展示失败/不支持原因。
- 当前远程书籍入库支持常见 `ruleBookInfo`、`ruleToc`、`ruleContent` 的 CSS/文本/HTML/简单 JSONPath 解析；不执行书源 JS、登录、CookieJar 或反爬流程。依赖动态接口但参数静态写在页面 `$.post` 中的正文会尝试服务端解析。
- 纯静态/浏览器本地降级模式仍不能绕过浏览器 CORS，也暂不支持将书源搜索结果加入书架；在线书籍入库与正文缓存需要生产服务和 PostgreSQL。
- 备份文件是 JSON 明文，请自行保存好；浏览器清站点数据会删除 IndexedDB/localStorage 中的本地书库。

## 构建

```bash
pnpm build
```

产物位于：

```text
dist/
```

生产环境建议用仓库内服务启动。它会提供静态页面、PostgreSQL 持久化 API，以及 `/api/source-subscription` 订阅 JSON 同源代理，用于导入不允许浏览器 CORS 直连的订阅 URL：

```bash
LEGADO_DATABASE_URL=postgres://user:password@127.0.0.1:5432/database \
  node scripts/serve.mjs --port 8080 --directory dist
```

当前服务器默认监听 `127.0.0.1:8080`，并尝试连接 `postgres://iaeno:iaeno@127.0.0.1:5432/cli_proxy`，自动创建 `legado_web` schema 及所需表。需要局域网或公网访问时再显式传入 `--host 0.0.0.0`，并建议放在可信网络或带鉴权的反向代理后；此时必须用 `LEGADO_ALLOWED_ORIGINS` 配置允许访问的公网 Origin，例如 `LEGADO_ALLOWED_ORIGINS=http://54.199.131.57:8080`。生产服务会拒绝跨站 API 请求和未授权 Host，书源搜索结果加入书架也会校验服务端签名；签名密钥默认是进程内随机值，也可用 `LEGADO_RESULT_SIGNING_SECRET` 固定配置，签名默认 30 分钟过期，可用 `LEGADO_RESULT_SIGNATURE_TTL_MS` 调整。重启后使用旧搜索结果入库失败时，请重新搜索后再加入书架。

公网直连示例：

```bash
LEGADO_ALLOWED_ORIGINS=http://54.199.131.57:8080 \
  node scripts/serve.mjs --host 0.0.0.0 --port 8080 --directory dist
```

只需要纯静态/浏览器本地降级模式时，可使用旧静态服务：

```bash
python3 scripts/serve.py --host 0.0.0.0 --port 8080 --directory dist
```

生产服务启动后可执行 smoke 验证：

```bash
pnpm smoke -- --base http://127.0.0.1:8080
pnpm smoke:source -- --base http://127.0.0.1:8080 --keyword 三体
```

其中 `smoke:source` 会实际执行 Web 候选筛选、书源搜索、站内预览、搜索结果加入书架、目录解析、首章正文解析/缓存、未签名搜索结果拒绝和订阅代理检查；依赖当前 PostgreSQL 中已有可搜索书源，以及目标站网络可达。如果 smoke 导入了新书，默认会在验证后删除；需要保留时可追加 `--keep-imported`。

## 兼容性

| Edge | Firefox | Chrome | Safari |
| ---- | ------- | ------ | ------ |
| ≥ 85 | ≥ 79    | ≥ 85   | ≥ 14.1 |
