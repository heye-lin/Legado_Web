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
  display: flex;
  height: 100dvh;
  overflow: hidden;
  .left {
    flex: 1;
    margin-left: 20px;
  }
  .right {
    flex: 1;
    width: 360px;
    margin-right: 20px;
  }
}

@media screen and (max-width: 750px) {
  .editor {
    flex-direction: column;
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
      min-height: auto;
      margin: 0 12px;
    }
  }
}
</style>
