<template>
  <section class="empty-shelf-state">
    <div class="empty-shelf-title">导入 TXT 开始阅读</div>
    <div class="empty-shelf-description">
      <p>选择本地 TXT 文件，或直接拖拽到书架区域导入。</p>
      <p>也可以先进入书源管理导入书源，再搜索在线书籍并加入书架。</p>
    </div>
    <div class="empty-shelf-actions">
      <el-button size="large" @click="emit('importTxt')">导入 TXT</el-button>
      <el-button size="large" @click="emit('openSourceManager')">
        书源管理
      </el-button>
      <el-button
        type="primary"
        size="large"
        @click="emit('openSourceSearchDialog')"
      >
        在线搜书
      </el-button>
    </div>
  </section>
</template>

<script setup lang="ts">
const emit = defineEmits<{
  importTxt: []
  openSourceManager: []
  openSourceSearchDialog: []
}>()
</script>

<style lang="scss" scoped>
.empty-shelf-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: calc(100vh - 96px);
  border: 1px dashed var(--shelf-panel-border);
  border-radius: 18px;
  color: var(--shelf-text);
  text-align: center;
  background: var(--shelf-panel-bg);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
}

.empty-shelf-title {
  margin-bottom: 12px;
  font-size: 24px;
  font-weight: 700;
  font-family: FZZCYSK;
}

.empty-shelf-description {
  margin-bottom: 24px;
  color: var(--shelf-muted);
  font-size: 14px;
  line-height: 1.7;

  p {
    margin: 0;
  }

  p + p {
    margin-top: 4px;
  }
}

.empty-shelf-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

@media screen and (max-width: 750px) {
  .empty-shelf-state {
    min-height: 360px;
    margin: 16px;
    padding: 32px 18px;
  }
}
</style>
