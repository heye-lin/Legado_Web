<template>
  <div class="editor">
    <source-tab-form class="left" :config="config" />
    <tool-bar />
    <source-tab-tools class="right" />
  </div>
</template>
<script setup lang="ts">
import bookSourceConfig from '@/config/bookSourceEditConfig'
import rssSourceConfig from '@/config/rssSourceEditConfig'
import '@/assets/sourceeditor.css'
import { useDark } from '@vueuse/core'
import type { SourceConfig } from '@/config/sourceConfig'
import { isBookSourceKind, sourceKindFromPath } from '@/utils/sourceKind'
import API from '@api'
import { getErrorMessage } from '@/utils/jsonFile'

useDark()

const store = useSourceStore()
const route = useRoute()
let loadRunId = 0

const currentSourceKind = computed(() => sourceKindFromPath(route.fullPath))
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
    document.title = isBookSourceKind(kind) ? '书源管理' : '订阅源管理'
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
  --editor-radius: 16px;

  display: flex;
  height: 100dvh;
  box-sizing: border-box;
  gap: 16px;
  padding: 16px 20px;
  overflow: hidden;
  background:
    radial-gradient(circle at 8% 0, rgba(64, 158, 255, 0.1), transparent 30%),
    var(--el-bg-color-page);

  .left {
    flex: 1 1 0;
    min-width: 0;
  }

  .right {
    flex: 0 1 380px;
    width: 380px;
    min-width: 320px;
    max-width: 460px;
  }

  .left,
  .right {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-height: 0;
    padding: 12px 14px;
    border: 1px solid var(--editor-panel-border);
    border-radius: var(--editor-radius);
    background: var(--editor-panel-bg);
    box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
    backdrop-filter: blur(10px);
  }
}

:global(html.dark) .editor {
  --editor-panel-bg: rgba(31, 35, 39, 0.82);
  --editor-panel-border: #343a42;
}

@media screen and (max-width: 750px) {
  .editor {
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    overflow: auto;

    :deep(.menu) {
      order: -1;
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--el-bg-color);
      border-bottom: 1px solid var(--el-border-color-light);
    }

    .left,
    .right {
      flex: none;
      width: auto;
      max-width: none;
      min-height: auto;
      min-width: 0;
      padding: 10px;
    }
  }
}
</style>
