import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export const inject = ['skills']

/**
 * Registers one global skill: the fixed GitHub push procedure. A host-context
 * registration lands in the global layer, so every session sees it without
 * per-workspace setup.
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
}
