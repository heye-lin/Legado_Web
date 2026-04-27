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

useDark()

const store = useSourceStore()
const route = useRoute()

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
    store.syncCurrentSourceKind(kind)
    document.title = isBookSourceKind(kind) ? '书源管理' : '订阅源管理'
  },
  { immediate: true },
)
</script>
<style lang="scss" scoped>
.editor {
  display: flex;
  height: 100vh;
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
</style>
