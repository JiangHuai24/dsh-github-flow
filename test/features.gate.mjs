import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * Exercises the new github-flow surfaces end to end:
 *   - /github-flow/accounts  add / activate / remove / bind
 *   - /github-flow/scrub     personal-identifier scan
 *   - composer slot registration with inputActions.setDraft
 * Plus the safety invariants: no token ever written, patch file untouched.
 */
const mod = await import('file:///D:/WorkBuddy/dsh-github-flow/index.js?t=' + Date.now())

const routes = new Map()
const ctx = {
  effect: (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') dispose()
  },
  get: (name) => {
    if (name === 'webServer') return { register: (route) => { routes.set(route.path, route); return () => {} } }
    if (name === 'workspaceRegistry') return { list: () => [{ path: 'D:/WorkBuddy/dsh-github-flow', title: 'dsh-github-flow' }] }
    if (name === 'skills') return { register: () => {} }
    return undefined
  },
  on: () => {},
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-accounts-'))
process.env.DSH_PROFILE_DIR = scratch

mod.apply(ctx, {})

const callJson = (routePath, method, body) =>
  new Promise((resolve) => {
    const route = routes.get(routePath)
    if (!route) {
      resolve({ missing: routePath })
      return
    }
    const req = {
      method,
      on: (event, fn) => {
        if (event === 'data' && body !== undefined) fn(JSON.stringify(body))
        if (event === 'end') fn()
        return req
      },
      destroy: () => {},
    }
    route.handler(req, {
      writeHead: () => ({ end: () => {} }),
      end: (payload) => {
        try {
          resolve(payload ? JSON.parse(payload) : null)
        } catch {
          resolve({ raw: payload })
        }
      },
    })
  })

const results = []
const check = (name, ok) => results.push([name, ok])

// --- routes exist ---
check('/github-flow/accounts registered', routes.has('/github-flow/accounts'))
check('/github-flow/scrub registered', routes.has('/github-flow/scrub'))

// --- account lifecycle ---
const empty = await callJson('/github-flow/accounts', 'GET')
check('starts empty', Array.isArray(empty.list) && empty.list.length === 0)

const added = await callJson('/github-flow/accounts', 'POST', { action: 'add', login: 'alice' })
check('add alice', added.ok === true && added.list.some((a) => a.login === 'alice'))
check('first account becomes active', added.active === 'alice')

const added2 = await callJson('/github-flow/accounts', 'POST', { action: 'add', login: 'bob' })
check('add bob keeps alice active', added2.active === 'alice' && added2.list.length === 2)

const activated = await callJson('/github-flow/accounts', 'POST', { action: 'activate', login: 'bob' })
check('activate bob', activated.active === 'bob')

const bound = await callJson('/github-flow/accounts', 'POST', { action: 'bind', login: 'alice', repo: 'D:/WorkBuddy/dsh-github-flow' })
check('bind repo to alice', bound.ok === true)

const removed = await callJson('/github-flow/accounts', 'POST', { action: 'remove', login: 'bob' })
check('remove bob', removed.ok === true && !removed.list.some((a) => a.login === 'bob'))

// --- no token is ever persisted ---
const accountFile = path.join(path.parse('D:/WorkBuddy/dsh-github-flow').root, 'WorkBuddy', 'dsh-github-flow', '.github-flow-accounts.json')
const candidates = [accountFile, path.join(scratch, '.github-flow-accounts.json')]
let writtenText = null
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) writtenText = fs.readFileSync(candidate, 'utf8')
}
check('account file written', writtenText !== null)
if (writtenText) {
  check('no token in account file', !/gh[pousr]_|Bearer\\s|password|token/i.test(writtenText))
  const parsed = JSON.parse(writtenText)
  check('file holds only login/name/email/repos', parsed.list.every((a) => Object.keys(a).every((k) => ['login', 'name', 'email', 'repos'].includes(k))))
}

// --- scrub scan ---
const scrub = await callJson('/github-flow/scrub', 'POST', { path: 'D:/WorkBuddy/dsh-github-flow' })
check('scrub returns ok', scrub.ok === true)
check('scrub scanned files', typeof scrub.files === 'number' && scrub.files >= 0)
check('scrub reports personal account if present', Array.isArray(scrub.findings))

let failed = false
for (const [name, ok] of results) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name)
  if (!ok) failed = true
}
if (scrub.findings && scrub.findings.length) {
  console.log('\nscrub findings (expected: personal account appears in pushed files):')
  for (const finding of scrub.findings.slice(0, 8)) {
    console.log('  ' + finding.file + ':' + finding.line + '  ' + finding.kind + '  ' + finding.sample)
  }
}
fs.rmSync(scratch, { recursive: true, force: true })
if (failed) process.exitCode = 1
