<template>
  <div class="menu" aria-label="源管理操作">
    <el-button @click="openShelf">返回书架</el-button>
    <el-button
      v-for="button in primaryButtons"
      :key="button.key"
      :type="button.type"
      @click="button.action"
    >
      {{ getButtonName(button) }}
    </el-button>
    <el-dropdown trigger="click" @command="runToolbarCommand">
      <el-button>
        更多操作
        <el-icon class="el-icon--right"><ArrowDown /></el-icon>
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="button in moreButtons"
            :key="button.key"
            :command="button.key"
          >
            {{ getButtonName(button) }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
    <el-button @click="() => (hotkeysDialogVisible = true)">快捷键</el-button>
  </div>
  <el-dialog
    v-model="subscriptionDialogVisible"
    title="URL 订阅（合并）"
    width="min(460px, calc(100vw - 32px))"
  >
    <div class="subscription-dialog">
      <p>输入书源或订阅源 JSON 地址。当前会合并导入，不会清空已有本地源。</p>
      <el-input
        v-model="subscriptionUrl"
        placeholder="https://shuyuan.yiove.com/sub.json"
        aria-label="URL 订阅地址"
        @keyup.enter="importSubscription"
      />
    </div>
    <template #footer>
      <el-button @click="subscriptionDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="isImportingSubscription"
        @click="importSubscription"
      >
        合并导入
      </el-button>
    </template>
  </el-dialog>
  <el-dialog
    v-model="hotkeysDialogVisible"
    :show-close="false"
    :before-close="stopRecordKeyDown"
  >
    <template #header="{ titleClass, titleId }">
      <div class="hotkeys-header flex-space-between">
        <div :id="titleId" :class="titleClass">
          快捷键设置
          <span v-if="recordKeyDowning">
            <el-text> / 录入中 </el-text>
          </span>
        </div>
        <el-button
          :disabled="recordKeyDowning"
          @click="saveHotKeys"
          :icon="CircleCheckFilled"
          >保存</el-button
        >
      </div>
    </template>

    <div class="hotkeys-settings flex-column-center">
      <div
        v-for="(button, buttonIndex) in buttons"
        :key="button.key"
        class="hotkeys-item flex-space-between"
      >
        <span class="title"
          ><el-text>{{ getButtonName(button) }}</el-text></span
        >
        <div class="hotkeys-item__content">
          <div v-for="(key, hotKeysIndex) in button.hotKeys" :key="key">
            <kbd>{{ key }}</kbd>
            <span v-if="hotKeysIndex + 1 < button.hotKeys.length">
              <el-text>+</el-text>
            </span>
          </div>
          <span v-if="button.hotKeys.length === 0">未设置</span>
        </div>
        <el-button
          :disabled="recordKeyDowning"
          text
          :icon="Edit"
          @click="recordKeyDown(buttonIndex)"
          >编辑</el-button
        >
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import API, { getApiTargetName } from '@api'
import { ArrowDown, CircleCheckFilled, Edit } from '@element-plus/icons-vue'
import hotkeys from 'hotkeys-js'
import { getErrorMessage, selectJsonFile } from '@utils/jsonFile'
import { getSourceName, isValidSource, normalizeSource } from '../utils/source'
import {
  downloadSourceConfig,
  mergeSourceConfig,
  persistSourceConfig,
  readSourceConfigFile,
  readSourceSubscriptionUrl,
} from '@/utils/sourceFile'
import {
  getCurrentSourceKind,
  sourceKindDisplayName,
  type SourceKind,
} from '@/utils/sourceKind'

const store = useSourceStore()
const router = useRouter()
const sourceDisplayName = computed(() =>
  sourceKindDisplayName(store.currentSourceKind),
)
type ToolButton = {
  key: string
  name: string | (() => string)
  hotKeys: string[]
  action: () => void
  type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  placement: 'primary' | 'more'
}
const subscriptionDialogVisible = ref(false)
const subscriptionUrl = ref('')
const isImportingSubscription = ref(false)
const openShelf = () => {
  router.push({ path: '/' })
}

const pull = () => {
  const kind = getCurrentSourceKind()
  const loadingMsg = ElMessage({
    message: '正在重新加载源……',
    showClose: true,
    duration: 0,
  })
  API.getSources(kind)
    .then(({ data }) => {
      if (data.isSuccess) {
        store.saveSources(data.data, kind)
        if (store.currentSourceKind === kind) store.changeTabName('editList')
        ElMessage({
          message: `已重新加载 ${data.data.length} 条${sourceKindDisplayName(kind)}`,
          type: 'success',
        })
      } else {
        ElMessage({
          message: data.errorMsg ?? '源数据错误',
          type: 'error',
        })
      }
    })
    .catch(error => {
      ElMessage.error(`重新加载源失败：${getErrorMessage(error)}`)
    })
    .finally(() => loadingMsg.close())
}

const push = () => {
  const kind = getCurrentSourceKind()
  const sources = store.sources
  store.changeTabName('editList')
  if (sources.length === 0) {
    return ElMessage({
      message: `当前没有可保存的${sourceDisplayName.value}，请先导入或编辑源`,
      type: 'info',
    })
  }
  ElMessage({
    message: `正在保存到「${getApiTargetName()}」`,
    type: 'info',
  })
  API.saveSources(sources, kind)
    .then(({ data }) => {
      if (data.isSuccess) {
        const okData = data.data
        if (Array.isArray(okData)) {
          let failMsg = ``
          if (sources.length > okData.length) {
            failMsg = '\n保存失败的源将用红色字体标注!'
            store.setPushReturnSources(okData)
          }
          ElMessage({
            message: `批量保存源到「${getApiTargetName()}」\n共计：${
              sources.length
            } 条\n成功：${okData.length} 条\n失败：${
              sources.length - okData.length
            } 条${failMsg}`,
            type: 'success',
          })
        }
      } else {
        ElMessage({
          message: `批量保存源失败！\n错误信息：${data.errorMsg}`,
          type: 'error',
        })
      }
    })
    .catch(error => {
      ElMessage.error(`保存源失败：${getErrorMessage(error)}`)
    })
}

const convertToTab = () => {
  store.changeTabName('editTab')
  store.changeEditTabSource(store.currentSource)
}
const convertToSource = () => {
  store.changeCurrentSource(store.editTabSource)
}

const clearEdit = () => {
  store.clearEdit()
  ElMessage({
    message: '已清除',
    type: 'success',
  })
}

const saveSource = () => {
  const kind = getCurrentSourceKind()
  const source = store.currentSource
  if (isValidSource(source)) {
    normalizeSource(source)
    API.saveSource(source, kind)
      .then(({ data }) => {
        const sourceName = getSourceName(source)
        if (data.isSuccess) {
          ElMessage({
            message: `源《${sourceName}》已成功保存到「${getApiTargetName()}」`,
            type: 'success',
          })
          // 保存到 store
          store.saveCurrentSource()
        } else {
          ElMessage({
            message: `源《${sourceName}》保存失败！\n错误信息：${data.errorMsg}`,
            type: 'error',
          })
        }
      })
      .catch(error => {
        ElMessage.error(`保存源失败：${getErrorMessage(error)}`)
      })
  } else {
    ElMessage({
      message: `请检查「必填」项是否全部填写`,
      type: 'error',
    })
  }
}

const debug = () => {
  store.startDebug()
}

const exportSources = () => {
  const sources = store.sources
  if (sources.length === 0) {
    ElMessage({
      message: `当前没有可导出的${sourceDisplayName.value}`,
      type: 'info',
    })
    return
  }

  downloadSourceConfig(sources, getCurrentSourceKind())
  ElMessage({
    message: `已导出 ${sources.length} 条${sourceDisplayName.value}`,
    type: 'success',
  })
}

const confirmReplaceSources = async (count: number, kind: SourceKind) => {
  if (count === 0) return true
  try {
    await ElMessageBox.confirm(
      `导入 JSON 会替换当前全部 ${count} 条${sourceKindDisplayName(kind)}，建议先导出备份。确定继续？`,
      '导入 JSON（替换）',
      {
        confirmButtonText: '替换导入',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
    return true
  } catch {
    return false
  }
}

const importSourcesFromFile = async (file: File) => {
  const kind = getCurrentSourceKind()
  const sources = await readSourceConfigFile(file, kind)
  if (!(await confirmReplaceSources(store.sources.length, kind))) return
  await persistSourceConfig(sources, kind)
  store.saveSources(sources, kind)
  if (store.currentSourceKind === kind) store.changeTabName('editList')
  ElMessage({
    message: `已替换导入 ${sources.length} 条${sourceKindDisplayName(kind)}`,
    type: 'success',
  })
}

const importSources = () => {
  selectJsonFile(async file => {
    if (file === undefined) {
      ElMessage({ message: '未选择源配置 JSON 文件', type: 'info' })
      return
    }

    try {
      await importSourcesFromFile(file)
    } catch (error) {
      ElMessage({
        message: `导入失败：${getErrorMessage(error)}`,
        type: 'error',
      })
    }
  })
}

const openSubscriptionDialog = () => {
  subscriptionDialogVisible.value = true
}

const importSubscription = async () => {
  const url = subscriptionUrl.value.trim()
  if (url === '') {
    ElMessage.info('请输入订阅 URL')
    return
  }

  isImportingSubscription.value = true
  const loadingMsg = ElMessage({
    message: '正在拉取订阅……',
    showClose: true,
    duration: 0,
  })
  try {
    const subscription = await readSourceSubscriptionUrl(url)
    if (
      subscription.bookSources.length === 0 &&
      subscription.rssSources.length === 0
    ) {
      ElMessage.warning('订阅中没有可导入的源')
      return
    }

    const messages: string[] = []
    if (subscription.bookSources.length > 0) {
      const result = await mergeSourceConfig(
        subscription.bookSources,
        'bookSource',
      )
      store.saveSources(result.sources, 'bookSource')
      messages.push(
        `书源 ${subscription.bookSources.length} 条（新增 ${result.added}，更新 ${result.updated}）`,
      )
    }
    if (subscription.rssSources.length > 0) {
      const result = await mergeSourceConfig(
        subscription.rssSources,
        'rssSource',
      )
      store.saveSources(result.sources, 'rssSource')
      messages.push(
        `订阅源 ${subscription.rssSources.length} 条（新增 ${result.added}，更新 ${result.updated}）`,
      )
    }
    messages.push(...subscription.notes)

    const targetKind =
      subscription.bookSources.length > 0 ? 'bookSource' : 'rssSource'
    subscriptionDialogVisible.value = false
    if (store.currentSourceKind !== targetKind) {
      await router.push({
        path: targetKind === 'bookSource' ? '/bookSource' : '/rssSource',
      })
    } else {
      store.changeTabName('editList')
    }
    const message = `URL 订阅（合并）完成：${messages.join('；')}`
    if (subscription.bookSources.length === 0) {
      ElMessage.warning(
        `${message}；本次没有导入可搜索书源，书籍搜索仍需要 bookSourceUrl/bookSourceName 书源。`,
      )
    } else {
      ElMessage.success(message)
    }
  } catch (error) {
    ElMessage.error(`URL 订阅导入失败：${getErrorMessage(error)}`)
  } finally {
    isImportingSubscription.value = false
    loadingMsg.close()
  }
}

const buttons = ref<ToolButton[]>(
  Array.of(
    {
      key: 'save-all',
      name: () => `保存全部${sourceDisplayName.value}`,
      hotKeys: [],
      action: push,
      type: 'primary',
      placement: 'primary',
    },
    {
      key: 'reload',
      name: () => `重新加载${sourceDisplayName.value}`,
      hotKeys: [],
      action: pull,
      placement: 'more',
    },
    {
      key: 'to-json',
      name: '生成 JSON',
      hotKeys: [],
      action: convertToTab,
      placement: 'more',
    },
    {
      key: 'from-json',
      name: '从 JSON 编辑',
      hotKeys: [],
      action: convertToSource,
      placement: 'more',
    },
    {
      key: 'clear',
      name: '清空表单',
      hotKeys: [],
      action: clearEdit,
      placement: 'more',
    },
    {
      key: 'debug',
      name: () => `调试${sourceDisplayName.value}`,
      hotKeys: [],
      action: debug,
      placement: 'primary',
    },
    {
      key: 'save-current',
      name: () => `保存当前${sourceDisplayName.value}`,
      hotKeys: [],
      action: saveSource,
      type: 'success',
      placement: 'primary',
    },
    {
      key: 'export',
      name: () => `导出全部${sourceDisplayName.value}`,
      hotKeys: [],
      action: exportSources,
      placement: 'more',
    },
    {
      key: 'import',
      name: '导入 JSON（替换）',
      hotKeys: [],
      action: importSources,
      placement: 'more',
    },
    {
      key: 'subscribe',
      name: 'URL 订阅（合并）',
      hotKeys: [],
      action: openSubscriptionDialog,
      placement: 'primary',
    },
  ),
)
const getButtonName = (button: ToolButton) =>
  typeof button.name === 'function' ? button.name() : button.name
const primaryButtons = computed(() =>
  buttons.value.filter(button => button.placement === 'primary'),
)
const moreButtons = computed(() =>
  buttons.value.filter(button => button.placement === 'more'),
)
const runToolbarCommand = (command: string | number | object) => {
  if (typeof command !== 'string') return
  buttons.value.find(button => button.key === command)?.action()
}
const hotkeysDialogVisible = ref(false)

const recordKeyDowning = ref(false)

const recordKeyDownIndex = ref(-1)
const defaultHotkeysFilter = hotkeys.filter
const boundHotKeyCombos = new Set<string>()

const unbindRecorderHotkeys = () => {
  hotkeys.unbind('*')
}

const unbindActionHotkeys = () => {
  boundHotKeyCombos.forEach(combo => hotkeys.unbind(combo))
  boundHotKeyCombos.clear()
}

const stopRecordKeyDown = () => {
  if (!recordKeyDowning.value) {
    hotkeysDialogVisible.value = false
  }
  recordKeyDowning.value = false
}

watch(
  hotkeysDialogVisible,
  (visible, _, onCleanup) => {
    if (!visible) {
      unbindRecorderHotkeys()
      readHotkeysConfig()
      unbindActionHotkeys()
      bindHotKeys()
      return
    }
    readHotkeysConfig()
    unbindActionHotkeys()
    unbindRecorderHotkeys()
    /** 监听按键 */
    hotkeys('*', event => {
      event.preventDefault()
      const pressedKeys = hotkeys.getPressedKeyString()
      if (pressedKeys.length === 1 && pressedKeys[0] === 'esc') {
        // 单独按下 ESC 不录入
        return
      }
      if (recordKeyDowning.value && recordKeyDownIndex.value > -1)
        buttons.value[recordKeyDownIndex.value].hotKeys = pressedKeys
    })
    onCleanup(unbindRecorderHotkeys)
  },
  { immediate: true },
)

const recordKeyDown = (index: number) => {
  recordKeyDowning.value = true
  ElMessage({
    message: '按 ESC 键或者点击空白处结束录入',
    type: 'info',
  })
  buttons.value[index].hotKeys = []
  recordKeyDownIndex.value = index
}

const saveHotKeys = () => {
  const hotKeysConfig: string[][] = []
  buttons.value.forEach(({ hotKeys }) => {
    hotKeysConfig.push(hotKeys)
  })
  saveHotkeysConfig(hotKeysConfig)
  hotkeysDialogVisible.value = false
}

const isEditingText = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  target.closest('input, textarea, [contenteditable="true"]') !== null

const bindHotKeys = () => {
  hotkeys.filter = () => true
  buttons.value.forEach(({ hotKeys, action }) => {
    if (hotKeys.length === 0) return
    const combo = hotKeys.join('+')
    hotkeys(combo, event => {
      if (isEditingText(event.target)) return
      event.preventDefault()
      action.call(null)
    })
    boundHotKeyCombos.add(combo)
  })
}
const saveHotkeysConfig = (config: string[][]) => {
  localStorage.setItem('legado_web_hotkeys', JSON.stringify(config))
}

/**
 * 读取快捷键配置
 * @return 是否成功读取配置
 */
function readHotkeysConfig() {
  try {
    const localStorageConfig = localStorage.getItem('legado_web_hotkeys')
    if (localStorageConfig === null) return false
    const config = JSON.parse(localStorageConfig)
    if (!Array.isArray(config) || config.length === 0) return false
    buttons.value.forEach((button, index) => {
      const hotKeys = config[index]
      button.hotKeys = Array.isArray(hotKeys)
        ? hotKeys.filter((key): key is string => typeof key === 'string')
        : []
    })
    return true
  } catch {
    ElMessage({ message: '快捷键配置错误', type: 'error' })
    localStorage.removeItem('legado_web_hotkeys')
  }
  return false
}

onMounted(readHotkeysConfig)

onUnmounted(() => {
  unbindRecorderHotkeys()
  unbindActionHotkeys()
  hotkeys.filter = defaultHotkeysFilter
})
</script>

<style lang="scss" scoped>
.flex-space-between {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.flex-column-center {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.menu {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.menu > .el-button,
.menu :deep(.el-dropdown) {
  margin: 0;
  min-width: 0;
  max-width: 100%;
}

.menu > .el-button {
  justify-content: center;
}

.menu :deep(.el-dropdown .el-button) {
  width: 100%;
  margin: 0;
}

.menu :deep(.el-button > span),
.menu :deep(.el-dropdown .el-button > span) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscription-dialog {
  p {
    margin: 0 0 14px;
    color: var(--el-text-color-secondary);
    line-height: 1.7;
  }
}

.hotkeys-item {
  .title {
    width: 5em;
    display: flex;
    justify-content: flex-end;
    margin-right: 1em;
  }
  .hotkeys-item__content {
    display: flex;
    flex-wrap: wrap;
    flex: 1;
    div {
      margin-bottom: 1em;
    }
    span {
      margin: 0.5em;
    }
  }
}

@media screen and (max-width: 960px) {
  .menu {
    flex-direction: row;
    justify-content: flex-start;
  }

  .menu > .el-button,
  .menu :deep(.el-dropdown) {
    width: auto;
  }
}
</style>
