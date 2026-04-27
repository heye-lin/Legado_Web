# 「阅读」纯 Web 书架

本书架现在可以在浏览器内独立运行，不再强制依赖 Android App Web 服务。

## 使用

```shell
pnpm install
pnpm dev
```

打开 `http://localhost:8080/`，点击「导入 TXT」添加本地书籍，也可以把 TXT 文件直接拖拽到书架区域。

数据存储：

- 书籍、章节、阅读进度：IndexedDB
- 阅读设置：localStorage

本页还支持：

- 导出备份：导出纯 Web 本地书库、章节、进度、阅读设置和源配置。
- 恢复备份：从备份 JSON 重建浏览器本地数据。
- 清空本地数据：删除当前站点中的纯 Web 本地数据。

如果需要旧版 App WebService 模式，在 `.env.development` 中配置：

```env
VITE_STANDALONE=false
VITE_API=http://手机IP:1122
```
