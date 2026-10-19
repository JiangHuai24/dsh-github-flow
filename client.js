window.__ModuleLoader__.load({
  id: '@local/github-flow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const zh = typeof navigator !== 'undefined' && /^zh\b/i.test(navigator.language || '')
    const text = {
      title: zh ? 'GitHub 推送流程' : 'GitHub Push Flow',
      push: zh ? '推送 GitHub' : 'Push to GitHub',
      pushHint: zh ? '把当前工作区的改动提交并推送到 GitHub（走固定流程）' : 'Commit and push a workspace using the fixed procedure',
      hint: zh
        ? '任何会话说“推到 GitHub”都会加载 github-push skill，按同一套流程执行。脚本负责网络探测、重试、sha 校验与 Release。'
        : 'Every session that says "push to GitHub" loads the github-push skill and follows the same procedure. The script handles probing, retries, sha verification and releases.',
      skill: zh ? 'Skill' : 'Skill',
      script: zh ? '脚本' : 'Script',
      repo: zh ? '仓库' : 'Repository',
      copy: zh ? '复制命令' : 'Copy command',
      copied: zh ? '已复制' : 'Copied',
      reload: zh ? '刷新' : 'Reload',
      noRepos: zh ? '没有找到 git 工作区' : 'No git workspace found',
      changes: zh ? '处改动' : 'changes',
      clean: zh ? '无未提交改动' : 'clean',
      message: zh ? '提交信息（有改动时必填，如 feat: ...）' : 'Commit message (required when dirty)',
      run: zh ? '提交并推送' : 'Commit & push',
      pushOnly: zh ? '只推送' : 'Push only',
      running: zh ? '执行中…' : 'Running…',
      close: zh ? '关闭' : 'Close',
      output: zh ? '输出' : 'Output',
      failed: zh ? '失败' : 'Failed',
      pushOk: zh ? '推送成功' : 'Push succeeded',
      pushFail: zh ? '推送失败' : 'Push failed',
    }

    const colors = {
      primary: 'var(--dsw-alias-label-primary)',
      secondary: 'var(--dsw-alias-label-secondary)',
      tertiary: 'var(--dsw-alias-label-tertiary)',
      borderSoft: 'var(--dsw-alias-border-l1)',
      border: 'var(--dsw-alias-border-l2)',
      panel: 'var(--dsw-alias-bg-overlay)',
      layer: 'var(--dsw-alias-bg-layer-2)',
      hover: 'var(--dsw-alias-interactive-bg-hover)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    const listeners = new Set()
    let isOpen = false
    const subscribe = (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    }
    const getOpen = () => isOpen
    const setOpen = (next) => {
      if (isOpen === next) return
      isOpen = next
      for (const fn of listeners) fn()
    }

    function useOpenState() {
      const [open, setOpenState] = React.useState(getOpen())
      React.useEffect(() => {
        const listener = () => setOpenState(getOpen())
        listeners.add(listener)
        return () => listeners.delete(listener)
      }, [])
      return open
    }

    const button = (label, onClick, extra) =>
      h(
        'button',
        {
          type: 'button',
          onClick,
          style: {
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid ' + colors.border,
            background: 'transparent',
            color: colors.primary,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 12,
            ...extra,
          },
        },
        label,
      )

    function PushPanel() {
      const open = useOpenState()
      const [repos, setRepos] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [message, setMessage] = React.useState('')
      const [running, setRunning] = React.useState('')
      const [output, setOutput] = React.useState('')
      const [ok, setOk] = React.useState(null)

      const load = React.useCallback(() => {
        setLoading(true)
        fetch('/github-flow/repos', { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!payload || !Array.isArray(payload.repos)) return
            setRepos(payload.repos)
            setError('')
          })
          .catch((failure) => setError(String(failure && failure.message)))
          .finally(() => setLoading(false))
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        setOutput('')
        setOk(null)
        load()
        return undefined
      }, [open, load])

      const push = (repo) => {
        if (running) return
        const dirty = repo.changes > 0
        if (dirty && !message.trim()) {
          setOk(false)
          setOutput(text.message)
          return
        }
        setRunning(repo.path)
        setOk(null)
        setOutput(text.running)
        fetch('/github-flow/push', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: repo.path, message: dirty ? message.trim() : '' }),
        })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (!payload) throw new Error('no response')
            setOk(payload.ok === true)
            const lines = []
            if (payload.ok) {
              lines.push(text.pushOk + ' · ' + (payload.repo || ''))
              if (payload.branch) lines.push('branch  ' + payload.branch)
              if (payload.commit) lines.push('commit  ' + payload.commit)
              if (payload.verify) lines.push('verify  ' + payload.verify)
              if (payload.release) lines.push('release ' + payload.release)
            } else {
              lines.push(text.pushFail + ' · ' + (payload.repo || ''))
              if (payload.error) lines.push(payload.error)
            }
            lines.push('')
            lines.push(payload.output || '')
            setOutput(lines.join('\n').trim())
            load()
          })
          .catch((failure) => {
            setOk(false)
            setOutput(String(failure && failure.message))
          })
          .finally(() => setRunning(''))
      }

      if (!open) return null

      return h(
        'div',
        {
          style: {
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '10vh',
            background: 'color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent)',
          },
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) setOpen(false)
          },
        },
        h(
          'div',
          {
            role: 'dialog',
            'aria-label': text.push,
            style: {
              width: 'min(680px, 92vw)',
              maxHeight: '70vh',
              overflowY: 'auto',
              background: colors.panel,
              border: '1px solid ' + colors.border,
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
            },
          },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 } },
            h('h3', { style: { margin: 0, fontSize: 15, color: colors.primary } }, text.push),
            h('span', { style: { fontSize: 11, color: colors.tertiary } }, text.pushHint),
            h('span', { style: { flex: 1 } }),
            button(text.close, () => setOpen(false)),
          ),
          h('input', {
            value: message,
            placeholder: text.message,
            onChange: (event) => setMessage(event.target.value),
            style: {
              width: '100%',
              boxSizing: 'border-box',
              margin: '10px 0 6px',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid ' + colors.borderSoft,
              background: colors.layer,
              color: colors.primary,
              font: 'inherit',
              fontSize: 12,
            },
          }),
          error ? h('div', { style: { fontSize: 12, color: colors.error, marginBottom: 6 } }, error) : null,
          loading && repos.length === 0
            ? h('div', { style: { fontSize: 12, color: colors.tertiary, padding: '10px 0' } }, text.running)
            : null,
          repos.length === 0 && !loading
            ? h('div', { style: { fontSize: 12, color: colors.tertiary, padding: '10px 0' } }, text.noRepos)
            : repos.map((repo) =>
                h(
                  'div',
                  {
                    key: repo.path,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '1px solid ' + colors.borderSoft,
                    },
                  },
                  h(
                    'div',
                    { style: { minWidth: 0, flex: 1 } },
                    h('div', { style: { fontSize: 13, color: colors.primary } }, repo.title || repo.path),
                    h(
                      'div',
                      { style: { fontSize: 11, color: colors.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                      repo.branch + ' · ' + (repo.changes > 0 ? repo.changes + ' ' + text.changes : text.clean) + ' · ' + repo.path,
                    ),
                  ),
                  running === repo.path
                    ? h('span', { style: { fontSize: 11, color: colors.tertiary } }, text.running)
                    : h(
                        'div',
                        { style: { display: 'flex', gap: 8 } },
                        repo.changes > 0
                          ? button(text.run, () => push(repo), { borderColor: colors.success })
                          : button(text.pushOnly, () => push(repo)),
                      ),
                ),
              ),
          output
            ? h(
                'pre',
                {
                  style: {
                    marginTop: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: colors.layer,
                    color: ok === false ? colors.error : colors.secondary,
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: '24vh',
                    overflowY: 'auto',
                  },
                },
                output,
              )
            : null,
        ),
      )
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
          button(copied ? text.copied : text.copy, copy, { color: copied ? colors.success : colors.primary }),
          button(text.reload, load),
        ),
        command
          ? h(
              'pre',
              {
                style: {
                  marginTop: 14,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: colors.layer,
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

        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'github-flow-push', order: 11, label: text.push }, function PushAction(props) {
            const wide = props && props.wide !== false
            const open = useOpenState()
            return h(
              'button',
              {
                type: 'button',
                title: text.pushHint,
                'aria-label': text.push,
                'aria-pressed': open ? 'true' : 'false',
                onClick: () => setOpen(!open),
                style: {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: open ? colors.hover : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: open ? colors.primary : colors.secondary,
                  padding: wide ? '4px 8px' : '4px',
                  borderRadius: 6,
                  font: 'inherit',
                },
              },
              h(
                'svg',
                {
                  width: 16,
                  height: 16,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  'aria-hidden': true,
                  style: { flex: 'none' },
                },
                h('path', { d: 'M12 19V5' }),
                h('path', { d: 'M5 12l7-7 7 7' }),
              ),
              wide ? h('span', null, text.push) : null,
            )
          }),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'github-flow-push-panel', order: 61, label: text.push }, PushPanel),
        )
      },
    }
  },
})
