<template>
  <section class="source-list-panel">
    <source-filter-panel
      v-model:keyword="searchKey"
      v-model:enabled="enabledFilter"
      v-model:feature="featureFilter"
      v-model:field="fieldFilter"
      :total="sources.length"
      :matched="sourcesFiltered.length"
      :selected="sourceUrlSelect.length"
      :stats="sourceStats"
      compact
      @reset="resetFilters"
    />
    <div class="tool" role="toolbar" aria-label="源列表操作">
      <div
        class="tool-group tool-group--primary"
        role="group"
        aria-label="主要操作"
      >
        <el-button type="primary" @click="importSourceFile" :icon="Folder">
          导入 JSON（替换）
        </el-button>
        <el-button
          type="primary"
          plain
          :disabled="sourcesFiltered.length === 0"
          @click="outExport"
          :icon="Download"
        >
          {{ exportButtonText }}</el-button
        >
      </div>
      <div
        class="tool-group tool-group--selection"
        role="group"
        aria-label="选择操作"
      >
        <el-button
          :disabled="sourcesFiltered.length === 0"
          @click="selectFilteredSources"
        >
          全选筛选 {{ sourcesFiltered.length }}
        </el-button>
        <el-button
          :disabled="sourceUrlSelect.length === 0"
          @click="sourceUrlSelect = []"
        >
          清空选择
        </el-button>
      </div>
      <div
        class="tool-group tool-group--danger"
        role="group"
        aria-label="危险操作"
      >
        <el-button
          type="danger"
          plain
          :icon="Delete"
          @click="deleteSelectSources"
          :disabled="sourceSelect.length === 0"
          >{{ deleteButtonText }}</el-button
        >
        <el-button
          type="danger"
          :icon="Delete"
          @click="clearAllSources"
          :disabled="sources.length === 0"
          >清空全部 {{ sources.length }}</el-button
        >
      </div>
    </div>
    <div v-if="sources.length === 0" class="empty-source-list">
      暂无源。可使用“URL 订阅（合并）”导入订阅地址，或点击“导入
      JSON（替换）”导入本地源文件。
    </div>
    <div v-else-if="sourcesFiltered.length === 0" class="empty-source-list">
      没有匹配当前筛选条件的源，请调整关键词或清空筛选。
    </div>
    <el-checkbox-group id="source-list" v-model="sourceUrlSelect">
      <virtual-list
        v-if="sourcesFiltered.length > 0"
        style="height: 100%; overflow-y: auto; overflow-x: hidden"
        :data-key="(source: Source) => getSourceUniqueKey(source)"
        :data-sources="sourcesFiltered"
        :data-component="SourceItem"
        :estimate-size="88"
      />
    </el-checkbox-group>
  </section>
</template>

<script setup lang="ts">
import API from '@api'
import { Folder, Delete, Download } from '@element-plus/icons-vue'
import {
  getSourceUniqueKey,
  isSourceMatchesAdvanced,
  sourceHasSearchRule,
  sourceIsWebSearchable,
  sourceNeedsCookieJar,
  sourceNeedsLogin,
  sourceUsesJsRule,
  type SourceEnabledFilter,
  type SourceFeatureFilter,
  type SourceSearchField,
} from '@utils/source'
import VirtualList from 'vue3-virtual-scroll-list'
import SourceFilterPanel from './SourceFilterPanel.vue'
import SourceItem from './SourceItem.vue'
import type { Source } from '@/source'
import { getErrorMessage, selectJsonFile } from '@/utils/jsonFile'
import {
  downloadSourceConfig,
  persistSourceConfig,
  readSourceConfigFile,
} from '@/utils/sourceFile'
import { getCurrentSourceKind, sourceKindDisplayName } from '@/utils/sourceKind'

const store = useSourceStore()
const sourceUrlSelect = ref<string[]>([])
const searchKey = ref('')
const enabledFilter = ref<SourceEnabledFilter>('all')
const featureFilter = ref<SourceFeatureFilter>('all')
const fieldFilter = ref<SourceSearchField>('all')
const sources = computed(() => store.sources)
const hasActiveFilter = computed(
  () =>
    searchKey.value.trim() !== '' ||
    enabledFilter.value !== 'all' ||
    featureFilter.value !== 'all' ||
    fieldFilter.value !== 'all',
)

/* 筛选源 */
const sourcesFiltered = computed<Source[]>(() => {
  if (!hasActiveFilter.value) return sources.value
  return sources.value.filter(source =>
    isSourceMatchesAdvanced(source, searchKey.value, {
      enabled: enabledFilter.value,
      feature: featureFilter.value,
      field: fieldFilter.value,
    }),
  )
})
const filteredSourceKeySet = computed(() =>
  !hasActiveFilter.value
    ? undefined
    : new Set(sourcesFiltered.value.map(getSourceUniqueKey)),
)
const sourceStats = computed(() =>
  sources.value.reduce(
    (stats, source) => {
      if (source.enabled) stats.enabled += 1
      else stats.disabled += 1
      if (sourceIsWebSearchable(source)) stats.web += 1
      if (sourceHasSearchRule(source)) stats.searchable += 1
      if (
        sourceNeedsCookieJar(source) ||
        sourceUsesJsRule(source) ||
        sourceNeedsLogin(source)
      ) {
        stats.complex += 1
      }
      return stats
    },
    { enabled: 0, disabled: 0, web: 0, searchable: 0, complex: 0 },
  ),
)
// 计算当前筛选关键词下的选中源
const sourceSelect = computed<Source[]>(() => {
  const urls = sourceUrlSelect.value
  if (urls.length === 0) return []
  const sourcesMap = store.sourcesMap
  const filteredKeys = filteredSourceKeySet.value
  return urls.reduce((sources, sourceUrl) => {
    if (filteredKeys !== undefined && !filteredKeys.has(sourceUrl)) {
      return sources
    }
    const source = sourcesMap.get(sourceUrl)
    if (source) sources.push(source)
    return sources
  }, [] as Source[])
})
const exportButtonText = computed(() =>
  sourceSelect.value.length > 0
    ? `导出选中 ${sourceSelect.value.length}`
    : !hasActiveFilter.value
      ? `导出全部 ${sources.value.length}`
      : `导出筛选 ${sourcesFiltered.value.length}`,
)
const deleteButtonText = computed(() =>
  sourceSelect.value.length > 0 ? `删除 ${sourceSelect.value.length}` : '删除',
)

const resetFilters = () => {
  searchKey.value = ''
  enabledFilter.value = 'all'
  featureFilter.value = 'all'
  fieldFilter.value = 'all'
}

const selectFilteredSources = () => {
  sourceUrlSelect.value = sourcesFiltered.value.map(getSourceUniqueKey)
}

const deleteSelectSources = async () => {
  const kind = getCurrentSourceKind()
  const selectedSources = sourceSelect.value
  try {
    await ElMessageBox.confirm(
      `确定删除选中的 ${selectedSources.length} 条源？`,
      '删除源',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }
  try {
    const { data } = await API.deleteSource(selectedSources, kind)
    if (!data.isSuccess) {
      ElMessage.error(data.errorMsg)
      return
    }

    store.deleteSources(selectedSources, kind)
    const deletedUrls = new Set(selectedSources.map(getSourceUniqueKey))
    sourceUrlSelect.value = sourceUrlSelect.value.filter(
      url => !deletedUrls.has(url),
    )
  } catch (error) {
    ElMessage.error(`删除源失败：${getErrorMessage(error)}`)
  }
}
const clearAllSources = async () => {
  const kind = getCurrentSourceKind()
  try {
    await ElMessageBox.confirm(
      `确定清空当前全部 ${sources.value.length} 条源？此操作不可撤销，建议先导出备份。`,
      '清空全部源',
      {
        confirmButtonText: '清空全部',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }
  try {
    await persistSourceConfig([], kind)
  } catch (error) {
    return ElMessage.error(getErrorMessage(error))
  }
  store.clearAllSource(kind)
  sourceUrlSelect.value = []
}

const confirmImportReplacement = async (kind = store.currentSourceKind) => {
  if (sources.value.length === 0) return true
  try {
    await ElMessageBox.confirm(
      `导入 JSON 将替换当前全部 ${sources.value.length} 条${sourceKindDisplayName(kind)}。建议先导出备份，确定继续？`,
      '导入 JSON（替换）',
      {
        confirmButtonText: '继续替换',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    return true
  } catch {
    return false
  }
}

//导入本地文件
const importSourceFile = () => {
  selectJsonFile(async file => {
    if (file === undefined) return ElMessage.info('未选择文件')
    try {
      const kind = getCurrentSourceKind()
      const jsonData = await readSourceConfigFile(file, kind)
      if (!(await confirmImportReplacement(kind))) return
      await persistSourceConfig(jsonData, kind)
      store.saveSources(jsonData, kind)
      sourceUrlSelect.value = []
      ElMessage.success(
        `已替换导入 ${jsonData.length} 条${sourceKindDisplayName(kind)}`,
      )
    } catch (error) {
      ElMessage.error('上传的源格式错误: ' + getErrorMessage(error))
    }
  })
}

const outExport = () => {
  const sources =
    sourceUrlSelect.value.length === 0
      ? sourcesFiltered.value
      : sourceSelect.value
  downloadSourceConfig(sources, getCurrentSourceKind())
}
</script>

<style lang="scss" scoped>
.source-list-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.tool {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin: 10px 0 8px;
}

.tool-group {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-fill-color-extra-light);

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.tool-group--primary {
  border-color: var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
}

.tool-group--selection {
  justify-content: center;
}

.tool-group--danger {
  flex-grow: 0;
  border-color: var(--el-color-danger-light-7);
  background: var(--el-color-danger-light-9);
}

.empty-source-list {
  flex: 0 0 auto;
  margin-top: 24px;
  padding: 16px;
  border: 1px dashed var(--el-border-color);
  border-radius: 8px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  text-align: center;
}

#source-list {
  margin-top: 6px;
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;

  :deep(.el-checkbox) {
    margin-bottom: 8px;
    width: 100%;
  }
}

@media screen and (max-width: 960px) {
  .source-list-panel {
    height: auto;
  }

  .tool {
    display: grid;
    grid-template-columns: 1fr;
  }

  .tool-group {
    padding: 6px;
  }

  .tool-group--selection,
  .tool-group--danger {
    justify-content: flex-start;
  }

  #source-list {
    flex: 0 0 auto;
    height: clamp(280px, 58dvh, 420px);
  }
}
</style>
