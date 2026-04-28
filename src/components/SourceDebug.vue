<template>
  <div class="source-debug">
    <el-input
      v-if="isBookSource"
      id="debug-key"
      v-model="searchKey"
      class="source-debug__key"
      placeholder="搜索书名、作者"
      :prefix-icon="Search"
      aria-label="调试搜索关键词"
      @keydown.enter="startDebug"
    />
    <el-input
      ref="debugTextRef"
      id="debug-text"
      v-model="printDebug"
      class="source-debug__output"
      type="textarea"
      readonly
      :rows="29"
      placeholder="这里用于输出调试信息"
      aria-label="源调试输出"
    />
  </div>
</template>

<script setup lang="ts">
import API from '@api'
import type { InputInstance } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import { isValidSource } from '@/utils/source'
import { isBookSourceKind, sourceKindFromPath } from '@/utils/sourceKind'

const store = useSourceStore()
const route = useRoute()

const printDebug = ref('')
const searchKey = ref('')
const debugTextRef = ref<InputInstance>()
let debugCancel: (() => void) | undefined
let debugRunId = 0

watch(
  () => store.isDebugging,
  () => {
    if (store.isDebugging) startDebug()
  },
)

const cancelCurrentDebug = () => {
  debugCancel?.()
  debugCancel = undefined
}

const appendDebugMsg = (msg: string) => {
  printDebug.value += `${msg}\n`
  void nextTick(() => {
    const textarea = debugTextRef.value?.textarea
    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight
    }
  })
}
const startDebug = async () => {
  const currentRunId = ++debugRunId
  cancelCurrentDebug()
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
    if (currentRunId === debugRunId) store.debugFinish()
    throw e
  }
  if (currentRunId !== debugRunId) return
  debugCancel = API.debug(
    store.currentSourceUrl,
    searchKey.value || store.searchKey,
    appendDebugMsg,
    () => {
      if (currentRunId !== debugRunId) return
      debugCancel = undefined
      store.debugFinish()
    },
    sourceKind.value,
  )
}

const sourceKind = computed(() => sourceKindFromPath(route.fullPath))
const isBookSource = computed(() => isBookSourceKind(sourceKind.value))

onUnmounted(() => {
  debugRunId += 1
  cancelCurrentDebug()
  store.debugFinish()
})
</script>

<style lang="scss" scoped>
.source-debug {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
}

:deep(.source-debug__key) {
  flex: 0 0 auto;
}

:deep(.source-debug__output) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

:deep(.source-debug__output .el-textarea__inner) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  resize: none;
}

@media screen and (max-width: 960px) {
  .source-debug {
    min-height: 20rem;
  }
}
</style>
