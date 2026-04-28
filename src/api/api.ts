import serverApi, { getApiTargetName, subscribeApiAvailability } from './server'

export type LegadoApiResponse<T> = {
  isSuccess: boolean
  errorMsg: string
  errorCode?: string
  data: T
}

export { getApiTargetName, subscribeApiAvailability }

export default serverApi
