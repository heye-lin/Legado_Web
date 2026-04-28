<script setup lang="ts">
import { Link } from '@element-plus/icons-vue'
import { isBookSourceKind, sourceKindFromPath } from '@/utils/sourceKind'

const route = useRoute()
const isBookSource = computed(() =>
  isBookSourceKind(sourceKindFromPath(route.fullPath)),
)
</script>
<template>
  <el-alert
    :title="
      isBookSource
        ? '纯 Web 版支持保存书源，并提供受限书源搜索：生产服务会通过同源服务端接口抓取并解析搜索结果；可将结果加入书架，入库时解析详情/目录，阅读章节时按需解析正文并缓存到 PostgreSQL；复杂 Legado/Rhino JS、CookieJar、登录流程和反爬绕过仍不支持。'
        : '纯 Web 版支持保存订阅源，并可通过 URL 订阅导入书源或订阅源；书籍搜索需要在书源管理中导入可搜索书源。'
    "
    type="info"
    :closable="false"
    show-icon
  />
  <el-text v-if="isBookSource">
    最低可搜索配置：<code>searchUrl</code>、<code>ruleSearch.bookList</code>、<code>ruleSearch.name</code>、<code>ruleSearch.bookUrl</code>。搜索字段可使用
    <code>.book</code
    >、<code>.title@text</code>、<code>a@href</code>、<code>img@src</code>、<code
      >.cover@data-src</code
    >
    这类 CSS 选择器 +
    简单属性抽取。生产服务下搜索结果可打开外部详情页，也可加入书架；服务端会解析常见
    <code>ruleBookInfo</code>、<code>ruleToc</code>、<code>ruleContent</code>
    规则，目录会随入库保存，正文会在阅读时按需解析并缓存到 PostgreSQL。
  </el-text>
  <el-text v-else>
    订阅源用于保存 RSS/订阅配置；如果订阅地址返回的是书源集合，点击
    <code>URL 订阅</code>
    导入后会自动识别并保存到书源管理。书架页的书源搜索只使用书源，不使用订阅源。
  </el-text>
  <br />
  <el-text>
    可点击 <code>URL 订阅</code> 输入源订阅地址，例如
    <code>https://shuyuan.yiove.com/sub.json</code>。当前会合并导入 JSON
    中识别到的书源和订阅源，不会清空已有本地源。
  </el-text>
  <br />
  <el-link
    :icon="Link"
    href="https://github.com/gedoor/legado"
    target="_blank"
    rel="noopener noreferrer"
  >
    Legado 原项目规则参考</el-link
  ><br />
  <el-link
    :icon="Link"
    href="https://regexr-cn.com/"
    target="_blank"
    rel="noopener noreferrer"
  >
    正则表达式在线验证工具</el-link
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
