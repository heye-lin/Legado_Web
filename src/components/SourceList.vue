<template>
  <el-input
    v-model="searchKey"
    class="search"
    :prefix-icon="Search"
    placeholder="筛选源"
  />
  <div class="tool">
    <el-button @click="importSourceFile" :icon="Folder">导入 JSON</el-button>
    <el-button
      :disabled="sourcesFiltered.length === 0"
      @click="outExport"
      :icon="Download"
    >
      导出</el-button
    >
    <el-button
      type="danger"
      :icon="Delete"
      @click="deleteSelectSources"
      :disabled="sourceSelect.length === 0"
      >删除</el-button
    >
    <el-button
      type="danger"
      :icon="Delete"
      @click="clearAllSources"
      :disabled="sources.length === 0"
      >清空全部</el-button
    >
  </div>
  <div v-if="sources.length === 0" class="empty-source-list">
    暂无源。可使用“URL 订阅”导入订阅地址，或点击“导入 JSON”导入本地源文件。
  </div>
  <div v-else-if="sourcesFiltered.length === 0" class="empty-source-list">
    没有匹配“{{ searchKey.trim() }}”的源，请调整关键词或清空筛选。
  </div>
  <el-checkbox-group id="source-list" v-model="sourceUrlSelect">
    <virtual-list
      v-if="sourcesFiltered.length > 0"
      style="height: 100%; overflow-y: auto; overflow-x: hidden"
      :data-key="(source: Source) => getSourceUniqueKey(source)"
      :data-sources="sourcesFiltered"
      :data-component="SourceItem"
      :estimate-size="45"
    />
  </el-checkbox-group>
</template>

<script setup lang="ts">
import API from '@api'
import { Folder, Delete, Download, Search } from '@element-plus/icons-vue'
import { isSourceMatches, getSourceUniqueKey } from '@utils/source'
import VirtualList from 'vue3-virtual-scroll-list'
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
const sources = computed(() => store.sources)

/* 筛选源 */
const sourcesFiltered = computed<Source[]>(() => {
  const key = searchKey.value
  if (key === '') return sources.value
  return sources.value.filter(source => isSourceMatches(source, key))
})
const filteredSourceKeySet = computed(() =>
  searchKey.value === ''
    ? undefined
    : new Set(sourcesFiltered.value.map(getSourceUniqueKey)),
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
  margin: 4px 0;
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
  height: calc(100vh - 112px - 7px);
  :deep(.el-checkbox) {
    margin-bottom: 4px;
    width: 100%;
  }
}
</style>
