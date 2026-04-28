<script setup lang="ts">
import { Link } from '@element-plus/icons-vue'
import { isBookSourceKind, sourceKindFromPath } from '@/utils/sourceKind'

const route = useRoute()
const isBookSource = computed(() =>
  isBookSourceKind(sourceKindFromPath(route.fullPath)),
)
</script>

<template>
  <section class="source-help">
    <el-alert class="source-help-hero" type="info" :closable="false" show-icon>
      <template #title>
        {{ isBookSource ? '纯 Web 书源能力说明' : '纯 Web 订阅源说明' }}
      </template>

      <p class="source-help-lead">
        {{
          isBookSource
            ? '纯 Web 版支持保存书源，并提供受限在线搜书。生产服务会通过同源接口抓取并解析搜索结果，结果可加入书架后再解析详情、目录与正文缓存到 PostgreSQL。“当前 Web 候选”只是静态初筛，复杂 Legado/Rhino JS、CookieJar、登录流程和反爬绕过仍不支持。'
            : '纯 Web 版支持保存订阅源，并可通过 URL 订阅（合并）导入书源或订阅源；书架页的在线搜书只使用书源，不使用订阅源。'
        }}
      </p>

      <ul class="source-help-points">
        <li v-if="isBookSource">
          最低可搜索配置：<code>searchUrl</code>、<code>ruleSearch.bookList</code>、<code>ruleSearch.name</code>、<code>ruleSearch.bookUrl</code>。
        </li>
        <li v-if="isBookSource">
          搜索字段可使用
          <code>.book</code
          >、<code>.title@text</code>、<code>a@href</code>、<code>img@src</code>、<code
            >.cover@data-src</code
          >
          这类 CSS 选择器和简单属性抽取。
        </li>
        <li v-if="!isBookSource">
          可点击 <code>URL 订阅（合并）</code> 输入源订阅地址，例如
          <code>https://shuyuan.yiove.com/sub.json</code>；当前会合并导入 JSON
          中识别到的书源和订阅源，不会清空已有本地源。
        </li>
        <li>
          生产服务下搜索结果可在站内预览详情和目录，也可加入书架；服务端会解析常见
          <code>ruleBookInfo</code>、<code>ruleToc</code>、<code
            >ruleContent</code
          >
          规则，目录会随入库保存，正文会在阅读时按需解析并缓存到 PostgreSQL。
        </li>
      </ul>
    </el-alert>

    <div class="source-help-panels">
      <section class="source-help-panel">
        <div class="source-help-panel-title">常用参考</div>
        <div class="source-help-links">
          <el-link
            :icon="Link"
            href="https://github.com/gedoor/legado"
            target="_blank"
            rel="noopener noreferrer"
          >
            Legado 原项目规则参考
          </el-link>
          <el-link
            :icon="Link"
            href="https://regexr-cn.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            正则表达式在线验证工具
          </el-link>
        </div>
        <p class="source-help-note">
          下方正则内容属于 Legado 原生规则参考，不代表纯 Web
          搜索已支持正则链式规则。
        </p>
      </section>

      <section class="regex-help">
        <div class="regex-help-title">正则提示</div>
        <ul>
          <li>
            <code>^$()[]{}.?+*|</code> 这些是 Java 正则特殊符号，匹配需转义
          </li>
          <li><code>(?s)</code> 前缀表示跨行解析</li>
          <li><code>(?m)</code> 前缀表示逐行匹配</li>
          <li><code>(?i)</code> 前缀表示忽略大小写</li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.source-help {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.source-help-hero {
  :deep(.el-alert__content) {
    width: 100%;
  }

  :deep(.el-alert__title) {
    font-size: 15px;
    font-weight: 700;
  }
}

.source-help-lead {
  margin: 8px 0 0;
  color: var(--el-text-color-primary);
  line-height: 1.8;
}

.source-help-points {
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--el-text-color-secondary);
  line-height: 1.8;

  li + li {
    margin-top: 6px;
  }
}

.source-help-panels {
  display: grid;
  gap: 16px;
}

.source-help-panel,
.regex-help {
  padding: 16px 18px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 16px;
  background: var(--el-bg-color);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
}

.source-help-panel-title,
.regex-help-title {
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.source-help-links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;

  :deep(.el-link) {
    white-space: normal;
  }
}

.source-help-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  line-height: 1.8;
}

.regex-help {
  line-height: 1.8;

  ul {
    margin: 0;
    padding-left: 18px;
  }

  li + li {
    margin-top: 6px;
  }
}

:global(html.dark) .source-help-panel,
:global(html.dark) .regex-help {
  background: rgba(31, 35, 39, 0.82);
  border-color: #343a42;
}

@media screen and (max-width: 960px) {
  .source-help {
    gap: 12px;
  }

  .source-help-panel,
  .regex-help {
    padding: 14px 14px 15px;
    border-radius: 14px;
  }

  .source-help-links {
    flex-direction: column;
    gap: 8px;
  }
}
</style>
