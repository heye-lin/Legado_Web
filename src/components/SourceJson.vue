<template>
  <div class="source-json">
    <el-input
      id="source-json"
      v-model="sourceString"
      class="source-json__editor"
      type="textarea"
      placeholder="这里输出序列化的 JSON 数据，可作为 Legado 兼容源配置保存或导入"
      aria-label="源配置 JSON 编辑器"
      :rows="30"
      @change="update"
    ></el-input>
  </div>
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
.source-json {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

:deep(.source-json__editor) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
}

:deep(.source-json__editor .el-textarea__inner) {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  resize: none;
}

@media screen and (max-width: 960px) {
  .source-json {
    min-height: 20rem;
  }
}
</style>
