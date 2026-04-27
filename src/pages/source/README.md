# 源编辑器

源编辑器现在默认运行在纯 Web 本地模式，源配置保存在浏览器 localStorage 中；不需要 Android App。工具栏支持源配置 JSON 导入/导出，便于在浏览器之间迁移配置。

```shell
pnpm install
pnpm dev
```

路由：

- `/#/bookSource`：书源编辑
- `/#/rssSource`：订阅源编辑

注意：浏览器纯前端会受到目标站 CORS 限制；完整 Legado 规则抓取/调试能力需要后续实现 Web 规则引擎或配套 Web 后端。

如需旧版 App WebService 模式，可在 `.env.development` 中设置：

```env
VITE_STANDALONE=false
VITE_API=http://手机IP:1122
```
