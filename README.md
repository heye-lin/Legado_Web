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
- 书架页提供「书源管理」入口和「用书源搜书」按钮；生产服务会在服务端执行书源搜索，结果可用于打开来源站详情页。
- 支持导出/恢复/清空纯 Web 本地数据备份，备份包含书籍、章节、阅读进度、阅读配置和源配置。
- 书源/订阅源编辑器可本地保存、拉取、推送配置，并支持源配置 JSON 文件导入/导出和 URL 订阅导入，例如 `https://shuyuan.yiove.com/sub.json`。

限制：

- 生产服务会通过同源 `/api/book-source-search` 在服务端抓取并解析书源搜索结果，避免浏览器 CORS 阻断；如果只用纯静态服务降级运行，则仍受目标网站 CORS 限制。
- 当前书源搜索是受限 MVP：支持 `searchUrl` + `ruleSearch` 中常见 CSS 选择器、`:contains(...)` 文本过滤、`##` 文本清理、`@text`、`@html`、`@href`、`@src`、`@属性名`、简单 Legado `@` 链式选择、简单位置选择（如 `a.1`、`span.0:-1`）、常见 JSONPath 搜索列表（如 `$.data[*]`、`$..book_info[*]`）和 `{{$.field}}` 模板；不执行 Legado/Rhino JS、XPath、复杂正则链式规则、CookieJar、登录流程、反爬绕过。
- 当前书源搜索结果可打开外部详情页；尚未实现远程书籍一键入库、目录解析和在线正文阅读。纯 Web 阅读能力仍以本地 TXT 书籍为主。
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
  node scripts/serve.mjs --host 0.0.0.0 --port 8080 --directory dist
```

当前服务器默认会尝试连接 `postgres://iaeno:iaeno@127.0.0.1:5432/cli_proxy`，并自动创建 `legado_web` schema 及所需表。只需要纯静态/浏览器本地降级模式时，可使用旧静态服务：

```bash
python3 scripts/serve.py --host 0.0.0.0 --port 8080 --directory dist
```

## 兼容性

| Edge | Firefox | Chrome | Safari |
| ---- | ------- | ------ | ------ |
| ≥ 85 | ≥ 79    | ≥ 85   | ≥ 14.1 |
