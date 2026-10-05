export type SidecarRun = {
  id: string
  command: string
  cwd: string
  output: string
  exitCode: number | null
  isRunning: boolean
  isShared: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'double-bang': {
      runs: SidecarRun[]
      cwd: string | null
    }
  }
}
