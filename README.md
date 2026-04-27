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
- 支持导出/恢复/清空纯 Web 本地数据备份，备份包含书籍、章节、阅读进度、阅读配置和源配置。
- 书源/订阅源编辑器可本地保存、拉取、推送配置，并支持源配置 JSON 导入/导出。

限制：

- 纯浏览器不能绕过目标网站 CORS；远程站点抓取、完整 Legado 规则调试和 Rhino 专属能力需要后续单独实现 Web 规则引擎或配套 Web 后端。
- 当前纯 Web 阅读能力以本地 TXT 书籍为主。
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
