import { expect, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

const PANE = { title: 'Sidecar', isFocused: true, bodyColumns: 100, placement: 'dock' } as const
const composer = { kind: 'composer' } as const

function world(on: On) {
  const stored: string[] = []
  const context: string[][] = []

  on('session.append', ($, e) => {
    stored.push(e.message.content.map(b => (b.type === 'text' ? b.text : '')).join(''))
    return { message: e.message, uuid: e.uuid }
  })
  on('prompt.submit', ($, e) => {
    context.push([...(e.context ?? [])])
    return { text: e.text, context: e.context }
  })
  // The engine's own drawing of a row, for hooks that wrap it.
  on('ui.render', () => <never>{ type: 'Text', props: {}, children: ['engine row'] })
  on('session.cwd', () => ({ value: '/work' }))
  on('env.get', () => ({ value: undefined }))
  // A shell that only knows `echo`.
  on('process.spawn', async function* ($, e) {
    const line = e.argv[e.argv.length - 1] ?? ''
    yield { stream: 'stdout' as const, text: `${line.replace(/^echo /, '')}\n` }
    return { value: { code: 0, signal: null } }
  })

  return { stored, context }
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

function promptRow($: EngineInterface, text: string, isExpanded: boolean) {
  return $.ui.mount({
    plugin: 'double-bang',
    surface: 'terminal',
    component: 'UserMessage',
    props: { text, origin: composer, isExpanded },
  } as never)
}

async function shareKey(ui: Awaited<ReturnType<typeof pane>>) {
  return (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('share-'))?.key
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a sidecar run shows its output and adds nothing to the conversation`, async ($, on) => {
    const w = world(on)
    const ui = await pane($, surface)

    await ui.input({ key: 'command', text: 'echo sidecar-says-hi' })

    expect(await ui.find({ text: /sidecar-says-hi$/ })).toBeDefined()
    expect(await shareKey(ui)).toBeDefined()
    expect(w.stored).toEqual([])
  })
}

test('a shared run goes to Claude with the next prompt, and only that one', async ($, on) => {
  const w = world(on)
  const ui = await pane($, 'terminal')

  await ui.input({ key: 'command', text: 'echo jellop' })
  await ui.press({ key: (await shareKey(ui))! })

  expect(await ui.find({ text: /goes with your next message/ })).toBeDefined()
  expect(w.stored).toEqual([])

  await $.prompt.submit({ origin: composer, wait: false, text: 'look at this' })
  await $.prompt.submit({ origin: composer, wait: false, text: 'and now?' })

  expect(w.context).toHaveLength(2)
  expect(w.context[0]!.join('\n')).toContain('<bash-input>echo jellop</bash-input>')
  expect(w.context[0]!.join('\n')).toContain('<output>jellop\n</output>')
  expect(w.context[1]).toEqual([])
  expect(await ui.find({ text: /, shared/ })).toBeDefined()
  expect(w.stored).toEqual([])
})

test("Don't share takes a run back off the queue", async ($, on) => {
  const w = world(on)
  const ui = await pane($, 'terminal')

  await ui.input({ key: 'command', text: 'echo nope' })
  await ui.press({ key: (await shareKey(ui))! })
  const unshare = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('unshare-'))
  await ui.press({ key: unshare!.key! })
  await $.prompt.submit({ origin: composer, wait: false, text: 'hello' })

  expect(w.context).toEqual([[]])
})

test('the prompt that carried a run shows it, one line until ctrl+o', async ($, on) => {
  world(on)
  const ui = await pane($, 'terminal')

  await ui.input({ key: 'command', text: 'echo jellop' })
  await ui.press({ key: (await shareKey(ui))! })
  await $.prompt.submit({ origin: composer, wait: false, text: 'look at this' })

  const row = await promptRow($, 'look at this', false)
  expect(await row.find({ text: 'engine row' })).toBeDefined()
  expect(await row.find({ text: '$ echo jellop' })).toBeDefined()
  expect(await row.find({ text: /ok, 1 line · ctrl\+o to expand/ })).toBeDefined()
  expect(await row.find({ text: '/work' })).toBeUndefined()

  const open = await promptRow($, 'look at this', true)
  expect(await open.find({ text: '/work' })).toBeDefined()
  expect(await open.find({ text: 'jellop' })).toBeDefined()

  const other = await promptRow($, 'something else', false)
  expect(await other.find({ text: '$ echo jellop' })).toBeUndefined()
})

test('an empty command runs nothing', async ($, on) => {
  const w = world(on)
  const ui = await pane($, 'terminal')

  await ui.input({ key: 'command', text: '   ' })

  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect(w.stored).toEqual([])
})
