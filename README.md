# dsh-github-flow

把「提交 → 推送 → 校验 → 发 Release」固化成**所有会话共用**的 DSH skill：`github-push`。

> Registers the `github-push` skill (plus its script) into the global skill layer, so every DeepSeek Harness session follows one fixed GitHub procedure instead of ad-hoc commands.


## 会话内一键推送

输入框左侧有一个 GitHub 按钮，点击后**在当前会话输入框填入推送指令**（不会自动发送，按回车才发送）。填进去的指令包含：

- 使用 `github-push` skill 推送当前工作区
- 推送前检查 README/LICENSE/package.json 里是否有个人账号、token、绝对路径，有就替换成占位符
- 提交信息与仓库描述不出现个人账号
- 推完给出回执（分支 / sha / 校验 / Release）

## 多账号管理

设置页「GitHub 推送流程」→「GitHub 账号」：添加账号名、切换当前账号、移除、按仓库绑定账号。

**插件不保存任何 token**：这里只记录账号名与提交身份，真正的登录凭据由系统 Git Credential Manager 保管，推送时按需重新登录。

## 推送前脱敏扫描

`POST /github-flow/scrub` 扫描将要推送的文件，报告个人账号（URL 之外的）、GitHub token、Bearer token、私钥、邮箱等敏感项。只读检查，不会擅自改你的文件。

## UI 规范

侧边栏底部按钮、设置页、浮层面板的尺寸与交互统一见 [docs/ui-standard.md](docs/ui-standard.md)。新增插件请照此实现，不要另起数值。

## 它解决什么

推 GitHub 每次都会踩同样的坑：网络时通时断、代理是死的、凭据没缓存、推完没校验、tag 指错提交。这个插件把这些判断写成一份 skill，任何会话说「推到 GitHub」都会加载它，按同一套步骤执行。

## 装了什么

| 内容 | 说明 |
| --- | --- |
| `github-push` skill | 全局层注册，所有会话可见，`catalog` 实时刷新 |
| `scripts/gh-push.ps1` | 一键执行：探测网络 → 提交 → 推送（带重试）→ 校验 sha → 打 tag → 发 Release |

## 安装

```text
plugin_manager  action=install_bundle  target=<本仓库绝对路径>
```

插件行 id：`github-flow`。

## 设置页

「设置 → GitHub 推送流程」展示 skill 名称、脚本路径与仓库地址，并支持一键复制命令；数据来自 Host 的只读接口 `/github-flow/info`。

## 一键推送

侧边栏底部有一个「↑ GitHub」按钮：打开面板后会列出所有 git 工作区（分支、改动数、路径），填一句提交信息点「提交并推送」即可。

- 走的就是同一条固定流程（`gh-push.ps1`）：探测网络 → 提交 → 推送 → 校验 sha
- 有改动时提交信息必填；没有改动时按钮变成「只推送」
- 面板底部显示脚本输出，成功/失败一目了然

## 用法

任何会话里说「推到 GitHub」，模型会加载 `github-push` 并执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "<本仓库>\scripts\gh-push.ps1" `
  -RepoPath "<repo path>" `
  -Message "feat: ..." `
  -Tag "v1.2.3" `
  -ReleaseName "v1.2.3 - ..."
```

| 参数 | 说明 |
| --- | --- |
| `-RepoPath` | 仓库路径，默认当前目录 |
| `-Message` | 有未提交改动时必填 |
| `-Tag` | 可选，推送后在 HEAD 上打 tag |
| `-ReleaseName` | 可选，配合 `-Tag` 创建/更新 GitHub Release |
| `-DryRun` | 只探测与打印，不提交、不推送 |

## 流程要点

1. **推完必须校验** `remote refs/heads/<branch> == local HEAD`；
2. **不猜网络**：直连与 `127.0.0.1:7890` 交替失效时，先探测再选路；
3. **凭据不落库**：token 只从 Git Credential Manager 取，不写进仓库、不回显。

## 依赖

- Windows PowerShell 5.1+（脚本保持纯 ASCII，避免无 BOM UTF-8 被按 ANSI 解析）
- `git`、`curl.exe`（Windows 10+ 自带）
- DSH 的 `skills` 服务（Host 内置）

## License

MIT © 2026 dsh-github-flow contributors
