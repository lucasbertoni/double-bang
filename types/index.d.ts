export type SidecarRun = {
  id: string
  command: string
  cwd: string
  output: string
  exitCode: number | null
  isRunning: boolean
  // `queued` waits for the person's next prompt, which carries it to Claude.
  share: 'none' | 'queued' | 'shared'
}

// Runs a prompt carried, kept to draw them under that prompt's row.
export type Delivery = {
  prompt: string
  runs: Pick<SidecarRun, 'command' | 'cwd' | 'output' | 'exitCode'>[]
}

declare module 'claude-code' {
  interface PluginState {
    'double-bang': {
      runs: SidecarRun[]
      cwd: string | null
      deliveries: Delivery[]
    }
  }
}
