<script setup lang="ts">
import { Link } from '@element-plus/icons-vue'
</script>
<template>
  <el-alert
    title="纯 Web 版当前保留 Legado 源配置编辑和本地保存能力；完整远程抓取等原生端能力不在浏览器本地模式内直接提供。"
    type="info"
    :closable="false"
    show-icon
  />
  <el-link :icon="Link" href="https://github.com/gedoor/legado" target="_blank">
    Legado 原项目规则参考</el-link
  ><br />
  <el-link :icon="Link" href="https://regexr-cn.com/" target="_blank"
    >正则表达式在线验证工具</el-link
  ><br />
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
