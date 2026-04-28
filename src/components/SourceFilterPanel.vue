<template>
  <section
    class="source-filter-panel"
    :class="{ 'source-filter-panel--compact': compact }"
  >
    <el-input
      v-model="keywordModel"
      class="source-filter-search"
      clearable
      :prefix-icon="Search"
      :placeholder="placeholder"
      :aria-label="ariaLabel"
    />
    <div class="source-filter-row">
      <el-select v-model="enabledModel" class="source-filter-select">
        <el-option
          v-for="option in SOURCE_ENABLED_FILTER_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-select v-model="featureModel" class="source-filter-select">
        <el-option
          v-for="option in SOURCE_FEATURE_FILTER_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-select v-model="fieldModel" class="source-filter-select">
        <el-option
          v-for="option in SOURCE_SEARCH_FIELD_OPTIONS"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-button
        v-if="showReset"
        :icon="RefreshLeft"
        :disabled="!hasActiveFilter"
        @click="emit('reset')"
      >
        重置筛选
      </el-button>
    </div>
    <div v-if="showSummary" class="source-filter-summary">
      <el-tag v-if="total !== undefined" effect="plain"
        >全部 {{ total }}</el-tag
      >
      <template v-if="stats !== undefined">
        <el-tag type="success" effect="plain">启用 {{ stats.enabled }}</el-tag>
        <el-tag type="info" effect="plain">禁用 {{ stats.disabled }}</el-tag>
        <el-tag type="primary" effect="plain">
          Web 候选 {{ stats.web }}
        </el-tag>
        <el-tag type="primary" effect="plain">
          可搜索 {{ stats.searchable }}
        </el-tag>
        <el-tag type="warning" effect="plain">
          需兼容 {{ stats.complex }}
        </el-tag>
      </template>
      <el-tag v-if="hasActiveFilter && matched !== undefined" type="primary">
        {{ matchedLabel }} {{ matched }}
      </el-tag>
      <el-tag v-if="selected !== undefined && selected > 0" type="success">
        已选 {{ selected }}
      </el-tag>
    </div>
  </section>
</template>

<script setup lang="ts">
import { RefreshLeft, Search } from '@element-plus/icons-vue'
import {
  SOURCE_ENABLED_FILTER_OPTIONS,
  SOURCE_FEATURE_FILTER_OPTIONS,
  SOURCE_SEARCH_FIELD_OPTIONS,
  type SourceEnabledFilter,
  type SourceFeatureFilter,
  type SourceSearchField,
} from '@utils/source'

type SourceFilterStats = {
  enabled: number
  disabled: number
  web: number
  searchable: number
  complex: number
}

type SourceFilterDefaults = {
  keyword: string
  enabled: SourceEnabledFilter
  feature: SourceFeatureFilter
  field: SourceSearchField
}

type SourceFilterPanelProps = {
  keyword: string
  enabled: SourceEnabledFilter
  feature: SourceFeatureFilter
  field: SourceSearchField
  total?: number
  matched?: number
  selected?: number
  stats?: SourceFilterStats
  showSummary?: boolean
  showReset?: boolean
  compact?: boolean
  placeholder?: string
  ariaLabel?: string
  matchedLabel?: string
  defaults?: SourceFilterDefaults
}

const props = withDefaults(defineProps<SourceFilterPanelProps>(), {
  showSummary: true,
  showReset: true,
  compact: false,
  placeholder:
    '筛选源：支持多个关键词，或 name:起点 url:qidian group:小说 rule:bookList',
  ariaLabel: '筛选源',
  matchedLabel: '当前筛选',
})

const emit = defineEmits<{
  'update:keyword': [value: string]
  'update:enabled': [value: SourceEnabledFilter]
  'update:feature': [value: SourceFeatureFilter]
  'update:field': [value: SourceSearchField]
  reset: []
}>()

const keywordModel = computed({
  get: () => props.keyword,
  set: (value: string) => emit('update:keyword', value),
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

const defaultFilter = computed<SourceFilterDefaults>(
  () =>
    props.defaults ?? {
      keyword: '',
      enabled: 'all',
      feature: 'all',
      field: 'all',
    },
)

const hasActiveFilter = computed(
  () =>
    props.keyword.trim() !== defaultFilter.value.keyword.trim() ||
    props.enabled !== defaultFilter.value.enabled ||
    props.feature !== defaultFilter.value.feature ||
    props.field !== defaultFilter.value.field,
)
</script>

<style lang="scss" scoped>
.source-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(64, 158, 255, 0.05), transparent),
    var(--shelf-panel-bg, var(--el-bg-color));
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

.source-filter-panel--compact {
  padding: 10px;
  border-radius: 12px;
  box-shadow: none;
}

.source-filter-row,
.source-filter-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.source-filter-select {
  flex: 1 1 128px;
  min-width: 120px;
}

.source-filter-summary {
  align-items: center;
}

@media screen and (max-width: 750px) {
  .source-filter-row {
    display: grid;
    grid-template-columns: 1fr;
  }

  .source-filter-select {
    min-width: 0;
  }
}
</style>
