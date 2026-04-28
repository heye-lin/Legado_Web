<template>
  <section class="shelf-feature-bar">
    <div class="shelf-feature-text">
      <strong>在线搜书</strong>
      <span>先导入或保存书源，再从在线来源搜索书籍并加入书架。</span>
    </div>
    <div class="shelf-feature-actions">
      <el-button @click="emit('openSourceManager')">书源管理</el-button>
      <el-button type="primary" @click="emit('openSourceSearchDialog')">
        在线搜书
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  openSourceManager: []
  openSourceSearchDialog: []
}>()
</script>

<style lang="scss" scoped>
.shelf-feature-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  gap: 16px;
  margin-bottom: 18px;
  padding: 16px 18px;
  border: 1px solid var(--shelf-panel-border);
  border-radius: var(--shelf-radius);
  color: var(--shelf-text);
  background: var(--shelf-panel-bg);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(10px);
}

.shelf-feature-text {
  display: flex;
  flex-direction: column;
  gap: 6px;

  span {
    color: var(--shelf-muted);
    font-size: 14px;
  }
}

.shelf-feature-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

@media screen and (max-width: 750px) {
  .shelf-feature-bar {
    display: none;
  }
}
</style>
