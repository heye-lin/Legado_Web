import standaloneApi from './standalone'

export type LegadoApiResponse<T> = {
  isSuccess: boolean
  errorMsg: string
  data: T
}

export const apiTargetName = '浏览器本地'

export default standaloneApi
