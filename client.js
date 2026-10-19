window.__ModuleLoader__.load({
  id: '@local/github-flow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const zh = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language || '')
    const text = {
      title: zh ? 'GitHub 推送流程' : 'GitHub Push Flow',
      hint: zh
        ? '任何会话说“推到 GitHub”都会加载 github-push skill，按同一套流程执行。脚本负责网络探测、重试、sha 校验与 Release。'
        : 'Every session that says "push to GitHub" loads the github-push skill and follows the same procedure. The script handles probing, retries, sha verification and releases.',
      skill: zh ? 'Skill' : 'Skill',
      script: zh ? '脚本' : 'Script',
      repo: zh ? '仓库' : 'Repository',
      copy: zh ? '复制命令' : 'Copy command',
      copied: zh ? '已复制' : 'Copied',
      reload: zh ? '刷新' : 'Reload',
    }

    const colors = {
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      borderSoft: 'var(--dsw-alias-border-l1)',
      border: 'var(--dsw-alias-border-l2)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    function SettingsSection() {
      const [info, setInfo] = React.useState(null)
      const [error, setError] = React.useState('')
      const [copied, setCopied] = React.useState(false)

      const load = React.useCallback(() => {
        fetch('/github-flow/info', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!payload) return
            setInfo(payload)
            setError('')
          })
          .catch((failure) => setError(String(failure && failure.message)))
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const command = info
        ? 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + info.script + '" -RepoPath "<repo>" -Message "feat: ..."'
        : ''

      const copy = () => {
        if (!command) return
        const done = () => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }
        try {
          navigator.clipboard.writeText(command).then(done, done)
        } catch {
          done()
        }
      }

      const row = (label, value) =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'baseline',
              gap: 12,
              padding: '8px 0',
              borderBottom: '1px solid ' + colors.borderSoft,
            },
          },
          h('span', { style: { width: 90, flex: 'none', fontSize: 12, color: colors.secondary } }, label),
          h('span', { style: { fontSize: 13, color: colors.primary, wordBreak: 'break-all' } }, value || '—'),
        )

      return h(
        'div',
        { style: { padding: '4px 2px', maxWidth: 720 } },
        h('h2', { style: { margin: '0 0 6px', fontSize: 16, color: colors.primary } }, text.title),
        h('p', { style: { margin: '0 0 16px', fontSize: 12, color: colors.secondary, lineHeight: 1.6 } }, text.hint),
        row(text.skill, info ? info.skill + ' · v' + info.version : '…'),
        row(text.script, info ? info.script : '…'),
        row(text.repo, info ? info.repo : '…'),
        error ? h('div', { style: { marginTop: 12, fontSize: 12, color: colors.error } }, error) : null,
        h(
          'div',
          { style: { display: 'flex', gap: 10, marginTop: 18 } },
          h(
            'button',
            {
              type: 'button',
              onClick: copy,
              style: {
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid ' + colors.border,
                background: 'transparent',
                color: copied ? colors.success : colors.primary,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              },
            },
            copied ? text.copied : text.copy,
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: load,
              style: {
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid ' + colors.border,
                background: 'transparent',
                color: colors.primary,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              },
            },
            text.reload,
          ),
        ),
        command
          ? h(
              'pre',
              {
                style: {
                  marginTop: 14,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--dsw-alias-bg-layer-2)',
                  color: colors.secondary,
                  fontSize: 11,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                },
              },
              command,
            )
          : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'github-flow', order: 37, label: text.title }, SettingsSection),
        )
      },
    }
  },
})
