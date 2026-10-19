import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = here
const repoUrl = 'https://github.com/extremity2740938284-create/dsh-github-flow'
const scriptPath = path.join(here, 'scripts', 'gh-push.ps1')

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function run(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 180000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      },
    )
  })
}

const git = (args, cwd) => run('git', args, { cwd, timeout: 20000 })

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 200000) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function sendJson(res, payload) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(payload))
}

const logSafe = (message) => {
  try {
    console.warn('[github-flow] ' + message)
  } catch {
    // logging must never break activation
  }
}

export const inject = ['skills']

/**
 * Registers the global github-push skill plus the small same-origin surface the
 * settings page and the one-click push panel use.
 */
export function apply(ctx, config) {
  const template = fs.readFileSync(path.join(here, 'skill.md'), 'utf8')
  const content = template.split('{{SKILL_DIR}}').join(here)
  const configuredRoot = config && typeof config.reposRoot === 'string' && config.reposRoot ? config.reposRoot : undefined
  // Config is read at loader boot, so fall back to the usual home for repos
  // to keep the panel useful without a restart.
  const defaultRoots = [path.join('D:/', 'WorkBuddy'), path.join(os.homedir(), 'WorkBuddy')]
  const reposRoot = configuredRoot || defaultRoots.find((root) => {
    try {
      return fs.statSync(root).isDirectory()
    } catch {
      return false
    }
  })

  // Resolve through ctx.get: a hard property access here turns a missing
  // service into a module-level throw, which the host reports as
  // "import failed" and aborts the whole web boot.
  const skills = typeof ctx.get === 'function' ? ctx.get('skills') : ctx.skills

  ctx.effect(() => {
    if (!skills || typeof skills.register !== 'function') {
      logSafe('skills service unavailable; github-push skill not registered')
      return
    }
    return skills.register({
      name: 'github-push',
      description:
        '固定流程：把本地改动提交并推送到 GitHub —— 探测网络与凭据、提交、推送、校验远端、按需打 tag 与发 Release。',
      whenToUse:
        '当用户要求“推到 GitHub / 上传 / 同步改动”，或一次代码改动完成后需要落到远端仓库时。',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom',
      content,
    })
  })

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
  const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : ctx.workspaceRegistry

  const settings = {
    autoTag: config && config.autoTag !== false,
    retries: config && Number.isFinite(Number(config.retries)) ? Number(config.retries) : 6,
  }

  /**
   * Merge only the editable keys into this plugin's own bundle patch. Every
   * other key (sources, comments, unknown options) is preserved verbatim, so a
   * save from the settings page never drops configuration it does not know.
   */
  const writeProfileConfig = (next) => {
    const candidates = [
      path.join(PACKAGE_DIR, 'cordis.patch.yml'),
      process.env.DSH_PROFILE_DIR ? path.join(process.env.DSH_PROFILE_DIR, 'cordis.patch.yml') : undefined,
    ].filter(Boolean)
    const file = candidates.find((candidate) => fs.existsSync(candidate))
    if (!file) return false
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const startIndex = lines.findIndex((line) => /^\s*- id: github-flow\s*$/.test(line))
    if (startIndex < 0) return false
    const rowIndent = (lines[startIndex].match(/^\s*/) || [''])[0]
    const keyIndent = rowIndent + '  '
    let endIndex = lines.length
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() === '') continue
      const indent = (line.match(/^\s*/) || [''])[0]
      if (indent.length <= rowIndent.length) {
        endIndex = i
        break
      }
    }
    const block = lines.slice(startIndex, endIndex)
    const editable = ["reposRoot","autoTag","retries"]
    const valueOf = (key) => {
      const raw = next[key]
      if (typeof raw === 'string') return JSON.stringify(raw)
      if (typeof raw === 'boolean' || typeof raw === 'number') return String(raw)
      return JSON.stringify(raw === undefined || raw === null ? '' : raw)
    }
    const configIndex = block.findIndex((line) => /^\s+config:\s*$/.test(line))
    let nextBlock
    if (configIndex < 0) {
      nextBlock = [...block, keyIndent + 'config:', ...editable.map((key) => keyIndent + '  ' + key + ': ' + valueOf(key))]
    } else {
      const configIndent = (block[configIndex].match(/^\s*/) || [''])[0]
      const childIndent = configIndent + '  '
      let configEnd = block.length
      for (let i = configIndex + 1; i < block.length; i += 1) {
        const line = block[i]
        if (line.trim() === '') continue
        const indent = (line.match(/^\s*/) || [''])[0]
        if (indent.length <= configIndent.length) {
          configEnd = i
          break
        }
      }
      const children = block.slice(configIndex + 1, configEnd)
      const keyPattern = new RegExp('^\\s+([A-Za-z0-9_]+):')
      const present = new Set()
      const patched = children.map((line) => {
        const match = line.match(keyPattern)
        if (!match) return line
        present.add(match[1])
        if (!editable.includes(match[1])) return line
        return childIndent + match[1] + ': ' + valueOf(match[1])
      })
      const appended = editable.filter((key) => !present.has(key)).map((key) => childIndent + key + ': ' + valueOf(key))
      nextBlock = [...block.slice(0, configIndex + 1), ...patched, ...appended, ...block.slice(configEnd)]
    }
    const merged = [...lines.slice(0, startIndex), ...nextBlock, ...lines.slice(endIndex)]
    fs.writeFileSync(file, merged.join('\n'), 'utf8')
    return true
  }

  const readJsonBody = (req) =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk) => {
        data += chunk
        if (data.length > 200000) req.destroy()
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(data || '{}'))
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })

  const workspaceList = () => (registry && typeof registry.list === 'function' ? registry.list() : [])

  const candidatePaths = () => {
    const seen = new Set()
    const out = []
    const add = (target, title) => {
      const key = String(target).toLowerCase()
      if (seen.has(key)) return
      if (!fs.existsSync(path.join(target, '.git'))) return
      seen.add(key)
      out.push({ path: target, title: title || path.basename(target) })
    }
    for (const workspace of workspaceList()) add(workspace.path, workspace.title)
    if (reposRoot) {
      let entries = []
      try {
        entries = fs.readdirSync(reposRoot, { withFileTypes: true })
      } catch {
        entries = []
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        add(path.join(reposRoot, entry.name), entry.name)
      }
    }
    return out
  }

  if (webServer) {
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/github-flow/info',
        handler: (_req, res) => {
          sendJson(res, {
            skill: 'github-push',
            version: readVersion(),
            repo: repoUrl,
            script: scriptPath,
            skillFile: path.join(here, 'skill.md'),
            reposRoot: reposRoot || null,
          })
        },
      }),
    )

    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/github-flow/config',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, {
              reposRoot: reposRoot || null,
              autoTag: settings.autoTag !== false,
              retries: settings.retries || 6,
            })
            return
          }
          const body = await readJsonBody(req)
          const next = {
            reposRoot: typeof body.reposRoot === 'string' && body.reposRoot.trim() ? body.reposRoot.trim() : reposRoot || '',
            autoTag: body.autoTag !== false,
            retries: Math.min(30, Math.max(1, Math.round(Number(body.retries) || 6))),
          }
          try {
            const written = writeProfileConfig(next)
            settings.autoTag = next.autoTag
            settings.retries = next.retries
            sendJson(res, {
              ok: true,
              config: next,
              note: written ? '已保存到 profile 配置' : '已生效（未能写入配置文件）',
            })
          } catch (error) {
            sendJson(res, { ok: false, error: String(error && error.message) })
          }
        },
      }),
    )
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/github-flow/repos',
        handler: async (_req, res) => {
          const repos = []
          for (const candidate of candidatePaths()) {
            const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], candidate.path)
            const status = await git(['status', '--porcelain'], candidate.path)
            const remote = await git(['remote', 'get-url', 'origin'], candidate.path)
            repos.push({
              title: candidate.title,
              path: candidate.path,
              branch: branch.ok ? branch.stdout.trim() : '',
              remote: remote.ok ? remote.stdout.trim() : '',
              changes: status.ok ? status.stdout.split('\n').filter((line) => line.trim()).length : 0,
            })
          }
          sendJson(res, { repos, reposRoot: reposRoot || null })
        },
      }),
    )

    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/github-flow/push',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405).end('method not allowed')
            return
          }
          const body = await readJsonBody(req)
          const target = typeof body.path === 'string' ? body.path : ''
          const allowed = candidatePaths().map((candidate) => candidate.path)
          if (!allowed.includes(target)) {
            sendJson(res, { ok: false, error: 'path not allowed' })
            return
          }
          const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-RepoPath', target]
          if (typeof body.message === 'string' && body.message.trim()) {
            args.push('-Message', body.message.trim())
          }
          const result = await run('powershell.exe', args, { timeout: 180000 })
          const output = (result.stdout + '\n' + result.stderr).trim()
          const field = (name) => {
            const match = output.match(new RegExp('^\\s*' + name + '\\s+(.+)$', 'm'))
            return match ? match[1].trim() : ''
          }
          const verified = /remote\s+(\w+)\s*=\s*local\s+(\w+)/.exec(output)
          const ok = result.ok && /PUSH OK/.test(output)
          sendJson(res, {
            ok,
            code: result.code,
            repo: field('repo') || path.basename(target),
            branch: field('branch'),
            commit: field('commit'),
            verify: verified ? verified[0].trim() : '',
            tag: field('tag'),
            release: field('release'),
            output: output.slice(-6000),
          })
        },
      }),
    )
  }
}
