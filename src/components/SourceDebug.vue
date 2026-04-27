<template>
  <el-input
    v-if="isBookSource"
    id="debug-key"
    v-model="searchKey"
    placeholder="搜索书名、作者"
    :prefix-icon="Search"
    style="padding-bottom: 4px"
    @keydown.enter="startDebug"
  />
  <el-input
    id="debug-text"
    v-model="printDebug"
    type="textarea"
    readonly
    :rows="29"
    placeholder="这里用于输出调试信息"
  />
</template>

<script setup lang="ts">
import API from '@api'
import { Search } from '@element-plus/icons-vue'
import { isValidSource } from '@/utils/source'
import { isBookSourceKind, sourceKindFromPath } from '@/utils/sourceKind'

const store = useSourceStore()
const route = useRoute()

const printDebug = ref('')
const searchKey = ref('')

watch(
  () => store.isDebugging,
  () => {
    if (store.isDebugging) startDebug()
  },
)

const appendDebugMsg = (msg: string) => {
  const debugDom = document.querySelector('#debug-text')
  debugDom!.scrollTop = debugDom!.scrollHeight
  printDebug.value += msg + '\n'
}
const startDebug = async () => {
  printDebug.value = ''
  const source = store.currentSource
  if (!isValidSource(source)) {
    ElMessage({
      message: `请检查「必填」项是否全部填写`,
      type: 'error',
    })
    store.debugFinish()
    return
  }
  try {
    await API.saveSource(source, sourceKind.value)
  } catch (e) {
    store.debugFinish()
    throw e
  }
  API.debug(
    store.currentSourceUrl,
    searchKey.value || store.searchKey,
    appendDebugMsg,
    store.debugFinish,
    sourceKind.value,
  )
}

const sourceKind = computed(() => sourceKindFromPath(route.fullPath))
const isBookSource = computed(() => isBookSourceKind(sourceKind.value))
</script>

<style lang="scss" scoped>
:deep(#debug-text) {
  height: calc(100vh - 45px - 36px - 5px);
}
</style>
