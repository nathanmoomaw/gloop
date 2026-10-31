import { describe, it, expect, vi } from 'vitest'
import {
  fileSaveSupported,
  pickLearnFile,
  ensurePermission,
  writeAll,
  appendText,
  createAppender,
} from '../src/audio/learnFile.js'

function makeFakeHandle(initial = '', { delayMs = 0, failOnText = null } = {}) {
  let content = initial
  let aborted = 0
  return {
    get content() {
      return content
    },
    get aborted() {
      return aborted
    },
    async getFile() {
      return { size: content.length }
    },
    async createWritable({ keepExistingData = false } = {}) {
      let buf = keepExistingData ? content : ''
      let pos = 0
      return {
        async seek(p) {
          pos = p
        },
        async write(text) {
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, Math.random() * delayMs))
          }
          if (failOnText && text.includes(failOnText)) {
            throw new Error(`disk full on ${text}`)
          }
          buf = buf.slice(0, pos) + text + buf.slice(pos + text.length)
          pos += text.length
        },
        async close() {
          content = buf
        },
        async abort() {
          aborted++
        },
      }
    },
  }
}

describe('learnFile', () => {
  it('checks fileSaveSupported and passes feedback.jsonl to pickLearnFile', async () => {
    expect(fileSaveSupported({})).toBe(false)
    const fakeHandle = { name: 'feedback.jsonl' }
    const showSaveFilePicker = vi.fn().mockResolvedValue(fakeHandle)
    const win = { showSaveFilePicker }
    expect(fileSaveSupported(win)).toBe(true)

    const picked = await pickLearnFile(win)
    expect(picked).toBe(fakeHandle)
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'feedback.jsonl' }),
    )
  })

  it('evaluates ensurePermission across query and request states', async () => {
    expect(await ensurePermission({})).toBe(true)
    expect(await ensurePermission({ queryPermission: async () => 'granted' })).toBe(true)
    expect(await ensurePermission({ queryPermission: async () => 'prompt' })).toBe(false)
    expect(
      await ensurePermission(
        {
          queryPermission: async () => 'prompt',
          requestPermission: async () => 'granted',
        },
        { request: true },
      ),
    ).toBe(true)
    expect(
      await ensurePermission(
        {
          queryPermission: async () => 'prompt',
          requestPermission: async () => 'denied',
        },
        { request: true },
      ),
    ).toBe(false)
  })

  it('writeAll truncates and appendText appends or aborts on write failure', async () => {
    const h = makeFakeHandle('old-content\n')
    await writeAll(h, 'line1\n')
    expect(h.content).toBe('line1\n')

    await appendText(h, 'line2\n')
    expect(h.content).toBe('line1\nline2\n')

    const failing = makeFakeHandle('keep-me\n', { failOnText: 'BOOM' })
    await expect(appendText(failing, 'BOOM\n')).rejects.toThrow(/disk full/)
    expect(failing.content).toBe('keep-me\n')
    expect(failing.aborted).toBe(1)
  })

  it('createAppender serializes concurrent appends in call order and recovers after a failure', async () => {
    const h = makeFakeHandle('', { delayMs: 8, failOnText: 'bad' })
    const appender = createAppender(h)

    const results = await Promise.allSettled([
      appender.append('1\n'),
      appender.append('2\n'),
      appender.append('bad\n'),
      appender.append('4\n'),
      appender.append('5\n'),
    ])

    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ])
    expect(h.content).toBe('1\n2\n4\n5\n')
  })
})
