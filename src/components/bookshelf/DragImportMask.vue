<template>
  <div
    class="drag-import-mask"
    role="status"
    aria-live="polite"
    aria-label="释放鼠标导入 TXT 文件"
  >
    <div class="drag-import-title">释放鼠标导入 TXT</div>
    <div class="drag-import-description">{{ description }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  description: string
}>()
</script>

<style lang="scss" scoped>
.drag-import-mask {
  position: absolute;
  inset: 32px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 2px dashed var(--el-color-primary);
  border-radius: 18px;
  color: var(--el-color-primary);
  background: var(--shelf-drag-mask-bg);
  pointer-events: none;
}

.drag-import-title {
  margin-bottom: 10px;
  font-size: 24px;
  font-weight: 700;
}

.drag-import-description {
  color: var(--shelf-muted);
  font-size: 14px;
}

@media screen and (max-width: 750px) {
  .drag-import-mask {
    inset: 12px;
  }
}
</style>
