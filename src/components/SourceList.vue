<template>
  <el-input
    v-model="searchKey"
    class="search"
    :prefix-icon="Search"
    placeholder="筛选源"
  />
  <div class="tool">
    <el-button @click="importSourceFile" :icon="Folder">打开</el-button>
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
      >清空</el-button
    >
  </div>
  <el-checkbox-group id="source-list" v-model="sourceUrlSelect">
    <virtual-list
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
import {
  isSourceMatches,
  getSourceUniqueKey,
  convertSourcesToMap,
} from '@utils/source'
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
// 计算当前筛选关键词下的选中源
const sourceSelect = computed<Source[]>(() => {
  const urls = sourceUrlSelect.value
  if (urls.length === 0) return []
  const sourcesFilteredMap =
    searchKey.value === ''
      ? store.sourcesMap
      : convertSourcesToMap(sourcesFiltered.value)
  return urls.reduce((sources, sourceUrl) => {
    const source = sourcesFilteredMap.get(sourceUrl)
    if (source) sources.push(source)
    return sources
  }, [] as Source[])
})

const deleteSelectSources = async () => {
  const kind = getCurrentSourceKind()
  const selectedSources = sourceSelect.value
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
  margin: 4px 0;
  justify-content: center;
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
