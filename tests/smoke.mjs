#!/usr/bin/env node
/**
 * Smoke test — verifies the project builds cleanly and the dist output looks sane.
 * Run: node tests/smoke.mjs
 */

import { execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`)
    failed++
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed')
}

console.log('\n🔧 gloop — Smoke Tests\n')

console.log('Build:')
test('vite build succeeds', () => {
  execSync('npm run build', { cwd: root, stdio: 'pipe' })
})

test('dist/index.html exists', () => {
  assert(existsSync(join(root, 'dist', 'index.html')))
})

test('dist contains a JS bundle', () => {
  const assets = readdirSync(join(root, 'dist', 'assets'))
  assert(assets.some((f) => f.endsWith('.js')), 'no JS bundle in dist/assets')
})

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
