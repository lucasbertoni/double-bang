import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const typed = { origin: { kind: 'composer' }, wait: false } as const

function world(on: On) {
  const stored: string[] = []
  const reachedModel: string[] = []

  on('session.append', ($, e) => {
    stored.push(e.message.content.map(b => (b.type === 'text' ? b.text : '')).join(''))
    return { message: e.message, uuid: e.uuid }
  })
  on('prompt.submit', ($, e) => {
    reachedModel.push(e.text)
    return { text: e.text }
  })

  return { stored, reachedModel }
}

test('a plain ! command is stored as the engine wrote it', async ($, on) => {
  const w = world(on)
  const row = (uuid: string, text: string) =>
    $.session.append({
      door: 'command',
      origin: { kind: 'unclassified' },
      uuid,
      message: { type: 'user', role: 'user', content: [{ type: 'text', text }] },
    } as never)

  await row('a', '<bash-input>ls</bash-input>').catch(() => {})
  await row('b', '<bash-stdout>file</bash-stdout><bash-stderr></bash-stderr>').catch(() => {})

  expect(w.stored).toEqual(['<bash-input>ls</bash-input>', '<bash-stdout>file</bash-stdout><bash-stderr></bash-stderr>'])
})

test('ordinary prompts pass through', async ($, on) => {
  const w = world(on)

  await $.prompt.submit({ ...typed, text: 'hi there' })

  expect(w.reachedModel).toEqual(['hi there'])
})

test('/bang-share with nothing run shares nothing', async ($, on) => {
  const w = world(on)

  const r = await $.command.run({
    command: 'bang-share',
    args: '',
    origin: typed.origin,
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(r.text).toBe('Nothing to share yet.')
  expect(w.stored).toEqual([])
})
