import { defineStore } from 'pinia'
import {
  emptyBookSource,
  emptyRssSource,
  getSourceUniqueKey,
  convertSourcesToMap,
} from '@utils/source'
import type { BookSoure, RssSource, Source } from '@/source'
import {
  type SourceKind,
  getCurrentSourceKind,
  isBookSourceKind,
} from '@/utils/sourceKind'

const cloneSource = <T extends Source>(source: T): T =>
  JSON.parse(JSON.stringify(source)) as T
const getEmptySource = (kind: SourceKind) =>
  isBookSourceKind(kind) ? emptyBookSource : emptyRssSource
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
      bookSources: shallowRef([] as BookSoure[]), // 临时存放所有书源,
      rssSources: shallowRef([] as RssSource[]), // 临时存放所有订阅源
      savedSources: [] as Source[], // 批量保存到阅读app成功的源
      currentSource: cloneSource(getEmptySource(currentSourceKind)) as Source, // 当前编辑的源
      currentTab: localStorage.getItem('tabName') || 'editTab',
      editTabSource: {} as Source, // 生成序列化的json数据
      isDebuging: false,
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
        ? (state.currentSource as BookSoure).bookSourceUrl
        : (state.currentSource as RssSource).sourceUrl,
    searchKey: (state): string =>
      isBookSourceKind(state.currentSourceKind)
        ? (state.currentSource as BookSoure)?.ruleSearch?.checkKeyWord || '我的'
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
      this.currentTab = 'editDebug'
      this.isDebuging = true
    },
    debugFinish() {
      this.isDebuging = false
    },

    //拉取源后保存
    saveSources(data: Source[], kind?: SourceKind) {
      const targetKind = kind ?? this.currentSourceKind
      if (isBookSourceKind(targetKind)) {
        this.bookSources = markRaw(data) as BookSoure[]
      } else {
        this.rssSources = markRaw(data) as RssSource[]
      }
    },
    //批量推送
    setPushReturnSources(returnSoures: Source[]) {
      this.savedSources = returnSoures
    },
    //删除源
    deleteSources(data: Source[], kind?: SourceKind) {
      const targetKind = kind ?? this.currentSourceKind
      const sources: Source[] = isBookSourceKind(targetKind)
        ? this.bookSources
        : this.rssSources
      data.forEach(source => {
        const index = sources.indexOf(source)
        if (index > -1) sources.splice(index, 1)
      })
    },
    //保存当前编辑源
    saveCurrentSource() {
      const source = this.currentSource,
        map = this.sourcesMap
      map.set(getSourceUniqueKey(source), JSON.parse(JSON.stringify(source)))
      this.saveSources(Array.from(map.values()), this.currentSourceKind)
    },
    // 更改当前编辑的源qq
    changeCurrentSource(source: Source) {
      this.currentSource = cloneSource(source)
    },
    // update editTab tabName and editTab info
    changeTabName(tabName: string) {
      this.currentTab = tabName
      localStorage.setItem('tabName', tabName)
    },
    changeEditTabSource(source: Source) {
      this.editTabSource = cloneSource(source)
    },
    editHistory(history: Source) {
      let historyObj
      if (localStorage.getItem('history')) {
        historyObj = JSON.parse(localStorage.getItem('history')!)
        historyObj.new.push(history)
        if (historyObj.new.length > 50) {
          historyObj.new.shift()
        }
        if (historyObj.old.length > 50) {
          historyObj.old.shift()
        }
        localStorage.setItem('history', JSON.stringify(historyObj))
      } else {
        const arr = { new: [history], old: [] }
        localStorage.setItem('history', JSON.stringify(arr))
      }
    },
    editHistoryUndo() {
      if (localStorage.getItem('history')) {
        const historyObj = JSON.parse(localStorage.getItem('history')!)
        historyObj.old.push(this.currentSource)
        if (historyObj.new.length) {
          this.currentSource = historyObj.new.pop()
        }
        localStorage.setItem('history', JSON.stringify(historyObj))
      }
    },
    clearAllHistory() {
      localStorage.setItem('history', JSON.stringify({ new: [], old: [] }))
    },
    clearEdit() {
      this.editTabSource = {} as Source
      this.currentSource = cloneSource(getEmptySource(this.currentSourceKind)) //复制一份新对象
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
