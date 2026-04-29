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
  position: relative;
  width: 100%;
  max-width: 920px;
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: clamp(380px, 58vh, 560px);
  padding: 40px 36px;
  border: 1px dashed var(--shelf-panel-border);
  border-radius: 22px;
  color: var(--shelf-text);
  text-align: center;
  background:
    radial-gradient(circle at top, rgba(64, 158, 255, 0.08), transparent 38%),
    var(--shelf-panel-bg);
  box-shadow: var(--shelf-card-shadow, 0 12px 32px rgba(15, 23, 42, 0.06));

  &::before {
    position: absolute;
    inset: 16px;
    border: 1px solid rgba(64, 158, 255, 0.08);
    border-radius: 18px;
    pointer-events: none;
    content: '';
  }
}

.empty-shelf-title {
  margin-bottom: 12px;
  font-size: 22px;
  font-weight: 700;
  font-family: FZZCYSK;
  line-height: 1.3;
}

.empty-shelf-description {
  margin-bottom: 24px;
  max-width: 560px;
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

  :deep(.el-button) {
    min-width: 112px;
    border-radius: 999px;
  }

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

@media screen and (max-width: 750px) {
  .empty-shelf-state {
    width: auto;
    max-width: none;
    min-height: 320px;
    margin: 0;
    padding: 28px 16px;
    border-radius: 18px;

    &::before {
      inset: 12px;
      border-radius: 14px;
    }
  }

  .empty-shelf-title {
    font-size: 20px;
  }

  .empty-shelf-actions {
    width: 100%;

    :deep(.el-button) {
      flex: 1 1 112px;
      min-width: 0;
    }
  }
}
</style>
