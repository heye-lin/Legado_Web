<template>
  <aside class="navigation-wrapper">
    <div class="navigation-title-wrapper">
      <div class="navigation-title">阅读</div>
      <div class="navigation-sub-title">清风不识字，何故乱翻书</div>
    </div>
    <div class="search-wrapper">
      <el-input
        v-model="searchModel"
        :placeholder="searchPlaceholder"
        class="search-input"
        :prefix-icon="SearchIcon"
        :aria-label="searchPlaceholder"
      >
        <template #append>
          <el-button
            :type="isSearchingSources ? 'danger' : 'primary'"
            @click="
              isSearchingSources
                ? emit('clearSourceSearch')
                : emit('sourceSearch')
            "
          >
            {{ isSearchingSources ? '取消' : '在线搜书' }}
          </el-button>
        </template>
      </el-input>
    </div>
    <div class="bottom-wrapper">
      <div class="recent-wrapper">
        <div class="recent-title">最近阅读</div>
        <div class="reading-recent">
          <button
            type="button"
            class="recent-book"
            :class="{ 'is-empty': !hasReadingRecent }"
            :disabled="!hasReadingRecent"
            :aria-label="recentAriaLabel"
            @click="emit('recentClick')"
          >
            {{ readingRecent.name }}
          </button>
        </div>
      </div>
      <div class="setting-wrapper">
        <div class="setting-title">基本设定</div>
        <div class="setting-item">
          <el-tag :type="apiTargetTagType" size="large" class="setting-connect">
            {{ apiTargetName }}
          </el-tag>
          <el-button
            class="standalone-action-button"
            size="small"
            @click="emit('openSourceManager')"
          >
            书源管理
          </el-button>
          <el-button
            class="standalone-action-button source-action-button"
            type="primary"
            size="small"
            @click="emit('openSourceSearchDialog')"
          >
            在线搜书
          </el-button>
          <el-button
            class="standalone-action-button"
            size="small"
            @click="emit('importTxt')"
          >
            导入 TXT
          </el-button>
          <el-button
            class="standalone-action-button"
            size="small"
            @click="emit('exportBackup')"
          >
            导出备份
          </el-button>
          <el-button
            class="standalone-action-button"
            size="small"
            @click="emit('restoreBackup')"
          >
            恢复备份
          </el-button>
          <el-button
            class="standalone-action-button"
            type="danger"
            size="small"
            @click="emit('clearData')"
          >
            清空数据
          </el-button>
        </div>
      </div>
    </div>
    <div class="bottom-icons">
      <a
        href="https://github.com/heye-lin/Legado_Web"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开 Legado Web GitHub 仓库"
      >
        <div class="bottom-icon">
          <img :src="githubUrl" alt="" />
        </div>
      </a>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Search as SearchIcon } from '@element-plus/icons-vue'
import type { ReadingRecentBook } from '@/utils/bookshelf'

type ApiTargetTagType = 'success' | 'warning' | 'info'

const props = defineProps<{
  searchWord: string
  searchPlaceholder: string
  isSearchingSources: boolean
  readingRecent: ReadingRecentBook
  apiTargetName: string
  apiTargetTagType: ApiTargetTagType
  githubUrl: string
}>()

const emit = defineEmits<{
  'update:searchWord': [value: string]
  sourceSearch: []
  clearSourceSearch: []
  recentClick: []
  openSourceManager: []
  openSourceSearchDialog: []
  importTxt: []
  exportBackup: []
  restoreBackup: []
  clearData: []
}>()

const searchModel = computed({
  get: () => props.searchWord,
  set: (value: string) => emit('update:searchWord', value),
})

const hasReadingRecent = computed(() => props.readingRecent.bookUrl !== '')
const recentAriaLabel = computed(() =>
  hasReadingRecent.value
    ? `继续阅读《${props.readingRecent.name}》`
    : '尚无阅读记录',
)
</script>

<style lang="scss" scoped>
.navigation-wrapper {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 260px;
  min-width: 260px;
  min-height: 100vh;
  padding: 48px 36px;
  overflow-y: auto;
  background:
    radial-gradient(
      circle at 16% 4%,
      rgba(64, 158, 255, 0.14),
      transparent 32%
    ),
    var(--shelf-sidebar-bg);
  border-right: 1px solid var(--shelf-panel-border);

  .navigation-title {
    font-size: 24px;
    font-weight: 700;
    font-family: FZZCYSK;
    color: var(--shelf-text);
  }

  .navigation-sub-title {
    margin-top: 16px;
    color: var(--shelf-muted);
    font-size: 16px;
    font-weight: 300;
    font-family: FZZCYSK;
  }

  .search-wrapper {
    .search-input {
      margin-top: 24px;
      border-radius: 50%;

      :deep(.el-input__wrapper) {
        border-color: var(--shelf-panel-border);
        border-radius: 50px;
      }
    }
  }

  .bottom-wrapper {
    display: flex;
    flex-direction: column;
  }

  .recent-wrapper {
    margin-top: 36px;

    .recent-title {
      color: var(--shelf-muted);
      font-size: 14px;
      font-family: FZZCYSK;
    }

    .reading-recent {
      margin: 18px 0;

      .recent-book {
        max-width: 100%;
        min-height: 32px;
        padding: 6px 12px;
        cursor: pointer;
        border: 1px solid var(--el-color-primary-light-5);
        border-radius: 999px;
        color: var(--el-color-primary);
        background: var(--el-color-primary-light-9);
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        transition:
          border-color 0.18s ease,
          color 0.18s ease,
          background-color 0.18s ease;

        &:hover:not(:disabled),
        &:focus-visible:not(:disabled) {
          border-color: var(--el-color-primary);
          background: var(--el-color-primary-light-8);
        }

        &:focus-visible {
          outline: 2px solid var(--el-color-primary);
          outline-offset: 2px;
        }

        &:disabled {
          cursor: not-allowed;
        }

        &.is-empty {
          border-color: var(--el-color-warning-light-5);
          color: var(--el-color-warning);
          background: var(--el-color-warning-light-9);
        }
      }
    }
  }

  .setting-wrapper {
    margin-top: 36px;

    .setting-title {
      color: var(--shelf-muted);
      font-size: 14px;
      font-family: FZZCYSK;
    }

    .setting-connect {
      margin-top: 16px;
      cursor: default;
      font-size: 12px;
    }

    .standalone-action-button {
      margin: 0;
    }

    .source-action-button {
      display: none;
    }

    .setting-item {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin-top: 16px;

      :deep(.el-button + .el-button) {
        margin-left: 0;
      }
    }
  }

  .bottom-icons {
    margin-top: auto;
    padding-top: 32px;
    display: flex;
    flex-direction: row;
    align-items: center;

    .bottom-icon {
      opacity: 0.72;
      transition:
        opacity 0.18s ease,
        transform 0.18s ease;

      &:hover {
        opacity: 1;
        transform: translateY(-2px);
      }
    }
  }
}

@media screen and (max-width: 750px) {
  .navigation-wrapper {
    box-sizing: border-box;
    width: 100%;
    min-height: auto;
    padding: 20px 24px;

    .navigation-title-wrapper {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      white-space: nowrap;
      gap: 12px;
    }

    .navigation-title {
      flex: 0 0 auto;
    }

    .navigation-sub-title {
      min-width: 0;
      overflow: hidden;
      text-align: right;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bottom-wrapper {
      flex-direction: column;

      > * {
        margin-top: 18px;

        .reading-recent,
        .setting-item {
          margin-bottom: 0;
        }
      }
    }

    .setting-wrapper {
      margin-top: 18px;

      .setting-item {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }

      .setting-connect,
      .standalone-action-button {
        margin: 0;
      }

      .standalone-action-button {
        display: inline-flex;
      }
    }

    .bottom-icons {
      display: none;
    }
  }
}

:global(.night) .navigation-wrapper {
  background:
    radial-gradient(
      circle at 16% 4%,
      rgba(64, 158, 255, 0.12),
      transparent 32%
    ),
    var(--shelf-sidebar-bg);

  .navigation-title {
    color: var(--shelf-text);
  }

  .search-wrapper {
    .search-input {
      :deep(.el-input__wrapper) {
        background-color: var(--shelf-subpanel-bg);
      }

      :deep(.el-input__inner) {
        color: var(--shelf-text);
      }
    }
  }
}
</style>
