<template>
  <el-checkbox
    size="large"
    border
    :value="sourceUrl"
    :class="{
      error: isSaveError,
      edit: sourceUrl === currentSourceUrl,
    }"
  >
    <div class="source-item-main">
      <div class="source-item-title-row">
        <span class="source-item-name" :title="sourceName">
          {{ sourceName }}
        </span>
        <span class="source-item-tags">
          <el-tag
            size="small"
            :type="source.enabled ? 'success' : 'info'"
            effect="plain"
          >
            {{ source.enabled ? '启用' : '禁用' }}
          </el-tag>
          <el-tag
            v-if="isSearchable"
            size="small"
            type="primary"
            effect="plain"
          >
            可搜索
          </el-tag>
          <el-tag
            v-if="needsCookieJar"
            size="small"
            type="warning"
            effect="plain"
          >
            CookieJar
          </el-tag>
          <el-tag v-if="usesJs" size="small" type="warning" effect="plain">
            JS
          </el-tag>
        </span>
      </div>
      <div class="source-item-meta" :title="sourceMetaTitle">
        <span>{{ sourceUrl }}</span>
        <span v-if="sourceGroup"> · {{ sourceGroup }}</span>
      </div>
    </div>
    <el-button
      text
      :icon="Edit"
      :title="sourceUrl"
      @click.stop="handleSourceClick(source)"
    />
  </el-checkbox>
</template>

<script setup lang="ts">
import { Edit } from '@element-plus/icons-vue'
import {
  getSourceUniqueKey,
  getSourceName,
  isBookSource,
  sourceHasSearchRule,
  sourceNeedsCookieJar,
  sourceUsesJsRule,
} from '@/utils/source'
import type { Source } from '@/source'

const props = defineProps<{
  source: Source
}>()

const store = useSourceStore()

const currentSourceUrl = computed(() => store.currentSourceUrl)
const sourceName = computed(() => getSourceName(props.source))
const sourceUrl = computed(() => getSourceUniqueKey(props.source))
const sourceGroup = computed(() =>
  isBookSource(props.source)
    ? props.source.bookSourceGroup
    : props.source.sourceGroup,
)
const sourceMetaTitle = computed(() =>
  [sourceUrl.value, sourceGroup.value].filter(Boolean).join(' · '),
)
const isSearchable = computed(() => sourceHasSearchRule(props.source))
const needsCookieJar = computed(() => sourceNeedsCookieJar(props.source))
const usesJs = computed(() => sourceUsesJsRule(props.source))

const handleSourceClick = (source: Source) => {
  store.changeCurrentSource(source)
}
const isSaveError = computed(() => {
  const map = store.savedSourcesMap
  if (map.size === 0) return false
  return !map.has(sourceUrl.value)
})
</script>
<style lang="scss" scoped>
:deep(.el-checkbox__label) {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.source-item-main {
  min-width: 0;
  flex: 1;
}

.source-item-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.source-item-name {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-item-tags {
  display: inline-flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  max-width: 52%;
}

.source-item-meta {
  margin-top: 4px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error {
  border-color: var(--el-color-error) !important;
  color: var(--el-color-error) !important;
  --el-checkbox-checked-text-color: var(--el-color-error);
  --el-checkbox-checked-bg-color: var(--el-color-error);
  --el-checkbox-checked-input-border-color: var(--el-color-error);
}
.edit {
  border-color: var(--el-color-dark) !important;
}
</style>
