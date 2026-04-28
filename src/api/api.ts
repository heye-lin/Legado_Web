import serverApi, { getApiTargetName, subscribeApiAvailability } from './server'

export type LegadoApiResponse<T> = {
  isSuccess: boolean
  errorMsg: string
  data: T
}

export { getApiTargetName, subscribeApiAvailability }

export default serverApi
