import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Delivery, SidecarRun } from '../types'

// A side terminal in a pane. Commands typed there run in a process the plugin
// starts itself, never through the engine's `!`, so nothing about them enters
// the conversation until the person shares a run.

const PANE = 'sidecar'
const TITLE = 'Sidecar'

const runs = atom({ plugin: 'double-bang', key: 'runs' } as const, [])
const cwdAtom = atom({ plugin: 'double-bang', key: 'cwd' } as const, null)
const deliveries = atom({ plugin: 'double-bang', key: 'deliveries' } as const, [])

const KEPT_RUNS = 20
const OUTPUT_LIMIT = 200_000
const SHARE_LIMIT = 30_000
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

type Shell = { kind: 'bash' | 'pwsh'; path: string }

// The module's own: a reload starts them over, and kills what was running.
let shell: Shell | null = null
const running = new Map<string, AsyncGenerator<unknown, unknown>>()
let nextId = 0

// The shell Claude Code's own `!` runs in: Git Bash on Windows (PowerShell
// where Git is missing), bash everywhere else.
async function findShell($: EngineInterface): Promise<Shell> {
  if (shell !== null) {
    return shell
  }

  if ((await $.env.get('OS')) !== 'Windows_NT') {
    shell = { kind: 'bash', path: '/bin/bash' }
    return shell
  }

  const bash = await gitBash($)
  shell = bash === null ? { kind: 'pwsh', path: 'powershell.exe' } : { kind: 'bash', path: bash }

  return shell
}

// The `bash` on PATH is usually WSL's, so look where Claude Code looks.
async function gitBash($: EngineInterface): Promise<string | null> {
  const set = await $.env.get('CLAUDE_CODE_GIT_BASH_PATH')
  if (set !== undefined && set !== '') {
    return set
  }

  const standard = 'C:\\Program Files\\Git\\bin\\bash.exe'
  if (await $.fs.exists(standard)) {
    return standard
  }

  const r = await $.process.run(['where.exe', 'git']).catch(() => null)
  const git = r?.stdout.split(/\r?\n/).find(line => /\\cmd\\git\.exe$/i.test(line.trim()))
  const beside = git?.trim().replace(/\\cmd\\git\.exe$/i, '\\bin\\bash.exe')

  return beside !== undefined && (await $.fs.exists(beside)) ? beside : null
}

function argv(sh: Shell, command: string): string[] {
  return sh.kind === 'pwsh' ? [sh.path, '-NoLogo', '-Command', command] : [sh.path, '-c', command]
}

// `cd` runs in the shell too, which reports where it landed; later runs start there.
function cdTarget(command: string): string | null {
  const m = /^\s*(?:cd|Set-Location|sl|chdir)(?:\s+(.*))?$/i.exec(command)
  return m === null ? null : (m[1] ?? '').trim()
}

async function patch($: EngineInterface, id: string, fn: (r: SidecarRun) => SidecarRun) {
  await update($, runs, list => list.map(r => (r.id === id ? fn(r) : r)))
}

async function execute($: EngineInterface, command: string) {
  if (command.trim() === '') {
    return
  }

  const sh = await findShell($)
  const cwd = (await read($, cwdAtom)) ?? (await $.session.cwd())
  const id = `run-${Date.now()}-${nextId++}`
  const run: SidecarRun = { id, command, cwd, output: '', exitCode: null, isRunning: true, share: 'none' }
  await update($, runs, list => [...list, run].slice(-KEPT_RUNS))

  const target = cdTarget(command)
  const line =
    target === null
      ? command
      : sh.kind === 'pwsh'
        ? `Set-Location ${target === '' ? '~' : target}; (Get-Location).Path`
        : `cd ${target} && ${sh.path.toLowerCase().endsWith('.exe') ? 'pwd -W' : 'pwd'}`

  let output = ''
  let code: number | null = null
  try {
    const stream = $.process.spawn({ argv: argv(sh, line), cwd })
    running.set(id, stream)
    for await (const { text } of stream) {
      output = (output + text.replace(ANSI, '')).slice(-OUTPUT_LIMIT)
      await patch($, id, r => ({ ...r, output }))
    }
    code = (await stream.result).code
  } catch (err) {
    output += `${output === '' ? '' : '\n'}${String(err)}`
  } finally {
    running.delete(id)
  }

  if (target !== null && code === 0) {
    const landed = output.trim().split(/\r?\n/).pop() ?? ''
    if (landed !== '') {
      await update($, cwdAtom, () => landed)
    }
  }
  await patch($, id, r => ({ ...r, output, exitCode: code, isRunning: false }))
}

function stop(id: string) {
  void running.get(id)?.return(undefined)
}

function summary(exit: string, lines: number): string {
  return `${exit === '0' ? 'ok' : `exit ${exit}`}, ${lines} line${lines === 1 ? '' : 's'}`
}

function outputLines(output: string): string[] {
  const trimmed = output.replace(/\s+$/, '')
  return trimmed === '' ? [] : trimmed.split(/\r?\n/)
}

function capped(output: string): string {
  return output.length > SHARE_LIMIT ? `${output.slice(-SHARE_LIMIT)}\n[earlier output cut]` : output
}

// What Claude reads for one shared run, as context beside the prompt.
function note(r: Delivery['runs'][number]): string {
  return [
    'The user ran this shell command in a side terminal, outside the conversation, and is sharing it with you.',
    `<bash-input>${r.command}</bash-input>`,
    `<cwd>${r.cwd}</cwd>`,
    `<exit-code>${r.exitCode ?? 'stopped'}</exit-code>`,
    `<output>${r.output}</output>`,
  ].join('\n')
}

// A plugin's own rows and notices are not drawn in the transcript, so a
// shared run waits for the person's next prompt: it rides along as context
// and is drawn under that prompt's row.
async function queue($: EngineInterface, id: string, on: boolean) {
  await patch($, id, r => (r.isRunning || r.share === 'shared' ? r : { ...r, share: on ? 'queued' : 'none' }))
  if (on) {
    $.ui.toast('Queued: Claude gets this run with your next message')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sidecar', description: 'Open the sidecar terminal pane' })
    // Unasked, the pane seats only in a wide terminal; /sidecar opens it anywhere.
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'sidecar' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return {}
  })

  on('prompt.submit', async ($, e, next) => {
    const queued = (await read($, runs)).filter(r => r.share === 'queued')
    if (queued.length === 0 || e.origin.kind !== 'composer' || e.text.startsWith('/')) {
      return next(e)
    }

    const carried = queued.map(r => ({ command: r.command, cwd: r.cwd, exitCode: r.exitCode, output: capped(r.output) }))
    const r = await next({ ...e, context: [...(e.context ?? []), ...carried.map(note)] })
    if (r.drop !== undefined) {
      return r
    }

    const ids = new Set(queued.map(one => one.id))
    await update($, runs, list => list.map(one => (ids.has(one.id) ? { ...one, share: 'shared' as const } : one)))
    await update($, deliveries, list => [...list, { prompt: e.text, runs: carried }].slice(-KEPT_RUNS))

    return r
  })

  // The runs a prompt carried, under its row: one line each, whole under ctrl+o.
  on('ui.render', { component: 'UserMessage', props: { origin: { kind: 'composer' } } }, async ($, e, next) => {
    const delivery = (await read($, deliveries)).findLast(d => d.prompt.trim() === e.props.text.trim())
    const drawn = await next(e)
    if (delivery === undefined) {
      return drawn
    }

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {drawn}
        {delivery.runs.map(run => {
          const lines = outputLines(run.output)
          const head = (
            <Box>
              <Text color="warning">{'  ⇡ shared '}</Text>
              <Text bold>{`$ ${run.command}`}</Text>
              <Text dimColor>
                {`  ${summary(String(run.exitCode ?? 'stopped'), lines.length)}${e.props.isExpanded ? '' : ' · ctrl+o to expand'}`}
              </Text>
            </Box>
          )
          if (!e.props.isExpanded) {
            return head
          }
          return (
            <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginLeft={2}>
              {head}
              <Text dimColor>{run.cwd}</Text>
              {lines.map(l => (
                <Text>{l}</Text>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    // Mobile draws no text field; commands are typed where the CLI runs.
    if (!('Input' in elements)) {
      return <elements.Text dimColor>The sidecar runs commands from the terminal or desktop app.</elements.Text>
    }
    const { Box, Button, Input, Text } = elements
    const list = await read($, runs)
    const cwd = (await read($, cwdAtom)) ?? (await $.session.cwd())
    const width = Math.max(20, e.props.bodyColumns)
    // Rows left for output once the cwd line, the field and each run's
    // header and buttons are drawn.
    let room = Math.max(4, (e.viewport?.rows ?? 24) - 4)

    const shown: { run: SidecarRun; lines: string[] }[] = []
    for (const run of [...list].reverse()) {
      if (room <= 2) {
        break
      }
      room -= 2
      const all = run.output.replace(/\s+$/, '').split(/\r?\n/).filter((l, i, a) => a.length > 1 || l !== '')
      const lines = all.slice(-Math.max(0, room))
      room -= lines.length
      shown.unshift({ run, lines })
    }

    return (
      <Box flexDirection="column" width={width}>
        <Text dimColor>{cwd.slice(-width)}</Text>
        {shown.map(({ run, lines }) => (
          <Box key={run.id} flexDirection="column">
            <Box>
              <Text bold color="warning">{`$ ${run.command}`.slice(0, width - 16)}</Text>
              <Text dimColor>
                {'  '}
                {run.isRunning ? 'running' : run.exitCode === 0 ? 'ok' : `exit ${run.exitCode ?? 'stopped'}`}
                {run.share === 'queued' ? ', goes with your next message' : run.share === 'shared' ? ', shared' : ''}
              </Text>
            </Box>
            {lines.map(l => (
              <Text>{l.slice(0, width)}</Text>
            ))}
            <Box>
              {run.isRunning && <Button key={`stop-${run.id}`} label="Stop" onPress={() => stop(run.id)} />}
              {!run.isRunning && run.share === 'none' && (
                <Button key={`share-${run.id}`} label="Share with Claude" onPress={() => queue($, run.id, true)} />
              )}
              {run.share === 'queued' && (
                <Button key={`unshare-${run.id}`} label="Don't share" onPress={() => queue($, run.id, false)} />
              )}
            </Box>
          </Box>
        ))}
        <Input
          key="command"
          label="$ "
          placeholder="command, runs outside the conversation"
          submitLabel="run"
          value=""
          autoFocus
          onSubmit={value => execute($, value)}
        />
        {list.length > 0 && <Button key="clear" label="Clear" onPress={() => update($, runs, () => [])} />}
      </Box>
    )
  })
}
