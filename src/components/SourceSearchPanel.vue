<template>
  <section class="source-search-summary" aria-live="polite">
    <div class="source-search-summary-heading">
      <div>
        <strong class="source-search-title">
          {{ isSearching ? '正在使用书源搜索' : `书源搜索结果：${resultCount} 本` }}
        </strong>
        <span class="source-search-keyword">「{{ keyword }}」</span>
        <div v-if="reports.length > 0" class="source-search-subtitle">
          {{ reportSummaryText }}
        </div>
      </div>
      <div class="source-search-actions">
        <el-button
          size="small"
          type="primary"
          :loading="isSearching"
          @click="emit('retry')"
        >
          重新搜索
        </el-button>
        <el-button size="small" @click="emit('clear')">
          返回本地书架
        </el-button>
        <el-button size="small" @click="emit('manage')">
          管理书源
        </el-button>
      </div>
    </div>

    <div v-if="reports.length > 0" class="source-search-report">
      <el-tag
        v-for="item in reportCountItems"
        :key="item.status"
        :type="item.type"
        effect="plain"
        size="small"
        round
      >
        {{ item.label }} {{ item.count }}
      </el-tag>
    </div>

    <div class="source-search-tip">
      {{ tipText }}
    </div>

    <div v-if="showReportDetails" class="source-search-report-details">
      <div class="source-search-report-details-header">
        <span>{{ reportDetailsTitle }}</span>
        <span v-if="successHidden">成功项默认收起，展开可查看全部源。</span>
      </div>
      <div
        v-for="report in reportDetails"
        :key="`${report.sourceUrl}:${report.status}`"
        class="source-search-report-detail"
        :class="`is-${report.status}`"
        :title="getReportTitle(report)"
      >
        <el-tag size="small" effect="dark" :type="reportTagType(report.status)">
          {{ reportStatusText(report.status) }}
        </el-tag>
        <span class="source-search-report-source">
          {{ report.sourceName }}
        </span>
        <span class="source-search-report-message">
          {{ formatReportMessage(report.message) }}
        </span>
      </div>
      <el-button
        v-if="canToggleReports"
        class="source-search-report-toggle"
        text
        size="small"
        @click="reportsExpanded = !reportsExpanded"
      >
        {{ reportToggleText }}
      </el-button>
    </div>

    <div v-if="topIssues.length > 0" class="source-search-quick-hint">
      <strong>优先处理：</strong>
      <span>{{ topIssues.join('；') }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SourceSearchReport } from '@/book'

type SourceSearchReportTagType = 'success' | 'info' | 'warning' | 'danger'

const props = defineProps<{
  keyword: string
  isSearching: boolean
  resultCount: number
  reports: SourceSearchReport[]
  apiTargetName: string
  reportsExpanded: boolean
}>()

const emit = defineEmits<{
  retry: []
  clear: []
  manage: []
  'update:reportsExpanded': [value: boolean]
}>()

const reportsExpanded = computed({
  get: () => props.reportsExpanded,
  set: value => emit('update:reportsExpanded', value),
})

const reportMeta: Record<
  SourceSearchReport['status'],
  { label: string; type: SourceSearchReportTagType }
> = {
  success: { label: '搜索成功', type: 'success' },
  empty: { label: '请求成功无结果', type: 'info' },
  failed: { label: '请求/解析失败', type: 'danger' },
  unsupported: { label: '规则不支持', type: 'warning' },
  skipped: { label: '已跳过', type: 'info' },
  truncated: { label: '结果截断', type: 'info' },
}

const reportStatusOrder: SourceSearchReport['status'][] = [
  'success',
  'empty',
  'failed',
  'unsupported',
  'skipped',
  'truncated',
]

const reportCounts = computed(() =>
  props.reports.reduce(
    (counts, report) => {
      counts[report.status] += 1
      return counts
    },
    {
      success: 0,
      empty: 0,
      failed: 0,
      unsupported: 0,
      skipped: 0,
      truncated: 0,
    } satisfies Record<SourceSearchReport['status'], number>,
  ),
)

const reportCountItems = computed(() =>
  reportStatusOrder
    .map(status => ({
      status,
      label: reportMeta[status].label,
      type: reportMeta[status].type,
      count: reportCounts.value[status],
    }))
    .filter(item => item.count > 0),
)

const issueStatusPriority: Record<SourceSearchReport['status'], number> = {
  failed: 0,
  unsupported: 1,
  empty: 2,
  skipped: 3,
  truncated: 4,
  success: 5,
}

const issueReports = computed(() =>
  props.reports
    .filter(report => report.status !== 'success' || report.count === 0)
    .slice()
    .sort(
      (left, right) =>
        issueStatusPriority[left.status] - issueStatusPriority[right.status] ||
        left.sourceName.localeCompare(right.sourceName),
    ),
)

const reportPreviewLimit = 8
const reportDetails = computed(() =>
  reportsExpanded.value
    ? props.reports
    : issueReports.value.slice(0, reportPreviewLimit),
)

const hiddenReportCount = computed(() =>
  Math.max(
    0,
    reportsExpanded.value ? 0 : issueReports.value.length - reportPreviewLimit,
  ),
)

const canToggleReports = computed(
  () =>
    reportsExpanded.value || reportDetails.value.length < props.reports.length,
)

const showReportDetails = computed(
  () => reportDetails.value.length > 0 || canToggleReports.value,
)

const successHidden = computed(
  () =>
    !reportsExpanded.value &&
    props.reports.some(report => report.status === 'success' && report.count > 0),
)

const reportToggleText = computed(() =>
  reportsExpanded.value
    ? '收起搜索明细'
    : `查看全部 ${props.reports.length} 条搜索明细`,
)

const reportDetailsTitle = computed(() => {
  if (reportsExpanded.value) return '全部搜索明细'
  if (issueReports.value.length === 0) return '搜索明细'
  return hiddenReportCount.value > 0
    ? `问题明细，另有 ${hiddenReportCount.value} 条已收起`
    : '问题明细'
})

const reportSummaryText = computed(() => {
  const counts = reportCountItems.value
    .map(item => `${item.label} ${item.count}`)
    .join(' · ')
  return counts
    ? `${counts} · 返回结果 ${props.resultCount} 本`
    : `返回结果 ${props.resultCount} 本`
})

const topIssues = computed(() => {
  const messages: string[] = []
  const { failed, unsupported, empty } = reportCounts.value
  if (failed > 0) messages.push(`${failed} 个源请求失败或被目标站拦截`)
  if (unsupported > 0) messages.push(`${unsupported} 个源依赖 JS、Cookie 或登录规则`)
  if (empty > 0) messages.push(`${empty} 个源请求成功但规则未命中`)
  return messages.slice(0, 3)
})

const tipText = computed(() =>
  props.apiTargetName === 'PostgreSQL 持久化'
    ? '点击卡片打开来源站详情；点击“加入书架”会通过生产服务解析详情/目录并保存到 PostgreSQL，阅读章节时按需解析正文并缓存。复杂 JS、登录、CookieJar 和反爬规则仍不支持。'
    : `点击卡片打开来源站详情；点击“加入书架”需要生产服务解析详情/目录并保存，当前为${props.apiTargetName}模式，纯静态/浏览器本地降级模式不支持书源结果入库。复杂 JS、登录、CookieJar 和反爬规则仍不支持。`,
)

const reportStatusText = (status: SourceSearchReport['status']) =>
  reportMeta[status].label

const reportTagType = (status: SourceSearchReport['status']) =>
  reportMeta[status].type

const normalizedMessage = (message: string) => message.replace(/\s+/g, ' ').trim()

const formatReportMessage = (message: string) => {
  const normalized = normalizedMessage(message)
  if (reportsExpanded.value) return normalized
  return normalized.length > 220
    ? `${normalized.slice(0, 220).trimEnd()}…`
    : normalized
}

const getReportTitle = (report: SourceSearchReport) =>
  `${reportStatusText(report.status)} · ${report.sourceName}：${normalizedMessage(report.message)}`
</script>

<style lang="scss" scoped>
.source-search-summary {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  margin-bottom: 18px;
  padding: 16px 18px;
  border: 1px solid var(--shelf-panel-border);
  border-radius: var(--shelf-radius);
  color: var(--shelf-text);
  background: var(--shelf-panel-bg);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
  backdrop-filter: blur(10px);
}

.source-search-summary-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.source-search-title {
  font-size: 16px;
}

.source-search-subtitle {
  margin-top: 6px;
  color: var(--shelf-soft-muted);
  font-size: 13px;
  line-height: 1.5;
}

.source-search-keyword {
  margin-left: 6px;
  color: var(--shelf-muted);
}

.source-search-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;

  :deep(.el-button + .el-button) {
    margin-left: 0;
  }
}

.source-search-report,
.source-search-report-details,
.source-search-tip,
.source-search-quick-hint {
  margin-top: 10px;
  color: var(--shelf-muted);
  font-size: 14px;
  line-height: 1.6;
}

.source-search-report {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.source-search-report-details {
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(248, 250, 252, 0.72);
}

.source-search-report-details-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  color: var(--shelf-soft-muted);
  font-size: 12px;
}

.source-search-report-detail {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  overflow-wrap: anywhere;

  & + .source-search-report-detail {
    border-top: 1px dashed rgba(148, 163, 184, 0.2);
  }
}

.source-search-report-source {
  flex: 0 0 auto;
  max-width: 160px;
  color: var(--shelf-text);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-search-report-message {
  min-width: 0;
  white-space: normal;
}

.source-search-quick-hint {
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(230, 162, 60, 0.1);
}

.source-search-report-toggle {
  margin-top: 4px;
  padding-left: 0;
}

:global(.night) .source-search-report-details {
  border-color: rgba(148, 163, 184, 0.16);
  background: rgba(17, 24, 39, 0.42);
}

:global(.night) .source-search-quick-hint {
  background: rgba(230, 162, 60, 0.14);
}

:global(.night) .source-search-report-detail + .source-search-report-detail {
  border-top-color: rgba(148, 163, 184, 0.14);
}

@media screen and (max-width: 750px) {
  .source-search-summary {
    margin: 16px;
  }

  .source-search-summary-heading,
  .source-search-report-details-header {
    flex-direction: column;
    align-items: stretch;
  }

  .source-search-actions {
    justify-content: flex-start;
  }

  .source-search-keyword {
    display: inline-block;
    max-width: 100%;
    margin-left: 0;
    overflow-wrap: anywhere;
  }

  .source-search-report-source {
    max-width: 42vw;
  }
}
</style>
