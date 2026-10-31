/** Check whether the File System Access save picker is supported. */
export function fileSaveSupported(win = globalThis) {
  return Boolean(win && typeof win.showSaveFilePicker === 'function')
}

/** Prompt the user to pick a .jsonl file for saving feedback entries. */
export function pickLearnFile(win = globalThis) {
  return win.showSaveFilePicker({
    suggestedName: 'feedback.jsonl',
    types: [
      {
        description: 'JSON lines',
        accept: { 'application/x-ndjson': ['.jsonl'] },
      },
    ],
  })
}

/** Verify (and optionally request) readwrite permission on a file handle. */
export async function ensurePermission(handle, { request = false } = {}) {
  if (!handle || typeof handle.queryPermission !== 'function') return true
  const opts = { mode: 'readwrite' }
  const status = await handle.queryPermission(opts)
  if (status === 'granted') return true
  if (request && typeof handle.requestPermission === 'function') {
    return (await handle.requestPermission(opts)) === 'granted'
  }
  return false
}

/** Overwrite the file referenced by handle with text. */
export async function writeAll(handle, text) {
  const w = await handle.createWritable()
  await w.write(text)
  await w.close()
}

/** Append text to the end of the file referenced by handle, aborting on failure. */
export async function appendText(handle, text) {
  const file = await handle.getFile()
  const w = await handle.createWritable({ keepExistingData: true })
  try {
    await w.seek(file.size)
    await w.write(text)
    await w.close()
  } catch (err) {
    if (w && typeof w.abort === 'function') {
      try {
        await w.abort()
      } catch {
        // Ignore abort errors so original write error surfaces.
      }
    }
    throw err
  }
}

/** Create a serialized appender queue so concurrent presses never interleave writes. */
export function createAppender(handle) {
  let chain = Promise.resolve()
  return {
    append(text) {
      const next = chain.then(
        () => appendText(handle, text),
        () => appendText(handle, text),
      )
      chain = next.catch(() => {})
      return next
    },
  }
}
