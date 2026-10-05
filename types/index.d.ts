export type BangRun = {
  id: string
  command: string
  stdout: string
  stderr: string
  isDone: boolean
  isShared: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'double-bang': {
      isArmed: boolean
      last: BangRun | null
      isHidden: boolean
      isExpanded: boolean
    }
  }
}
