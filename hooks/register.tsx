import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BangRun } from '../types'

// `!` on an empty prompt switches to shell mode and is consumed; a second `!`
// typed first in the shell-mode draft arms the next command as private. The
// engine still runs it, and its two transcript rows are rewritten to stubs
// before the model or the transcript file reads them.

const isArmed = atom({ plugin: 'double-bang', key: 'isArmed' } as const, false)
const last = atom({ plugin: 'double-bang', key: 'last' } as const, null)
const isHidden = atom({ plugin: 'double-bang', key: 'isHidden' } as const, false)
const isExpanded = atom({ plugin: 'double-bang', key: 'isExpanded' } as const, false)

const PREVIEW_LINES = 12
const EXPANDED_LINES = 200
const SHARE_LIMIT = 30000
const INPUT_STUB = '(private shell command)'
const OUTPUT_STUB = '(output withheld)'

function tagged(text: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  return m?.[1] ?? ''
}

async function arm($: EngineInterface, on: boolean) {
  await update($, isArmed, () => on)
  $.ui.status(on ? '!! private: the next shell command stays out of the conversation' : undefined)
}

async function share($: EngineInterface): Promise<string> {
  const r = await read($, last)
  if (r === null || !r.isDone) {
    return 'Nothing to share yet.'
  }
  if (r.isShared) {
    return 'Already shared.'
  }

  const cap = (s: string) =>
    s.length > SHARE_LIMIT ? `${s.slice(0, SHARE_LIMIT)}\n[... ${s.length - SHARE_LIMIT} more characters cut]` : s
  const text = [
    'The user ran this shell command privately with `!!` (it was withheld at the time) and is now sharing it with you.',
    `<bash-input>${r.command}</bash-input>`,
    `<bash-stdout>${cap(r.stdout)}</bash-stdout><bash-stderr>${cap(r.stderr)}</bash-stderr>`,
  ].join('\n')

  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  await update($, last, cur => (cur?.id === r.id ? { ...cur, isShared: true } : cur))
  $.ui.toast('!! output shared: Claude reads it with your next message')

  return 'Shared.'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bang-share',
      description: 'Share the last !! command and its output with Claude',
    })

    return next(e)
  })

  on('command.run', { command: 'bang-share' }, async $ => ({ text: await share($) }))

  on('prompt.edit', async ($, e, next) => {

    // The second `!`: first in an empty shell-mode draft. Take it out of the
    // command and arm instead.
    if (e.text === '' && e.inputText.startsWith('!')) {
      await arm($, true)
      const rest = e.inputText.slice(1)
      return rest === '' ? { text: e.text, cursor: e.cursor } : next({ ...e, inputText: rest })
    }
    // Backspace on an empty draft leaves shell mode, and the private mark with it.
    if (e.text === '' && e.inputText === '' && e.start === e.end && (await read($, isArmed))) {
      await arm($, false)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // A plain prompt means the person left shell mode.
    if (await read($, isArmed)) {
      await arm($, false)
    }

    return next(e)
  })

  on('session.append', { door: 'command' }, async ($, e, next) => {
    const text = e.message.content.map(b => (b.type === 'text' ? b.text : '')).join('')

    if (e.message.type !== 'user' || !(await read($, isArmed))) {
      return next(e)
    }

    if (text.startsWith('<bash-input>')) {
      const run: BangRun = {
        id: e.uuid,
        command: tagged(text, 'bash-input'),
        stdout: '',
        stderr: '',
        isDone: false,
        isShared: false,
      }
      await update($, last, () => run)
      await update($, isHidden, () => false)
      await update($, isExpanded, () => false)

      return next({ ...e, message: { ...e.message, content: [{ type: 'text', text: INPUT_STUB }] } })
    }

    if (text.startsWith('<bash-stdout>') || text.startsWith('<bash-stderr>')) {
      await update($, last, cur =>
        cur === null || cur.isDone
          ? cur
          : { ...cur, stdout: tagged(text, 'bash-stdout'), stderr: tagged(text, 'bash-stderr'), isDone: true },
      )
      await arm($, false)

      return next({ ...e, message: { ...e.message, content: [{ type: 'text', text: OUTPUT_STUB }] } })
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const r = await read($, last)
    if (r === null || e.props.hasSurvey || (await read($, isHidden))) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const expanded = await read($, isExpanded)
    const width = Math.max(20, e.props.bodyColumns)
    const output = [r.stdout, r.stderr].filter(Boolean).join('\n').replace(/\s+$/, '')
    const lines = output === '' ? [] : output.split(/\r?\n/)
    const shown = lines.slice(-(expanded ? EXPANDED_LINES : PREVIEW_LINES))
    const hiddenCount = lines.length - shown.length
    const status = !r.isDone ? 'running...' : r.isShared ? 'shared with Claude' : 'not shared'

    return (
      <Box flexDirection="column" width={width}>
        <Box>
          <Text bold>{`!! ${r.command}`.slice(0, width - 24)}</Text>
          <Text dimColor>
            {'  '}
            {status}
          </Text>
        </Box>
        {hiddenCount > 0 && <Text dimColor>... {hiddenCount} earlier lines</Text>}
        {shown.map(line => (
          <Text>{line.slice(0, width)}</Text>
        ))}
        <Box>
          {r.isDone && !r.isShared && (
            <Button key="share" label="Share with Claude" variant="primary" onPress={() => void share($)} />
          )}
          {lines.length > PREVIEW_LINES && (
            <Button key="expand" label={expanded ? 'Less' : 'More'} onPress={() => update($, isExpanded, v => !v)} />
          )}
          <Button key="hide" label="Dismiss" onPress={() => update($, isHidden, () => true)} />
        </Box>
      </Box>
    )
  })
}
