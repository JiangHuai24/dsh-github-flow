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
      askPush: zh ? '填入推送指令' : 'Fill push prompt',
      askPushHint: zh ? '在当前输入框填入推送指令（不会自动发送）' : 'Fill the composer with a push prompt (does not send)',
      filled: zh ? '已填入输入框，按回车发送' : 'Filled the composer — press Enter to send',
      noInput: zh ? '找不到输入框' : 'Composer unavailable',
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

    // ---- shared footer-action spec (see docs/ui-standard.md) ----

    /** Shared footer-action metrics: one spec, applied to every plugin. */
    const FOOTER_BUTTON = {
      height: 28,
      minWidth: 28,
      padding: '0 6px',
      paddingIconOnly: 0,
      gap: 6,
      radius: 6,
      fontSize: 12,
      iconSize: 16,
    }

    function footerButtonStyle(active, colors) {
      return {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: FOOTER_BUTTON.gap,
        height: FOOTER_BUTTON.height,
        minWidth: FOOTER_BUTTON.minWidth,
        padding: FOOTER_BUTTON.padding,
        background: active ? colors.hover : 'transparent',
        border: 'none',
        borderRadius: FOOTER_BUTTON.radius,
        cursor: 'pointer',
        color: active ? colors.primary : colors.secondary,
        font: 'inherit',
        fontSize: FOOTER_BUTTON.fontSize,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }
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

// ---- setup wizard (anchor: gh auth login / create-vite flow) ----
// One decision per screen, a progress rail, and a hard gate before the write
// step so a half-configured setup can never look "done".
function Wizard({ steps, onDone, onCancel }) {
  const [index, setIndex] = React.useState(0)
  const [state, setState] = React.useState({})
  const step = steps[index]
  const isLast = index === steps.length - 1
  const canAdvance = step.canAdvance ? step.canAdvance(state) : true

  return h(
    'div',
    {
      role: 'dialog',
      'aria-label': '设置向导',
      style: { border: '1px solid ' + colors.border, borderRadius: 12, background: colors.panel, padding: 18, marginTop: 14 },
    },
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 } },
      ...steps.map((item, position) =>
        h('div', {
          key: item.id,
          title: item.title,
          style: {
            height: 3,
            flex: 1,
            borderRadius: 2,
            background: position <= index ? 'var(--dsw-alias-brand-primary)' : colors.border,
            opacity: position === index ? 0.7 : 1,
          },
        }),
      ),
      h('span', { style: { fontSize: 11, color: colors.tertiary, flex: 'none' } }, index + 1 + '/' + steps.length),
    ),
    h('div', { style: { fontSize: 14, color: colors.primary, marginBottom: 4 } }, step.title),
    step.hint ? h('div', { style: { fontSize: 12, color: colors.secondary, marginBottom: 12, lineHeight: 1.6 } }, step.hint) : null,
    h('div', { style: { minHeight: 72 } }, step.render({ state, set: (patch) => setState((current) => ({ ...current, ...patch })) })),
    step.warn && step.warn(state)
      ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-state-warning-primary)', marginTop: 8 } }, step.warn(state))
      : null,
    h(
      'div',
      { style: { display: 'flex', gap: 8, marginTop: 16 } },
      h(
        'button',
        {
          type: 'button',
          onClick: () => (index === 0 ? onCancel() : setIndex(index - 1)),
          style: {
            height: 28,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid ' + colors.border,
            background: 'transparent',
            color: colors.secondary,
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 12,
          },
        },
        index === 0 ? '取消' : '上一步',
      ),
      h('span', { style: { flex: 1 } }),
      h(
        'button',
        {
          type: 'button',
          disabled: !canAdvance,
          onClick: () => (isLast ? onDone(state) : setIndex(index + 1)),
          style: {
            height: 28,
            padding: '0 16px',
            borderRadius: 6,
            border: 'none',
            background: canAdvance ? 'var(--dsw-alias-brand-primary)' : colors.border,
            color: canAdvance ? '#fff' : colors.tertiary,
            cursor: canAdvance ? 'pointer' : 'not-allowed',
            font: 'inherit',
            fontSize: 12,
          },
        },
        isLast ? '完成' : '下一步',
      ),
    ),
  )
}

function Choice({ value, current, onChange, title, hint }) {
  const selected = value === current
  return h(
    'button',
    {
      type: 'button',
      role: 'radio',
      'aria-checked': selected ? 'true' : 'false',
      onClick: () => onChange(value),
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 10px',
        marginBottom: 6,
        borderRadius: 8,
        border: '1px solid ' + (selected ? 'var(--dsw-alias-brand-primary)' : colors.border),
        background: selected ? colors.hover : 'transparent',
        color: colors.primary,
        cursor: 'pointer',
        font: 'inherit',
      },
    },
    h('span', {
      style: {
        width: 14,
        height: 14,
        flex: 'none',
        marginTop: 2,
        borderRadius: '50%',
        border: '1.5px solid ' + (selected ? 'var(--dsw-alias-brand-primary)' : colors.border),
        background: selected ? 'var(--dsw-alias-brand-primary)' : 'transparent',
      },
    }),
    h(
      'span',
      { style: { minWidth: 0 } },
      h('div', { style: { fontSize: 13 } }, title),
      hint ? h('div', { style: { fontSize: 11, color: colors.tertiary, marginTop: 2, lineHeight: 1.5 } }, hint) : null,
    ),
  )
}

    // ---- shared settings primitives (docs/ui-standard.md) ----
    function Field({ label, hint, children }) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'flex-start',
            gap: 16,
            padding: '10px 0',
            borderBottom: '1px solid ' + colors.borderSoft,
          },
        },
        h(
          'div',
          { style: { width: 200, flex: 'none' } },
          h('div', { style: { fontSize: 13, color: colors.primary } }, label),
          hint ? h('div', { style: { marginTop: 2, fontSize: 11, color: colors.tertiary, lineHeight: 1.5 } }, hint) : null,
        ),
        h('div', { style: { flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' } }, children),
      )
    }

    function Group({ title, children }) {
      return h(
        'div',
        { style: { marginTop: 20 } },
        h('div', { style: { fontSize: 12, fontWeight: 600, color: colors.secondary, marginBottom: 4 } }, title),
        ...React.Children.toArray(children),
      )
    }

    function Toggle({ value, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': value ? 'true' : 'false',
          onClick: () => onChange(!value),
          style: {
            width: 34,
            height: 18,
            flex: 'none',
            borderRadius: 9,
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            position: 'relative',
            background: value ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l2)',
            transition: 'background 120ms',
          },
        },
        h('span', {
          style: {
            position: 'absolute',
            top: 2,
            left: value ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 120ms',
          },
        }),
      )
    }

    function NumberField({ value, onChange, min, max, suffix }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('input', {
          type: 'number',
          value: String(value),
          min,
          max,
          onChange: (event) => {
            const next = Number(event.target.value)
            if (Number.isFinite(next)) onChange(next)
          },
          style: {
            width: 96,
            padding: '5px 8px',
            borderRadius: 6,
            border: '1px solid ' + colors.border,
            background: colors.layer,
            color: colors.primary,
            font: 'inherit',
            fontSize: 12,
          },
        }),
        suffix ? h('span', { style: { fontSize: 11, color: colors.tertiary } }, suffix) : null,
      )
    }

    function TextField({ value, onChange, placeholder, width }) {
      return h('input', {
        value: value || '',
        placeholder,
        onChange: (event) => onChange(event.target.value),
        style: {
          width: width || 260,
          padding: '5px 8px',
          borderRadius: 6,
          border: '1px solid ' + colors.border,
          background: colors.layer,
          color: colors.primary,
          font: 'inherit',
          fontSize: 12,
        },
      })
    }

    function SaveBar({ dirty, saving, onSave, onReset, note }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 } },
        h(
          'button',
          {
            type: 'button',
            disabled: !dirty || saving,
            onClick: onSave,
            style: {
              height: 28,
              padding: '0 14px',
              borderRadius: 6,
              border: 'none',
              background: dirty && !saving ? 'var(--dsw-alias-brand-primary)' : colors.border,
              color: dirty && !saving ? '#fff' : colors.tertiary,
              cursor: dirty && !saving ? 'pointer' : 'not-allowed',
              font: 'inherit',
              fontSize: 12,
            },
          },
          saving ? '保存中…' : '保存',
        ),
        h(
          'button',
          {
            type: 'button',
            onClick: onReset,
            style: {
              height: 28,
              padding: '0 12px',
              borderRadius: 6,
              border: '1px solid ' + colors.border,
              background: 'transparent',
              color: colors.secondary,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 12,
            },
          },
          '还原',
        ),
        note ? h('span', { style: { fontSize: 11, color: colors.tertiary } }, note) : null,
      )
    }

// ---- composer action: fill a push prompt into the current input ----
    // Uses the documented inputActions.setDraft so the text is a draft the human
    // reviews: it never submits on its own.
    function ComposerAction() {
      const [account, setAccount] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        fetch('/github-flow/config', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((payload) => {
            if (alive && payload && payload.activeAccount) setAccount(payload.activeAccount)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      return function ComposerActionView(props) {
        const actions = props && props.inputActions
        const sessionId = props && props.sessionId
        const [note, setNote] = React.useState('')

        const fill = () => {
          if (!actions || typeof actions.setDraft !== 'function') {
            setNote(text.noInput)
            return
          }
          const target = sessionId ? String(sessionId) : ''
          const prompt = [
            '请使用 github-push skill，把当前工作区的项目推送到 GitHub。',
            account ? '使用账号：' + account : '使用默认账号。',
            '要求：',
            '- 推送前检查 README/LICENSE/package.json 里没有个人账号、token、绝对路径等敏感信息，有就替换成占位符再推；',
            '- 提交信息与仓库描述里不要出现我的个人账号名；',
            '- 推完给我回执：分支、提交 sha、远端=本地校验、Release 链接。',
          ].filter(Boolean).join('\n')
          setBusy(true)
          try {
            actions.setDraft(prompt)
            setNote(text.filled)
          } catch (error) {
            setNote(String(error && error.message))
          } finally {
            setBusy(false)
            setTimeout(() => setNote(''), 4000)
          }
          void target
        }

        return h(
          'button',
          {
            type: 'button',
            title: (note || text.askPushHint) + (account ? ' · ' + account : ''),
            'aria-label': text.askPush,
            onClick: fill,
            disabled: busy,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              height: 28,
              padding: '0 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: busy ? 'progress' : 'pointer',
              color: account ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              font: 'inherit',
              fontSize: 12,
              whiteSpace: 'nowrap',
            },
          },
          h(
            'svg',
            {
              width: 14,
              height: 14,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': true,
              style: { flex: 'none', display: 'block' },
            },
            h('path', { d: 'M12 20.5V3.5' }),
            h('path', { d: 'M3.5 12L12 3.5l8.5 8.5' }),
          ),
          h('span', null, account ? account : 'GitHub'),
        )
      }
    }

// ---- account management (no tokens stored: login switch only) ----
    function AccountsPanel() {
      const [store, setStore] = React.useState({ active: null, list: [] })
      const [login, setLogin] = React.useState('')
      const [note, setNote] = React.useState('')

      const load = React.useCallback(() => {
        fetch('/github-flow/accounts', { cache: 'no-store' })
          .then((r) => (r.ok ? r.json() : null))
          .then((payload) => payload && setStore({ active: payload.active, list: payload.list || [] }))
          .catch(() => {})
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      const post = (body) => {
        setNote('')
        fetch('/github-flow/accounts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((payload) => {
            if (!payload) return
            if (payload.ok === false) {
              setNote(payload.error || '失败')
              return
            }
            setStore({ active: payload.active, list: payload.list || [] })
            setLogin('')
          })
          .catch((error) => setNote(String(error && error.message)))
      }

      return h(
        'div',
        { style: { marginTop: 20 } },
        h('div', { style: { fontSize: 12, fontWeight: 600, color: colors.secondary, marginBottom: 6 } }, 'GitHub 账号'),
        h(
          'div',
          { style: { fontSize: 11, color: colors.tertiary, marginBottom: 8, lineHeight: 1.6 } },
          '这里只记录账号名称与提交身份，不保存任何 token。真正的登录凭据仍由系统凭据管理器保管；切换账号只改默认身份，推送时按需重新登录。',
        ),
        store.list.length === 0
          ? h('div', { style: { fontSize: 12, color: colors.tertiary, padding: '6px 0' } }, '还没有添加账号')
          : store.list.map((account) =>
              h(
                'div',
                {
                  key: account.login,
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 0',
                    borderBottom: '1px solid ' + colors.borderSoft,
                    fontSize: 12,
                  },
                },
                h('span', { style: { width: 16, color: account.login === store.active ? colors.success : colors.tertiary } }, account.login === store.active ? '●' : '○'),
                h('span', { style: { color: colors.primary } }, account.login),
                h('span', { style: { flex: 1 } }),
                account.login === store.active
                  ? h('span', { style: { fontSize: 11, color: colors.tertiary } }, '当前账号')
                  : h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => post({ action: 'activate', login: account.login }),
                        style: {
                          height: 24,
                          padding: '0 10px',
                          borderRadius: 6,
                          border: '1px solid ' + colors.border,
                          background: 'transparent',
                          color: colors.primary,
                          cursor: 'pointer',
                          font: 'inherit',
                          fontSize: 11,
                        },
                      },
                      '切换到此账号',
                    ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => post({ action: 'remove', login: account.login }),
                    style: {
                      height: 24,
                      padding: '0 8px',
                      borderRadius: 6,
                      border: '1px solid ' + colors.border,
                      background: 'transparent',
                      color: colors.tertiary,
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: 11,
                    },
                  },
                  '移除',
                ),
              ),
            ),
        h(
          'div',
          { style: { display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' } },
          h(TextField, { value: login, onChange: setLogin, placeholder: 'GitHub 用户名，如 octocat', width: 220 }),
          h(
            'button',
            {
              type: 'button',
              disabled: !login.trim(),
              onClick: () => post({ action: 'add', login: login.trim() }),
              style: {
                height: 28,
                padding: '0 12px',
                borderRadius: 6,
                border: 'none',
                background: login.trim() ? 'var(--dsw-alias-brand-primary)' : colors.border,
                color: login.trim() ? '#fff' : colors.tertiary,
                cursor: login.trim() ? 'pointer' : 'not-allowed',
                font: 'inherit',
                fontSize: 12,
              },
            },
            '添加账号',
          ),
          h(
            'a',
            {
              href: 'https://github.com/login',
              target: '_blank',
              rel: 'noreferrer',
              style: { fontSize: 11, color: colors.secondary, textDecoration: 'underline' },
            },
            '打开 GitHub 登录页',
          ),
          note ? h('span', { style: { fontSize: 11, color: colors.error } }, note) : null,
        ),
      )
    }

function SettingsSection() {
      const [info, setInfo] = React.useState(null)
      const [wizardOpen, setWizardOpen] = React.useState(false)
      const [config, setConfig] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [saving, setSaving] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [copied, setCopied] = React.useState(false)

      const load = React.useCallback(() => {
        Promise.all([
          fetch('/github-flow/info', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
          fetch('/github-flow/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
        ])
          .then(([infoPayload, configPayload]) => {
            if (infoPayload) setInfo(infoPayload)
            if (configPayload) {
              setConfig(configPayload)
              setDraft(configPayload)
            }
          })
          .catch(() => {})
      }, [])

      React.useEffect(() => {
        load()
        try {
          if (!window.localStorage.getItem('github-flow.setup-done')) setWizardOpen(true)
        } catch {
          setWizardOpen(true)
        }
      }, [load])

      const finishWizard = (values) => {
        try {
          window.localStorage.setItem('github-flow.setup-done', '1')
        } catch {
          // the flag is a convenience, not a requirement
        }
        setWizardOpen(false)
        setDraft((current) => ({ ...(current || {}), ...values }))
        setNote('已按向导设置，记得点保存')
      }

      const dirty = Boolean(draft && config && JSON.stringify(draft) !== JSON.stringify(config))
      const set = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }))

      const save = () => {
        setSaving(true)
        setNote('')
        fetch('/github-flow/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((payload) => {
            if (payload && payload.ok) {
              setConfig(payload.config)
              setDraft(payload.config)
              setNote(payload.note || '已保存')
            } else {
              setNote((payload && payload.error) || '保存失败')
            }
          })
          .catch((error) => setNote(String(error && error.message)))
          .finally(() => setSaving(false))
      }

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

      return h(
        'div',
        { style: { padding: '4px 2px', maxWidth: 760 } },
        h('h2', { style: { margin: '0 0 4px', fontSize: 16, color: colors.primary } }, text.title),
        h('p', { style: { margin: '0 0 4px', fontSize: 12, color: colors.secondary } }, text.hint),

        wizardOpen
          ? h(Wizard, {
              onCancel: () => {
                setWizardOpen(false)
                try {
                  window.localStorage.setItem('github-flow.setup-done', '1')
                } catch {
                  // ignore
                }
              },
              onDone: finishWizard,
              steps: [
                {
                  id: 'root',
                  title: '第 1 步：选择仓库根目录',
                  hint: '推送面板会扫描这个目录下的 git 仓库。通常就是存放项目的文件夹。',
                  canAdvance: (state) => Boolean(state.reposRoot && state.reposRoot.trim()),
                  render: ({ state, set }) =>
                    h(
                      'div',
                      null,
                      h(Choice, {
                        value: 'D:\\WorkBuddy',
                        current: state.reposRoot,
                        onChange: (value) => set({ reposRoot: value }),
                        title: 'D:\\WorkBuddy',
                        hint: '检测到本机常用仓库目录',
                      }),
                      h(Choice, {
                        value: '',
                        current: state.reposRoot === '' ? 'custom' : state.reposRoot,
                        onChange: () => set({ reposRoot: '' }),
                        title: '自定义路径',
                        hint: '在下一步填写',
                      }),
                      h(TextField, {
                        value: state.reposRoot || '',
                        onChange: (value) => set({ reposRoot: value }),
                        placeholder: '例如 D:\\WorkBuddy',
                        width: 320,
                      }),
                    ),
                },
                {
                  id: 'safety',
                  title: '第 2 步：确认推送行为',
                  hint: '这些默认值是安全的，可以保持不变。',
                  render: ({ state, set }) =>
                    h(
                      'div',
                      null,
                      h(Choice, {
                        value: 'safe',
                        current: state.mode || 'safe',
                        onChange: (value) => set({ mode: value, autoTag: false, retries: 6 }),
                        title: '推荐：只提交并推送',
                        hint: '不自动打 tag；网络抖动时重试 6 次；推完校验远端 sha',
                      }),
                      h(Choice, {
                        value: 'tag',
                        current: state.mode,
                        onChange: (value) => set({ mode: value, autoTag: true, retries: 6 }),
                        title: '推送并自动打 tag',
                        hint: '适合有版本号的仓库，会在 HEAD 上创建标签',
                      }),
                    ),
                },
                {
                  id: 'check',
                  title: '第 3 步：检查账号与网络',
                  hint: '推送需要 GitHub 凭据。这里只做只读检查，不会写入任何东西。',
                  canAdvance: () => true,
                  warn: () => '若提示未登录：在终端执行一次 git push，按弹窗完成 GitHub 登录即可。',
                  render: () =>
                    h(
                      'div',
                      { style: { fontSize: 12, color: colors.secondary, lineHeight: 1.8 } },
                      h('div', null, '✓ 脚本：' + (info ? info.script : '…')),
                      h('div', null, '✓ 仓库：' + (info ? info.repo : '…')),
                      h('div', null, '凭据由 Git Credential Manager 管理，token 不会写进任何文件。'),
                    ),
                },
              ],
            })
          : null,
        h(AccountsPanel, null),
        h(
          Group,
          { title: '推送面板' },
          h(
            Field,
            { label: '仓库根目录', hint: '面板会列出这里的 git 仓库' },
            draft
              ? h(TextField, { value: draft.reposRoot || '', onChange: set('reposRoot'), placeholder: 'D:\\WorkBuddy', width: 300 })
              : null,
          ),
          h(
            Field,
            { label: '自动打 tag', hint: '有版本号时推送后自动创建标签' },
            draft ? h(Toggle, { value: draft.autoTag !== false, onChange: set('autoTag') }) : null,
          ),
          h(
            Field,
            { label: '重试次数', hint: '网络抖动时最多重试几次' },
            draft ? h(NumberField, { value: draft.retries || 6, min: 1, max: 30, onChange: set('retries'), suffix: '次' }) : null,
          ),
        ),

        draft ? h(SaveBar, { dirty, saving, onSave: save, onReset: () => setDraft(config), note }) : null,
        h(
          'div',
          { style: { marginTop: 10 } },
          h(
            'button',
            {
              type: 'button',
              onClick: () => setWizardOpen(true),
              style: {
                height: 28,
                padding: '0 12px',
                borderRadius: 6,
                border: '1px solid ' + colors.border,
                background: 'transparent',
                color: colors.secondary,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12,
              },
            },
            '重新运行设置向导',
          ),
        ),

        h(
          Group,
          { title: '信息' },
          h(
            Field,
            { label: 'Skill' },
            h('span', { style: { fontSize: 12, color: colors.secondary } }, info ? info.skill + ' · v' + info.version : '…'),
          ),
          h(
            Field,
            { label: '脚本' },
            h('span', { style: { fontSize: 11, color: colors.tertiary, wordBreak: 'break-all', textAlign: 'right' } }, info ? info.script : '…'),
          ),
          h(
            Field,
            { label: '仓库' },
            h('span', { style: { fontSize: 11, color: colors.tertiary, wordBreak: 'break-all', textAlign: 'right' } }, info ? info.repo : '…'),
          ),
        ),

        h(
          'div',
          { style: { display: 'flex', gap: 10, marginTop: 16 } },
          h(
            'button',
            {
              type: 'button',
              onClick: copy,
              style: {
                height: 28,
                padding: '0 12px',
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
                height: 28,
                padding: '0 12px',
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
                  marginTop: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: colors.layer,
                  color: colors.secondary,
                  fontSize: 11,
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
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'github-flow-push', order: 11, label: text.push }, function PushAction() {
            const open = useOpenState()
            const label = zh ? 'GitHub' : 'GitHub'
            return h(
              'button',
              {
                type: 'button',
                title: text.pushHint,
                'aria-label': text.push,
                'aria-pressed': open ? 'true' : 'false',
                onClick: () => setOpen(!open),
                style: footerButtonStyle(open, colors),
              },
              h(
                'svg',
                {
                  width: FOOTER_BUTTON.iconSize,
                  height: FOOTER_BUTTON.iconSize,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  'aria-hidden': true,
                  style: { flex: 'none', display: 'block' },
                },
                h('path', { d: 'M12 20.5V3.5' }),
                h('path', { d: 'M3.5 12L12 3.5l8.5 8.5' }),
              ),
              h('span', null, label),
            )
          }),
        )

        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: 'github-flow-ask-push', order: 20, label: text.askPush },
            ComposerAction(),
          ),
        )

        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: 'github-flow-push-panel', order: 61, label: text.push }, PushPanel),
        )
      },
    }
  },
})
