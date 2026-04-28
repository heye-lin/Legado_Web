export {}
export type Options = {
  duration?: number | ((distance: number) => number)
  offset?: number
  callback?: () => void // "undefined" is a suitable default, and won't be called
  easing?: (
    timeElapsed: number,
    start: number,
    distance: number,
    duration: number,
  ) => number
  a11y?: boolean
  container?: HTMLElement | string
}
type Jump = {
  (target: number | string | HTMLElement, options?: Options): void
  cancel: () => void
}
declare const jump: Jump
export const cancel: () => void
export default jump
