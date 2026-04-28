<template>
  <el-tabs v-model="current_tab" class="source-tab-tools">
    <el-tab-pane
      v-for="tab in tabData"
      :key="tab[0]"
      :name="tab[0]"
      :label="tab[1]"
    >
      <source-json v-if="tab[0] === 'editTab'" />
      <source-debug v-if="tab[0] === 'editDebug'" />
      <source-list v-if="tab[0] === 'editList'" />
      <source-help v-if="tab[0] === 'editHelp'" />
    </el-tab-pane>
  </el-tabs>
</template>

<script setup lang="ts">
import { useSourceStore } from '@/store'
import { sourceKindDisplayName } from '@/utils/sourceKind'

const store = useSourceStore()
const sourceDisplayName = computed(() =>
  sourceKindDisplayName(store.currentSourceKind),
)

const current_tab = computed({
  get: () => store.currentTab,
  set: tabName => store.changeTabName(tabName),
})

const tabData = computed(
  () =>
    [
      ['editList', `${sourceDisplayName.value}列表`],
      ['editTab', `编辑${sourceDisplayName.value}`],
      ['editDebug', `调试${sourceDisplayName.value}`],
      ['editHelp', '帮助信息'],
    ] as const,
)
</script>

<style lang="scss" scoped>
.source-tab-tools {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

:deep(.el-tabs__header) {
  order: -1;
  flex: 0 0 auto;
  margin: 0 0 12px;
  padding: 0 2px;
}

:deep(.el-tabs__content) {
  flex: 1 1 auto;
  min-height: 0;
}

:deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
  overflow: auto;
}

@media screen and (max-width: 960px) {
  :deep(.el-tab-pane) {
    height: auto;
    overflow: visible;
  }
}
</style>
