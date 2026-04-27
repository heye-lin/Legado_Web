<template>
  <div class="title" data-chapterpos="0" ref="titleRef">{{ title }}</div>
  <div
    v-for="(para, index) in contents"
    :key="index"
    ref="paragraphRef"
    :data-chapterpos="chapterPos[index]"
  >
    <img
      class="full"
      v-if="isSingleImageContent(para)"
      :src="getImageSrc(para)"
      @error.once="proxyImage"
      loading="lazy"
    />
    <p
      v-else
      :style="{ fontFamily, fontSize }"
      v-html="replaceImage(para)"
      @error.capture="handleImgLoadError"
    />
  </div>
</template>

<script setup lang="ts">
import { isLegadoUrl } from '@/utils/utils'
import API from '@api'
import jump from '@/plugins/jump'
import type { webReadConfig } from '@/web'

const store = useBookStore()
const readWidth = computed(() => store.config.readWidth)
const _fontSize = computed(() => store.config.fontSize)
const bookUrl = computed(() => store.readingBook.bookUrl)

const props = defineProps<{
  chapterIndex: number
  contents: Array<string>
  title: string
  spacing: webReadConfig['spacing']
  fontFamily: string
  fontSize: string
}>()

const imgPattern = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi
const singleImgPattern = /^\s*<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>\s*$/i

const extractSingleImageSrc = (content: string) =>
  content.match(singleImgPattern)?.[2]
const isSingleImageContent = (content: string) =>
  extractSingleImageSrc(content) !== undefined

const replaceImage = (content: string) => {
  return content.replace(imgPattern, (match, quote: string, src: string) => {
    void quote
    if (isLegadoUrl(src)) {
      const proxySrc = API.getProxyImageUrl(
        bookUrl.value,
        src,
        _fontSize.value * 2,
      )
      return match.replace(src, proxySrc)
    }
    return match
  })
}

const getImageSrc = (content: string) => {
  const src = extractSingleImageSrc(content)
  if (src === undefined) return ''
  if (isLegadoUrl(src)) {
    return API.getProxyImageUrl(bookUrl.value, src, readWidth.value)
  }
  return src
}
const proxyImage = (event: Event) => {
  /* 获取 IMG 标签原始的 src
    <img src="/test" />
    假设 location.href = http://example.com
    event.target.src 返回 http://example.com/test
    target.getAttribute('src') 返回 /test
  */
  const target = event.target as HTMLImageElement
  const src = target.getAttribute('src')
  if (src != null && src.length > 0) {
    target.src = API.getProxyImageUrl(bookUrl.value, src, readWidth.value)
  }
}

/**
 * 处理传入的IMG标签错误事件，自动替换图片的代理链接
 */
const handleImgLoadError = (event: Event) => {
  if ((event.target as HTMLElement)?.tagName === 'IMG') {
    const src = (event.target as HTMLImageElement).getAttribute('src') ?? ''
    console.log(
      '[ChapterContent]: IMG Load Error, replace src:',
      src,
      '=>',
      API.getProxyImageUrl(bookUrl.value, src, readWidth.value),
    )
    proxyImage(event)
  }
}

const calculateWordCount = (paragraph: string) => {
  //内嵌图片文字为1
  const imagePlaceHolder = ' '
  return paragraph.replace(imgPattern, imagePlaceHolder).length
}
const chapterPos = computed(() => {
  let pos = -1
  return Array.from(props.contents, content => {
    pos += calculateWordCount(content) + 1 //计算上一段的换行符
    return pos
  })
})

const titleRef = ref<HTMLElement>()
const paragraphRef = ref<HTMLParagraphElement[]>()
const scrollToReadLength = (length: number) => {
  if (length === 0) return
  const paragraphIndex = chapterPos.value.findIndex(
    wordCount => wordCount >= length,
  )
  if (paragraphIndex === -1) return
  nextTick(() => {
    jump(paragraphRef.value![paragraphIndex], {
      duration: 0,
    })
  })
}
defineExpose({
  scrollToReadLength,
})
let intersectionObserver: IntersectionObserver | null = null
const emit = defineEmits(['readLengthChange'])
onMounted(() => {
  intersectionObserver = new IntersectionObserver(
    entries => {
      for (const { target, isIntersecting } of entries) {
        if (isIntersecting) {
          emit(
            'readLengthChange',
            props.chapterIndex,
            parseInt((target as HTMLElement).dataset.chapterpos as string),
          )
        }
      }
    },
    {
      rootMargin: `0px 0px -${window.innerHeight - 24}px 0px`,
    },
  )
  intersectionObserver.observe(titleRef.value!)
  paragraphRef.value!.forEach(element => {
    intersectionObserver!.observe(element)
  })
})

onUnmounted(() => {
  intersectionObserver?.disconnect()
  intersectionObserver = null
})
</script>

<style lang="scss" scoped>
.title {
  margin-bottom: 57px;
  font:
    24px / 32px PingFangSC-Regular,
    HelveticaNeue-Light,
    'Helvetica Neue Light',
    'Microsoft YaHei',
    sans-serif;
}

p {
  display: block;
  word-wrap: break-word;
  /*   word-break: break-all; */
  letter-spacing: calc(v-bind('props.spacing.letter') * 1em);
  line-height: calc(1 + v-bind('props.spacing.line'));
  margin: calc(v-bind('props.spacing.paragraph') * 1em) 0;

  :deep(img) {
    height: 1em;
  }
}

.full {
  display: block;
  width: 100%;
}
</style>
