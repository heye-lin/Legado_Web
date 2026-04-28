<template>
  <source-filter-panel
    v-model:keyword="searchKey"
    v-model:enabled="enabledFilter"
    v-model:feature="featureFilter"
    v-model:field="fieldFilter"
    :total="sources.length"
    :matched="sourcesFiltered.length"
    :selected="sourceUrlSelect.length"
    :stats="sourceStats"
    @reset="resetFilters"
  />
  <div class="tool">
    <el-button @click="importSourceFile" :icon="Folder">导入 JSON</el-button>
    <el-button
      :disabled="sourcesFiltered.length === 0"
      @click="outExport"
      :icon="Download"
    >
      {{ exportButtonText }}</el-button
    >
    <el-button
      type="danger"
      :icon="Delete"
      @click="deleteSelectSources"
      :disabled="sourceSelect.length === 0"
      >{{ deleteButtonText }}</el-button
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
    <el-button
      type="danger"
      :icon="Delete"
      @click="clearAllSources"
      :disabled="sources.length === 0"
      >清空全部 {{ sources.length }}</el-button
    >
  </div>
  <div v-if="sources.length === 0" class="empty-source-list">
    暂无源。可使用“URL 订阅”导入订阅地址，或点击“导入 JSON”导入本地源文件。
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
      :estimate-size="76"
    />
  </el-checkbox-group>
</template>

<script setup lang="ts">
import API from '@api'
import { Folder, Delete, Download } from '@element-plus/icons-vue'
import {
  getSourceUniqueKey,
  isSourceMatchesAdvanced,
  sourceHasSearchRule,
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
import { getCurrentSourceKind } from '@/utils/sourceKind'

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
    { enabled: 0, disabled: 0, searchable: 0, complex: 0 },
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

//导入本地文件
const importSourceFile = () => {
  selectJsonFile(async file => {
    if (file === undefined) return ElMessage.info('未选择文件')
    try {
      const kind = getCurrentSourceKind()
      const jsonData = await readSourceConfigFile(file, kind)
      await persistSourceConfig(jsonData, kind)
      store.saveSources(jsonData, kind)
      ElMessage.success(`已导入 ${jsonData.length} 条源`)
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
.tool {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0 4px;
  justify-content: center;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.empty-source-list {
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
  height: calc(100dvh - 262px);
  :deep(.el-checkbox) {
    margin-bottom: 8px;
    width: 100%;
  }
}

@media screen and (max-width: 750px) {
  #source-list {
    height: min(60dvh, 520px);
    min-height: 320px;
  }
}
</style>
