<script setup lang="ts">
import { Link } from '@element-plus/icons-vue'
</script>
<template>
  <el-alert
    title="纯 Web 版支持保存书源，并提供受限书源搜索：生产服务会通过同源服务端接口抓取并解析搜索结果，不依赖浏览器 CORS；完整 Legado/Rhino JS、登录、CookieJar、目录/正文抓取暂不直接提供。"
    type="info"
    :closable="false"
    show-icon
  />
  <el-text>
    最低可搜索配置：<code>searchUrl</code>、<code>ruleSearch.bookList</code>、<code>ruleSearch.name</code>、<code>ruleSearch.bookUrl</code>。搜索字段可使用
    <code>.book</code
    >、<code>.title@text</code>、<code>a@href</code>、<code>img@src</code>、<code
      >.cover@data-src</code
    >
    这类 CSS 选择器 +
    简单属性抽取；搜索结果目前会打开外部详情页，不会直接入库在线阅读。
  </el-text>
  <br />
  <el-text>
    可点击左侧 <code>⇩URL订阅</code> 输入源订阅地址，例如
    <code>https://shuyuan.yiove.com/sub.json</code>。当前会合并导入 JSON
    中识别到的书源和订阅源，不会清空已有本地源。
  </el-text>
  <br />
  <el-link :icon="Link" href="https://github.com/gedoor/legado" target="_blank">
    Legado 原项目规则参考</el-link
  ><br />
  <el-link :icon="Link" href="https://regexr-cn.com/" target="_blank"
    >正则表达式在线验证工具</el-link
  ><br />
  <el-text type="warning">
    下方正则内容属于 Legado 原生规则参考，不代表纯 Web 搜索已支持正则链式规则。
  </el-text>
  <div style="margin-top: 20px">
    <span
      ><el-text
        ><code>^$()[]{}.?+*|</code> 这些是 Java
        正则特殊符号，匹配需转义</el-text
      ></span
    ><br />
    <span
      ><el-text><code>(?s)</code> 前缀表示跨行解析</el-text></span
    ><br />
    <span
      ><el-text><code>(?m)</code> 前缀表示逐行匹配</el-text></span
    ><br />
    <span
      ><el-text><code>(?i)</code> 前缀表示忽略大小写</el-text></span
    ><br />
  </div>
</template>

<style lang="scss" scoped>
.el-link {
  padding: 4px;
}
.el-text {
  padding-top: 20px;
}
</style>
