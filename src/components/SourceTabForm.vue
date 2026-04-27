<template>
  <el-tabs id="source-edit">
    <el-tab-pane
      v-for="{ name, children } in sourceSections"
      :label="name"
      :key="name"
      lazy
    >
      <el-form label-position="right" label-width="auto">
        <el-form-item
          v-for="{
            type,
            title,
            namespace,
            id,
            array,
            hint,
            required = false,
          } in children"
          :label="title"
          :key="title"
          :required="required"
        >
          <el-input
            v-if="type === 'String' && namespace === undefined"
            type="textarea"
            :model-value="getTextValue(id)"
            :placeholder="hint"
            autosize
            @update:model-value="setFieldValue(id, $event)"
          />
          <el-input
            v-if="type === 'String' && namespace !== undefined"
            type="textarea"
            :model-value="getTextValue(id, namespace)"
            :placeholder="hint"
            autosize
            @update:model-value="setFieldValue(id, $event, namespace)"
          />

          <el-switch
            v-if="type === 'Boolean'"
            :model-value="getBooleanValue(id)"
            @update:model-value="setFieldValue(id, $event)"
          />

          <el-input-number
            v-if="type === 'Number'"
            :model-value="getNumberValue(id)"
            :min="0"
            @update:model-value="setFieldValue(id, $event)"
          />

          <el-select
            v-if="type === 'Array'"
            :model-value="getNumberValue(id)"
            @update:model-value="setFieldValue(id, $event)"
          >
            <el-option
              v-for="(optionName, index) in array"
              :value="index"
              :key="optionName"
              :label="optionName"
            />
          </el-select>
        </el-form-item>
      </el-form>
    </el-tab-pane>
  </el-tabs>
</template>

<script setup lang="ts">
import type { SourceConfig } from '@/config/sourceConfig'

const store = useSourceStore()
const props = defineProps<{ config: SourceConfig }>()
const sourceSections = computed(() => Object.values(props.config))

type SourceFieldValue = string | number | boolean | undefined
type SourceFormSection = Record<string, SourceFieldValue>
type SourceFormModel = Record<string, SourceFieldValue | SourceFormSection>

const currentSource = computed(
  () => store.currentSource as unknown as SourceFormModel,
)

const isFormSection = (
  value: SourceFormModel[string],
): value is SourceFormSection => typeof value === 'object' && value !== null

const ensureSection = (namespace: string) => {
  const section = currentSource.value[namespace]
  if (isFormSection(section)) return section

  const newSection: SourceFormSection = {}
  currentSource.value[namespace] = newSection
  return newSection
}

const getFieldValue = (id: string, namespace?: string) =>
  namespace === undefined
    ? currentSource.value[id]
    : ensureSection(namespace)[id]

const setFieldValue = (
  id: string,
  value: SourceFieldValue,
  namespace?: string,
) => {
  if (namespace === undefined) {
    currentSource.value[id] = value
    return
  }
  ensureSection(namespace)[id] = value
}

const getTextValue = (id: string, namespace?: string) => {
  const value = getFieldValue(id, namespace)
  return typeof value === 'string' || typeof value === 'number' ? value : ''
}
const getBooleanValue = (id: string) => getFieldValue(id) === true
const getNumberValue = (id: string) => {
  const value = getFieldValue(id)
  return typeof value === 'number' ? value : undefined
}
</script>

<style lang="scss" scoped>
:deep(.el-tab-pane) {
  height: calc(100vh - 55px);
  padding-top: 15px;
  padding-right: 5px;
  overflow-y: auto;
}
:deep(.el-tabs__header) {
  margin: 0;
}
</style>
