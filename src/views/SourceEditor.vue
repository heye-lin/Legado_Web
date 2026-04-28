<template>
  <div class="editor">
    <header class="editor-header">
      <div class="editor-title-block">
        <div class="editor-eyebrow">纯 Web 源管理</div>
        <h1>{{ pageTitle }}</h1>
        <p>
          当前共 {{ sourceCount }} 条{{
            sourceDisplayName
          }}。编辑配置、调试规则或批量导入后，请保存到当前持久化服务。
        </p>
      </div>
      <tool-bar />
    </header>
    <main class="editor-workspace">
      <source-tab-form
        class="editor-panel editor-panel--form"
        :config="config"
      />
      <source-tab-tools class="editor-panel editor-panel--tools" />
    </main>
  </div>
</template>
<script setup lang="ts">
import bookSourceConfig from '@/config/bookSourceEditConfig'
import rssSourceConfig from '@/config/rssSourceEditConfig'
import '@/assets/sourceeditor.css'
import { useDark } from '@vueuse/core'
import type { SourceConfig } from '@/config/sourceConfig'
import {
  isBookSourceKind,
  sourceKindDisplayName,
  sourceKindFromPath,
} from '@/utils/sourceKind'
import API from '@api'
import { getErrorMessage } from '@/utils/jsonFile'

useDark()

const store = useSourceStore()
const route = useRoute()
let loadRunId = 0

const currentSourceKind = computed(() => sourceKindFromPath(route.fullPath))
const sourceDisplayName = computed(() =>
  sourceKindDisplayName(currentSourceKind.value),
)
const pageTitle = computed(() => `${sourceDisplayName.value}管理`)
const sourceCount = computed(() => store.sources.length)
const config = computed(
  () =>
    (isBookSourceKind(currentSourceKind.value)
      ? bookSourceConfig
      : rssSourceConfig) as SourceConfig,
)

watch(
  currentSourceKind,
  kind => {
    const currentRunId = ++loadRunId
    store.syncCurrentSourceKind(kind)
    API.getSources(kind)
      .then(({ data }) => {
        if (currentRunId !== loadRunId) return
        if (data.isSuccess) {
          store.saveSources(data.data, kind)
        } else {
          ElMessage.error(data.errorMsg)
        }
      })
      .catch(error => {
        if (currentRunId === loadRunId) {
          ElMessage.error(`加载源失败：${getErrorMessage(error)}`)
        }
      })
  },
  { immediate: true },
)
</script>
<style lang="scss" scoped>
.editor {
  --editor-panel-bg: rgba(255, 255, 255, 0.82);
  --editor-panel-border: var(--el-border-color-lighter);
  --editor-panel-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
  --editor-radius: 16px;

  display: flex;
  flex-direction: column;
  height: 100dvh;
  box-sizing: border-box;
  gap: 16px;
  padding: 16px 20px;
  overflow: hidden;
  background:
    radial-gradient(circle at 8% 0, rgba(64, 158, 255, 0.1), transparent 30%),
    var(--el-bg-color-page);
}

.editor-header,
.editor-panel {
  box-sizing: border-box;
  border: 1px solid var(--editor-panel-border);
  border-radius: var(--editor-radius);
  background: var(--editor-panel-bg);
  box-shadow: var(--editor-panel-shadow);
  backdrop-filter: blur(10px);
}

.editor-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 16px 18px;

  :deep(.menu) {
    flex: 1 1 520px;
    justify-content: flex-end;
  }
}

.editor-title-block {
  min-width: 260px;

  h1 {
    margin: 2px 0 6px;
    color: var(--el-text-color-primary);
    font-size: 24px;
    line-height: 1.2;
  }

  p {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 13px;
    line-height: 1.6;
  }
}

.editor-eyebrow {
  color: var(--el-color-primary);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.editor-workspace {
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 420px);
  gap: 16px;
  min-height: 0;
}

.editor-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 12px 14px;
  overflow: hidden;
}

:global(html.dark) .editor {
  --editor-panel-bg: rgba(31, 35, 39, 0.82);
  --editor-panel-border: #343a42;
  --editor-panel-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
}

@media screen and (max-width: 960px) {
  .editor {
    gap: 12px;
    padding: 12px;
    overflow: auto;
  }

  .editor-header {
    flex-direction: column;
    gap: 12px;
    padding: 14px;

    :deep(.menu) {
      flex: 0 0 auto;
      width: 100%;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      justify-content: stretch;
    }

    :deep(.menu > .el-button),
    :deep(.menu > .el-dropdown) {
      width: 100%;
    }

    :deep(.menu .el-button > span),
    :deep(.menu .el-dropdown .el-button > span) {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .editor-title-block {
    min-width: 0;

    h1 {
      font-size: 22px;
    }

    p {
      font-size: 12px;
    }
  }

  .editor-workspace {
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .editor-panel--tools {
    order: 1;
  }

  .editor-panel--form {
    order: 2;
  }

  .editor-panel {
    min-height: auto;
    overflow: visible;
    padding: 10px;
  }
}

@media screen and (max-width: 340px) {
  .editor-header {
    :deep(.menu) {
      grid-template-columns: 1fr;
    }
  }
}
</style>
