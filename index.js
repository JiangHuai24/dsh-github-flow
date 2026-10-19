import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const repoUrl = 'https://github.com/extremity2740938284-create/dsh-github-flow'

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export const inject = ['skills']

/**
 * Registers one global skill: the fixed GitHub push procedure. A host-context
 * registration lands in the global layer, so every session sees it without
 * per-workspace setup. A same-origin route exposes the skill/script facts the
 * settings page renders.
 */
export function apply(ctx) {
  const template = fs.readFileSync(path.join(here, 'skill.md'), 'utf8')
  const content = template.split('{{SKILL_DIR}}').join(here)

  ctx.effect(() =>
    ctx.skills.register({
      name: 'github-push',
      description:
        '固定流程：把本地改动提交并推送到 GitHub —— 探测网络与凭据、提交、推送、校验远端、按需打 tag 与发 Release。',
      whenToUse:
        '当用户要求“推到 GitHub / 上传 / 同步改动”，或一次代码改动完成后需要落到远端仓库时。',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom',
      content,
    }),
  )

  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer
  if (webServer) {
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/github-flow/info',
        handler: (_req, res) => {
          const payload = JSON.stringify({
            skill: 'github-push',
            version: readVersion(),
            repo: repoUrl,
            script: path.join(here, 'scripts', 'gh-push.ps1'),
            skillFile: path.join(here, 'skill.md'),
          })
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end(payload)
        },
      }),
    )
  }
}
