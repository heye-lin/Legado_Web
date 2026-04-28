# 阅读 Web 端

这是 `legado` 的纯 Web 前端。当前版本直接在浏览器本地运行，不再要求 Android App 或后端 WebService。

## 路由

- `http://localhost:8080/`：书架 / 阅读
- `http://localhost:8080/#/bookSource`：书源编辑
- `http://localhost:8080/#/rssSource`：订阅源编辑

## 纯 Web 本地模式

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
- 书籍、章节、阅读进度：保存在浏览器 IndexedDB。
- 阅读配置、书源配置、订阅源配置：保存在浏览器 localStorage。
- 书架页支持导入本地 `.txt` 文件，也支持拖拽 TXT 到书架区域导入。
- TXT 会在浏览器内按常见章节标题切分目录；识别不到章节标题时会按长度自动分章。
- 书架页提供「书源管理」入口和「用书源搜书」按钮；可对浏览器允许访问的书源执行受限搜索，结果仅用于打开来源站详情页。
- 支持导出/恢复/清空纯 Web 本地数据备份，备份包含书籍、章节、阅读进度、阅读配置和源配置。
- 书源/订阅源编辑器可本地保存、拉取、推送配置，并支持源配置 JSON 导入/导出。

限制：

- 纯浏览器不能绕过目标网站 CORS；目标站未允许跨域读取响应时，Web 端无法直接搜索或抓取。
- 当前书源搜索是受限 MVP：支持 `searchUrl` + `ruleSearch` 中浏览器 `querySelector` 可识别的 CSS 选择器规则，以及 `@text`、`@html`、`@href`、`@src`、`@属性名` 这类简单抽取；不执行 Legado/Rhino JS、XPath、JSONPath、正则链式规则、CookieJar、登录流程、反爬绕过。
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

## 兼容性

| Edge | Firefox | Chrome | Safari |
| ---- | ------- | ------ | ------ |
| ≥ 85 | ≥ 79    | ≥ 85   | ≥ 14.1 |
