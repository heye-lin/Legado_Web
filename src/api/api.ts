import serverApi from './server'

export type LegadoApiResponse<T> = {
  isSuccess: boolean
  errorMsg: string
  data: T
}

export const apiTargetName = 'PostgreSQL 持久化'

export default serverApi
