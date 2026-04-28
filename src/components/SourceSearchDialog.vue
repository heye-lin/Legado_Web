<template>
  <el-dialog
    v-model="visible"
    class="source-search-dialog-window"
    title="书源搜索"
    width="min(560px, calc(100vw - 32px))"
    :teleported="false"
  >
    <div class="source-search-dialog">
      <p>
        从已导入并启用的书源中搜索书籍。生产服务支持站内预览详情/目录并加入书架；未导入书源时，请先进入书源管理。
      </p>
      <el-input
        v-model="keywordModel"
        placeholder="输入书名、作者或关键词"
        :prefix-icon="SearchIcon"
        aria-label="输入书名、作者或关键词进行书源搜索"
        @keyup.enter="emit('confirm')"
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
        支持空格分隔多个关键词，并支持
        <code>name:</code>、<code>url:</code>、<code>group:</code>、
        <code>comment:</code>、<code>rule:</code> 前缀精确筛选参与搜索的书源。
      </div>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button @click="emit('manage')">书源管理</el-button>
      <el-button type="primary" :loading="loading" @click="emit('confirm')">
        开始搜索
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { Search as SearchIcon } from '@element-plus/icons-vue'
import SourceFilterPanel from '@/components/SourceFilterPanel.vue'
import type {
  SourceEnabledFilter,
  SourceFeatureFilter,
  SourceSearchField,
} from '@utils/source'

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

const defaultFilters = {
  keyword: '',
  enabled: 'enabled',
  feature: 'searchable',
  field: 'all',
} satisfies {
  keyword: string
  enabled: SourceEnabledFilter
  feature: SourceFeatureFilter
  field: SourceSearchField
}
</script>

<style lang="scss" scoped>
.source-search-dialog {
  p {
    margin: 0 0 14px;
    color: var(--shelf-muted, var(--el-text-color-secondary));
    line-height: 1.7;
  }

  :deep(.source-filter-panel) {
    margin-top: 12px;
  }
}

.source-search-filter-help {
  margin-top: 10px;
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
}
</style>
