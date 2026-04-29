<template>
  <el-dialog
    v-model="visible"
    class="source-search-dialog-window"
    title="搜索在线书籍"
    width="min(560px, calc(100vw - 32px))"
    :teleported="false"
  >
    <div class="source-search-dialog">
      <div class="source-search-dialog-hero">
        <div class="source-search-dialog-icon" aria-hidden="true">
          <el-icon><SearchIcon /></el-icon>
        </div>
        <div>
          <h3>搜索已启用书源</h3>
          <p>
            默认使用“当前 Web 候选”；生产服务可站内预览、解析目录并加入书架。
          </p>
        </div>
      </div>
      <el-input
        ref="keywordInputRef"
        v-model="keywordModel"
        class="source-search-keyword-input"
        size="large"
        placeholder="输入书名、作者或关键词"
        :prefix-icon="SearchIcon"
        aria-label="输入书名、作者或关键词搜索在线书籍"
        @keyup.enter="submitSearch"
      />
      <source-filter-panel
        v-model:keyword="sourceKeywordModel"
        v-model:enabled="enabledModel"
        v-model:feature="featureModel"
        v-model:field="fieldModel"
        compact
        :show-summary="false"
        :defaults="defaultFilters"
        placeholder="筛选参与搜索的书源，例如 起点、name:起点、group:小说、url:qidian、rule:ajax"
        aria-label="筛选参与搜索的书源"
        @reset="emit('resetFilters')"
      />
      <div class="source-search-filter-help">
        筛选支持空格分词和前缀：
        <code>name:</code><code>url:</code><code>group:</code>
        <code>comment:</code
        ><code>rule:</code>。扩大范围可能带来更多不兼容规则。
      </div>
    </div>
    <template #footer>
      <div class="source-search-dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button @click="emit('manage')">书源管理</el-button>
        <el-button
          type="primary"
          :loading="loading"
          :disabled="!canSearch"
          @click="submitSearch"
        >
          开始搜索
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Search as SearchIcon } from '@element-plus/icons-vue'
import type { InputInstance } from 'element-plus'
import SourceFilterPanel from '@/components/SourceFilterPanel.vue'
import type {
  SourceEnabledFilter,
  SourceFeatureFilter,
  SourceSearchField,
} from '@utils/source'
import { SOURCE_BOOK_SEARCH_DEFAULT_FILTER } from '@/utils/sourceSearch'

const props = defineProps<{
  modelValue: boolean
  keyword: string
  sourceKeyword: string
  enabled: SourceEnabledFilter
  feature: SourceFeatureFilter
  field: SourceSearchField
  loading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:keyword': [value: string]
  'update:sourceKeyword': [value: string]
  'update:enabled': [value: SourceEnabledFilter]
  'update:feature': [value: SourceFeatureFilter]
  'update:field': [value: SourceSearchField]
  confirm: []
  manage: []
  resetFilters: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const keywordModel = computed({
  get: () => props.keyword,
  set: (value: string) => emit('update:keyword', value),
})

const sourceKeywordModel = computed({
  get: () => props.sourceKeyword,
  set: (value: string) => emit('update:sourceKeyword', value),
})

const enabledModel = computed<SourceEnabledFilter>({
  get: () => props.enabled,
  set: value => emit('update:enabled', value),
})

const featureModel = computed<SourceFeatureFilter>({
  get: () => props.feature,
  set: value => emit('update:feature', value),
})

const fieldModel = computed<SourceSearchField>({
  get: () => props.field,
  set: value => emit('update:field', value),
})

const canSearch = computed(
  () => keywordModel.value.trim() !== '' && !props.loading,
)

const submitSearch = () => {
  if (!canSearch.value) return
  emit('confirm')
}

const keywordInputRef = ref<InputInstance>()

watch(visible, value => {
  if (!value) return
  void nextTick(() => keywordInputRef.value?.focus())
})

const defaultFilters = SOURCE_BOOK_SEARCH_DEFAULT_FILTER
</script>

<style lang="scss" scoped>
:global(.source-search-dialog-window.el-dialog),
:global(.source-search-dialog-window .el-dialog) {
  overflow: hidden;
  border: 1px solid var(--shelf-panel-border, var(--el-border-color-lighter));
  border-radius: var(--shelf-radius, 16px);
  background: var(--el-bg-color);
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
}

:global(.source-search-dialog-window .el-dialog__header),
:global(.source-search-dialog-window.el-dialog .el-dialog__header),
:global(.source-search-dialog-window .el-dialog__footer),
:global(.source-search-dialog-window.el-dialog .el-dialog__footer) {
  border-color: var(--shelf-panel-border, var(--el-border-color-lighter));
}

:global(.source-search-dialog-window .el-dialog__title),
:global(.source-search-dialog-window.el-dialog .el-dialog__title) {
  color: var(--shelf-text, var(--el-text-color-primary));
  font-weight: 700;
}

.source-search-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;

  :deep(.source-filter-panel) {
    margin-top: 0;
  }
}

.source-search-dialog-hero {
  display: flex;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--shelf-subpanel-border, var(--el-border-color-lighter));
  border-radius: 14px;
  background:
    linear-gradient(135deg, rgba(64, 158, 255, 0.1), transparent 58%),
    var(--shelf-subpanel-bg, var(--el-fill-color-lighter));

  h3 {
    margin: 0;
    color: var(--shelf-text, var(--el-text-color-primary));
    font-size: 16px;
    line-height: 1.35;
  }

  p {
    margin: 4px 0 0;
    color: var(--shelf-muted, var(--el-text-color-secondary));
    line-height: 1.6;
  }
}

.source-search-dialog-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.12);
  font-size: 20px;
}

.source-search-keyword-input {
  :deep(.el-input__wrapper) {
    border-radius: 12px;
  }
}

.source-search-filter-help {
  color: var(--shelf-soft-muted, var(--el-text-color-secondary));
  font-size: 12px;
  line-height: 1.7;

  code {
    padding: 1px 5px;
    border: 1px solid var(--el-border-color-lighter);
    border-radius: 6px;
    color: var(--el-color-primary);
    background: var(--el-fill-color-lighter);
  }

  code + code {
    margin-left: 4px;
  }
}

.source-search-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

@media screen and (max-width: 750px) {
  :global(.source-search-dialog-window.el-dialog),
  :global(.source-search-dialog-window .el-dialog) {
    width: calc(100vw - 24px) !important;
    border-radius: 18px;
  }

  .source-search-dialog-hero {
    padding: 12px;
  }

  .source-search-dialog-footer {
    display: grid;
    grid-template-columns: 1fr 1fr;

    :deep(.el-button) {
      width: 100%;
    }

    :deep(.el-button--primary) {
      grid-column: 1 / -1;
      grid-row: 1;
    }
  }
}
</style>
