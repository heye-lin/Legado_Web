<template>
  <section class="source-search-summary" aria-live="polite">
    <div class="source-search-summary-heading">
      <div class="source-search-heading-copy">
        <span class="source-search-eyebrow">在线搜书</span>
        <h2 class="source-search-title">
          <span>{{ isSearching ? '正在搜索' : resultTitleText }}</span>
          <span class="source-search-keyword">「{{ keyword }}」</span>
        </h2>
        <div v-if="sourceStatItems.length > 0" class="source-search-stats">
          <span v-for="item in sourceStatItems" :key="item">
            {{ item }}
          </span>
        </div>
      </div>
      <div class="source-search-actions">
        <el-button
          size="small"
          type="primary"
          :loading="isSearching"
          :disabled="isSearching"
          @click="emit('retry')"
        >
          {{ isSearching ? '搜索中' : '重新搜索' }}
        </el-button>
        <el-button size="small" @click="emit('clear')">
          {{ isSearching ? '取消搜索' : '返回书架' }}
        </el-button>
        <el-button size="small" @click="emit('manage')"> 管理书源 </el-button>
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
      <span class="source-search-tip-label">提示</span>
      <span>{{ tipText }}</span>
    </div>

    <div v-if="showReportDetails" class="source-search-report-details">
      <div class="source-search-report-details-header">
        <span>{{ reportDetailsTitle }}</span>
        <span v-if="successHidden">已隐藏成功源</span>
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
      <strong>问题提示</strong>
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
  success: { label: '成功', type: 'success' },
  empty: { label: '无结果', type: 'info' },
  failed: { label: '失败', type: 'danger' },
  unsupported: { label: '不支持', type: 'warning' },
  skipped: { label: '跳过', type: 'info' },
  truncated: { label: '截断', type: 'info' },
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

const sourceReports = computed(() =>
  props.reports.filter(report => report.sourceName !== '系统'),
)

const successfulSourceCount = computed(
  () =>
    sourceReports.value.filter(
      report => report.status === 'success' && report.count > 0,
    ).length,
)

const resultTitleText = computed(() => {
  if (props.resultCount > 0) return `找到 ${props.resultCount} 本`
  return '暂无可显示结果'
})

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

const problemSourceCount = computed(
  () =>
    issueReports.value.filter(report => report.sourceName !== '系统').length,
)

const sourceStatItems = computed(() => {
  if (props.reports.length === 0) return []
  const items: string[] = []
  if (sourceReports.value.length > 0) {
    items.push(
      `${successfulSourceCount.value}/${sourceReports.value.length} 个源命中`,
    )
  }
  if (problemSourceCount.value > 0) {
    items.push(`${problemSourceCount.value} 个源需处理`)
  }
  return items
})

const reportPreviewLimit = 5
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
    props.reports.some(
      report => report.status === 'success' && report.count > 0,
    ),
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

const topIssues = computed(() => {
  const messages: string[] = []
  const { failed, unsupported, empty } = reportCounts.value
  if (failed > 0) messages.push(`${failed} 个源请求失败或被拦截`)
  if (unsupported > 0)
    messages.push(`${unsupported} 个源使用 Web 暂不支持的规则`)
  if (empty > 0) messages.push(`${empty} 个源规则未命中`)
  return messages.slice(0, 3)
})

const tipText = computed(() =>
  props.apiTargetName === 'PostgreSQL 持久化'
    ? '点击结果可站内预览详情和目录；加入书架后保存到 PostgreSQL，章节正文按需缓存。不支持复杂 JS、登录、CookieJar 和反爬规则。'
    : `当前为${props.apiTargetName}模式：站内预览和加入书架需要生产服务；不支持复杂 JS、登录、CookieJar 和反爬规则。`,
)

const reportStatusText = (status: SourceSearchReport['status']) =>
  reportMeta[status].label

const reportTagType = (status: SourceSearchReport['status']) =>
  reportMeta[status].type

const normalizedMessage = (message: string) =>
  message.replace(/\s+/g, ' ').trim()

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

.source-search-heading-copy {
  min-width: 0;
}

.source-search-eyebrow {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 9px;
  border: 1px solid rgba(64, 158, 255, 0.18);
  border-radius: 999px;
  color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.08);
  font-size: 12px;
  font-weight: 700;
}

.source-search-title {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin: 8px 0 0;
  color: var(--shelf-text);
  font-size: 18px;
  line-height: 1.35;
}

.source-search-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin-top: 6px;
  color: var(--shelf-soft-muted);
  font-size: 13px;
  line-height: 1.5;

  span + span {
    position: relative;

    &::before {
      position: absolute;
      left: -8px;
      color: var(--shelf-divider, rgba(148, 163, 184, 0.3));
      content: '•';
    }
  }
}

.source-search-keyword {
  min-width: 0;
  color: var(--shelf-muted);
  overflow-wrap: anywhere;
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
  margin-top: 12px;
  color: var(--shelf-muted);
  font-size: 14px;
  line-height: 1.6;
}

.source-search-report {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.source-search-tip,
.source-search-quick-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--shelf-subpanel-border, rgba(148, 163, 184, 0.18));
  border-radius: 12px;
  background: var(--shelf-subpanel-bg, rgba(248, 250, 252, 0.72));
}

.source-search-tip-label,
.source-search-quick-hint strong {
  flex: 0 0 auto;
  color: var(--shelf-text);
  font-size: 13px;
  font-weight: 700;
}

.source-search-report-details {
  max-height: 220px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--shelf-subpanel-border, rgba(148, 163, 184, 0.18));
  border-radius: 12px;
  background: var(--shelf-subpanel-bg, rgba(248, 250, 252, 0.72));
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
    border-top: 1px dashed var(--shelf-divider, rgba(148, 163, 184, 0.2));
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
  border-color: rgba(230, 162, 60, 0.18);
  background: var(--shelf-warning-bg, rgba(230, 162, 60, 0.1));
}

.source-search-report-toggle {
  margin-top: 4px;
  padding-left: 0;
}

@media screen and (max-width: 750px) {
  .source-search-summary {
    margin: 12px;
    padding: 14px;
    border-radius: 18px;
  }

  .source-search-summary-heading,
  .source-search-report-details-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .source-search-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    justify-content: stretch;

    :deep(.el-button) {
      padding-right: 8px;
      padding-left: 8px;
    }
  }

  .source-search-title {
    font-size: 17px;
  }

  .source-search-stats {
    gap: 4px 8px;

    span {
      width: 100%;
    }

    span + span::before {
      content: none;
    }
  }

  .source-search-keyword {
    display: inline-block;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .source-search-tip,
  .source-search-quick-hint {
    flex-direction: column;
    gap: 4px;
  }

  .source-search-report-detail {
    flex-wrap: wrap;
    gap: 6px;
  }

  .source-search-report-source {
    max-width: calc(100% - 80px);
  }

  .source-search-report-message {
    flex-basis: 100%;
  }
}
</style>
