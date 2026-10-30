import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { appendEntry, loadLog, saveLog, summarize, toJSONL } from './learn'
import { addEntry, getAllEntries, getMeta, loadLearnStore, saveFallbackEntry, setMeta } from './learnStore'
import { createAppender, ensurePermission, pickLearnFile, writeAll } from './learnFile'
import { createRemoteSender, remoteUrl } from './learnRemote'

// Learn mode's storage, behind one hook: the in-memory log (what the panel
// counts and the learned target reads), IndexedDB (every press), the
// optional auto-save file, and the dev-server log. App only makes entries.

// Loaded once per page: StrictMode's double-mounted effect would otherwise
// run the localStorage migration twice in parallel.
let learnStorePromise = null

// Every press: the db holds all of them, the in-memory log only the last
// LEARN_MEMORY_CAP. Db rows lose their store `id`, so every line in a file
// or export has the same shape.
async function learnHistory(db, memoryLog) {
  let rows = memoryLog
  try {
    if (db) rows = await getAllEntries(db)
  } catch {
    // Fall back to what's in memory.
  }
  return rows.map(({ id: _id, ...entry }) => entry)
}

// Db write failed: park it for the next load to import. No db at all
// (private mode): the localStorage log is the store.
function persistLearnEntry(db, entry) {
  if (db) addEntry(db, entry).catch(() => saveFallbackEntry(entry))
  else saveLog([...loadLog(), entry].slice(-2000))
}

// How many presses stay in memory (all of them stay in the db), and how
// many recent ones the learned target is computed from.
const LEARN_MEMORY_CAP = 20000
const LEARN_TARGET_WINDOW = 500


/** Learn-mode log + persistence: { summary, file, remote, record, recent, exportLog, pickFile }. */
export function useLearnLog() {
  const [learnLog, setLearnLog] = useState([])
  // Latest log for handlers, so two presses inside one render both land.
  const learnLogRef = useRef(learnLog)
  // IndexedDB (learnStore.js); null until loaded, or for good in private
  // mode, where presses fall back to localStorage.
  const learnDbRef = useRef(null)
  // Presses made before the store finished loading, saved once it has.
  const learnPendingRef = useRef([])
  const learnLoadedRef = useRef(false)
  // Auto-save file (learnFile.js, Chrome/Edge desktop): picked once, kept in
  // the db, appended on every press.
  const learnFileRef = useRef(null)
  const [learnFile, setLearnFile] = useState({ name: null, error: null })

  useEffect(() => {
    let cancelled = false
    learnStorePromise ??= loadLearnStore()
    learnStorePromise.then(async ({ db, entries }) => {
      if (cancelled) return
      learnDbRef.current = db
      learnLoadedRef.current = true
      const pending = learnPendingRef.current
      for (const entry of pending) persistLearnEntry(db, entry)
      learnPendingRef.current = []
      // Presses made before the load finished go after the stored ones.
      const stored = entries.map(({ id: _id, ...entry }) => entry)
      const merged = [...stored, ...learnLogRef.current].slice(-LEARN_MEMORY_CAP)
      learnLogRef.current = merged
      setLearnLog(merged)
      const handle = db && (await getMeta(db, 'file').catch(() => null))
      // Skip if a file was already picked while this was loading.
      if (handle && !cancelled && !learnFileRef.current) {
        // Presses from the load window go out with the next one.
        learnFileRef.current = { handle, appender: createAppender(handle), backlog: toJSONL(pending) }
        setLearnFile({ name: handle.name, error: null })
      }
    })
    return () => { cancelled = true }
  }, [])

  // Production builds with the capture URL: every entry, from any device,
  // also goes to LIFE via the capture Lambda (learnRemote.js). No key or
  // pairing for now, so it lands in LIFE/learn/gloop/anon/.
  const learnUrl = remoteUrl()
  const remoteRef = useRef(null)
  useEffect(() => {
    if (!learnUrl) return
    const remote = createRemoteSender({ url: learnUrl })
    remoteRef.current = remote
    remote.flush() // whatever an earlier visit left in the outbox
    const onHide = () => document.visibilityState === 'hidden' && remote.flush({ beacon: true })
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      remote.dispose()
      if (remoteRef.current === remote) remoteRef.current = null
    }
  }, [learnUrl])

  const record = useCallback((entry) => {
    const next = appendEntry(learnLogRef.current, entry, LEARN_MEMORY_CAP)
    learnLogRef.current = next
    setLearnLog(next)
    if (learnLoadedRef.current) persistLearnEntry(learnDbRef.current, entry)
    else learnPendingRef.current.push(entry)
    const file = learnFileRef.current
    if (file) {
      // Lines that failed to write earlier go out first, so the file
      // catches back up instead of keeping a gap.
      file.backlog += JSON.stringify(entry) + '\n'
      ensurePermission(file.handle, { request: true })
        .then((ok) => {
          if (!ok) throw new Error('permission')
          const text = file.backlog
          file.backlog = ''
          return file.appender.append(text).catch((err) => {
            file.backlog = text + file.backlog
            throw err
          })
        })
        .then(() => setLearnFile((f) => (f.error ? { ...f, error: null } : f)))
        .catch((err) => setLearnFile((f) => ({ ...f, error: err.message === 'permission' ? 'allow file access to keep saving' : 'file save failed' })))
    }
    // `npm run dev` only: vite-learn-log.js appends it to learning/feedback.jsonl.
    if (import.meta.env.DEV) {
      fetch('/__gloop-learn', { method: 'POST', body: JSON.stringify(entry) }).catch(() => {})
    }
    remoteRef.current?.add(entry)
  }, [])

  // The recent presses the learned target is computed from.
  const recent = useCallback(() => learnLogRef.current.slice(-LEARN_TARGET_WINDOW), [])

  const learnSummary = useMemo(() => summarize(learnLog), [learnLog])

  const handleLearnExport = useCallback(async () => {
    const url = URL.createObjectURL(new Blob([toJSONL(await learnHistory(learnDbRef.current, learnLogRef.current))], { type: 'application/x-ndjson' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `gloop-learn-${new Date().toISOString().slice(0, 10)}.jsonl`
    a.click()
    // Revoking straight away can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  // Picks the auto-save file. An empty file gets the whole history first
  // (from the db, not the capped in-memory log); one that already has data
  // is kept as is. Every press after that appends a line.
  const handlePickLearnFile = useCallback(async () => {
    let handle
    try {
      // Before any await: the picker needs the click's user activation.
      handle = await pickLearnFile()
    } catch (err) {
      if (err?.name !== 'AbortError') setLearnFile((f) => ({ ...f, error: 'could not open a file here' }))
      return
    }
    try {
      // The db (and any handle saved in it) has to be loaded before writing.
      await learnStorePromise
      if ((await handle.getFile()).size === 0) {
        await writeAll(handle, toJSONL(await learnHistory(learnDbRef.current, learnLogRef.current)))
      }
      learnFileRef.current = { handle, appender: createAppender(handle), backlog: '' }
      setLearnFile({ name: handle.name, error: null })
      if (learnDbRef.current) setMeta(learnDbRef.current, 'file', handle).catch(() => {})
    } catch {
      setLearnFile((f) => ({ ...f, error: 'file save failed' }))
    }
  }, [])

  return {
    summary: learnSummary,
    file: learnFile,
    remote: !!learnUrl,
    record,
    recent,
    exportLog: handleLearnExport,
    pickFile: handlePickLearnFile,
  }
}
