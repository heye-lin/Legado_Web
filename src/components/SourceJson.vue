<template>
  <el-input
    id="source-json"
    v-model="sourceString"
    type="textarea"
    placeholder="这里输出序列化的 JSON 数据，可作为 Legado 兼容源配置保存或导入"
    aria-label="源配置 JSON 编辑器"
    :rows="30"
    @change="update"
    style="margin-bottom: 4px"
  ></el-input>
</template>
<script setup lang="ts">
import { useSourceStore } from '@/store'

const store = useSourceStore()
const sourceString = ref('')
const update = (string: string) => {
  try {
    store.changeEditTabSource(JSON.parse(string))
  } catch {
    ElMessage({
      message: '粘贴的源格式错误',
      type: 'error',
    })
  }
}

watchEffect(() => {
  const source = store.editTabSource
  if (Object.keys(source).length > 0) {
    sourceString.value = JSON.stringify(source, null, 4)
  } else {
    sourceString.value = ''
  }
})
</script>
<style lang="scss" scoped>
:deep(.el-input) {
  width: 100%;
}
:deep(#source-json) {
  height: calc(100dvh - 50px);
}

@media screen and (max-width: 750px) {
  :deep(#source-json) {
    height: 50dvh;
  }
}
</style>
