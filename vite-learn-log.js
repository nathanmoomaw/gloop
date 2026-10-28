import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_BYTES = 64 * 1024

/** Vite dev-server plugin that appends POSTed learn entries to a local JSONL file. */
export default function learnLogPlugin({ file = 'learning/feedback.jsonl' } = {}) {
  return {
    name: 'gloop-learn-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__gloop-learn', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let size = 0
        let aborted = false
        const chunks = []
        req.on('data', (chunk) => {
          if (aborted) return
          size += chunk.length
          if (size > MAX_BYTES) {
            aborted = true
            res.statusCode = 413
            res.end()
            return
          }
          chunks.push(chunk)
        })
        req.on('end', async () => {
          if (aborted) return
          let entry
          try {
            entry = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          } catch {
            res.statusCode = 400
            res.end()
            return
          }
          if (!entry || typeof entry !== 'object' || typeof entry.kind !== 'string') {
            res.statusCode = 400
            res.end()
            return
          }
          try {
            const target = path.resolve(server.config.root, file)
            await fs.mkdir(path.dirname(target), { recursive: true })
            await fs.appendFile(target, JSON.stringify(entry) + '\n', 'utf8')
            res.statusCode = 204
            res.end()
          } catch {
            res.statusCode = 500
            res.end()
          }
        })
      })
    },
  }
}
