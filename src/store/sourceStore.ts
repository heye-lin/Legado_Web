import { defineStore } from 'pinia'
import {
  createEditableSource,
  normalizeSourceForEdit,
  getSourceUniqueKey,
  convertSourcesToMap,
} from '@utils/source'
import type { BookSource, RssSource, Source } from '@/source'
import {
  type SourceKind,
  getCurrentSourceKind,
  isBookSourceKind,
} from '@/utils/sourceKind'

const cloneSource = <T extends Source>(source: T): T =>
  JSON.parse(JSON.stringify(source)) as T
const getEmptySource = (kind: SourceKind) => createEditableSource(kind)
const normalizeSourcesForKind = (sources: Source[], kind: SourceKind) =>
  sources.map(source => createEditableSource(kind, source))

const sourceMatchesKind = (source: Source, kind: SourceKind) => {
  if (isBookSourceKind(kind)) return !('sourceUrl' in source)
  return !(
    'bookSourceUrl' in source ||
    'bookSourceName' in source ||
    'ruleSearch' in source ||
    'ruleBookInfo' in source ||
    'ruleToc' in source ||
    'ruleExplore' in source
  )
}

export const useSourceStore = defineStore('source', {
  state: () => {
    const currentSourceKind = getCurrentSourceKind()
    return {
      currentSourceKind,
      bookSources: shallowRef([] as BookSource[]), // 临时存放所有书源,
      rssSources: shallowRef([] as RssSource[]), // 临时存放所有订阅源
      savedSources: [] as Source[], // 批量保存成功的源
      currentSource: cloneSource(getEmptySource(currentSourceKind)) as Source, // 当前编辑的源
      currentTab: localStorage.getItem('tabName') || 'editTab',
      editTabSource: {} as Source, // 生成序列化的json数据
      isDebugging: false,
    }
  },
  getters: {
    sources: (state): Source[] =>
      isBookSourceKind(state.currentSourceKind)
        ? state.bookSources
        : state.rssSources,
    sourcesMap: function (): Map<string, Source> {
      return convertSourcesToMap(this.sources)
    },
    savedSourcesMap: (state): Map<string, Source> =>
      convertSourcesToMap(state.savedSources),
    currentSourceUrl: state =>
      isBookSourceKind(state.currentSourceKind)
        ? (state.currentSource as BookSource).bookSourceUrl
        : (state.currentSource as RssSource).sourceUrl,
    searchKey: (state): string =>
      isBookSourceKind(state.currentSourceKind)
        ? (state.currentSource as BookSource)?.ruleSearch?.checkKeyWord ||
          '我的'
        : '',
  },
  actions: {
    syncCurrentSourceKind(kind: SourceKind = getCurrentSourceKind()) {
      const kindChanged = this.currentSourceKind !== kind
      this.currentSourceKind = kind
      if (kindChanged || !sourceMatchesKind(this.currentSource, kind)) {
        this.currentSource = cloneSource(getEmptySource(kind)) as Source
        this.editTabSource = {} as Source
      }
    },
    ensureCurrentSourceKind() {
      this.syncCurrentSourceKind()
    },
    startDebug() {
      this.ensureCurrentSourceKind()
      this.changeTabName('editDebug')
      this.isDebugging = true
    },
    debugFinish() {
      this.isDebugging = false
    },

    //拉取源后保存
    saveSources(data: Source[], kind?: SourceKind) {
      const targetKind = kind ?? this.currentSourceKind
      if (isBookSourceKind(targetKind)) {
        this.bookSources = markRaw(
          normalizeSourcesForKind(data, targetKind),
        ) as BookSource[]
      } else {
        this.rssSources = markRaw(
          normalizeSourcesForKind(data, targetKind),
        ) as RssSource[]
      }
    },
    //批量推送
    setPushReturnSources(returnSources: Source[]) {
      this.savedSources = returnSources
    },
    //删除源
    deleteSources(data: Source[], kind?: SourceKind) {
      const targetKind = kind ?? this.currentSourceKind
      const deleteKeys = new Set(data.map(getSourceUniqueKey))
      const sources = (
        isBookSourceKind(targetKind) ? this.bookSources : this.rssSources
      ).filter(
        source => !deleteKeys.has(getSourceUniqueKey(source)),
      )
      this.saveSources(sources, targetKind)
    },
    //保存当前编辑源
    saveCurrentSource() {
      const source = this.currentSource,
        map = this.sourcesMap
      map.set(getSourceUniqueKey(source), cloneSource(source))
      this.saveSources(Array.from(map.values()), this.currentSourceKind)
    },
    // 更改当前编辑的源
    changeCurrentSource(source: Source) {
      this.currentSource = cloneSource(normalizeSourceForEdit(source))
    },
    // update editTab tabName and editTab info
    changeTabName(tabName: string) {
      this.currentTab = tabName
      localStorage.setItem('tabName', tabName)
    },
    changeEditTabSource(source: Source) {
      this.editTabSource = cloneSource(normalizeSourceForEdit(source))
    },
    clearEdit() {
      this.editTabSource = {} as Source
      this.currentSource = cloneSource(getEmptySource(this.currentSourceKind))
    },

    // clear current source list
    clearAllSource(kind?: SourceKind) {
      const targetKind = kind ?? this.currentSourceKind
      if (isBookSourceKind(targetKind)) {
        this.bookSources = []
      } else {
        this.rssSources = []
      }
      this.savedSources = []
    },
  },
})
