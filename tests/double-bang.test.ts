import { expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

const PANE = { title: 'Sidecar', isFocused: true, bodyColumns: 100, placement: 'dock' } as const

function world(on: On) {
  const stored: string[] = []

  on('session.append', ($, e) => {
    stored.push(e.message.content.map(b => (b.type === 'text' ? b.text : '')).join(''))
    return { message: e.message, uuid: e.uuid }
  })
  on('session.cwd', () => ({ value: '/work' }))
  on('env.get', () => ({ value: undefined }))
  // A shell that only knows `echo`.
  on('process.spawn', async function* ($, e) {
    const line = e.argv[e.argv.length - 1] ?? ''
    yield { stream: 'stdout' as const, text: `${line.replace(/^echo /, '')}\n` }
    return { value: { code: 0, signal: null } }
  })

  return { stored }
}

function pane($: EngineInterface, surface: 'terminal' | 'desktop') {
  return $.ui.mount({
    plugin: 'double-bang',
    surface,
    component: 'Pane',
    requestId: 'sidecar',
    props: PANE,
    viewport: { columns: 100, rows: 40 },
  } as never)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a sidecar run shows its output and adds nothing to the conversation`, async ($, on) => {
    const w = world(on)
    const ui = await pane($, surface)

    await ui.input({ key: 'command', text: 'echo sidecar-says-hi' })

    expect((await ui.find({ text: /sidecar-says-hi$/ }))?.type).toBe('Text')
    expect(w.stored).toEqual([])

    // Sharing appends through the engine's store, which the test kit does not
    // provide; the button being there is as far as a test can follow it.
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.some(b => b.key?.startsWith('share-'))).toBe(true)
  })
}

test('an empty command runs nothing', async ($, on) => {
  const w = world(on)
  const ui = await pane($, 'terminal')

  await ui.input({ key: 'command', text: '   ' })

  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect(w.stored).toEqual([])
})
