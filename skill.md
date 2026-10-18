# GitHub 推送固定流程

这是所有会话共用的**唯一**推送流程。任何“推到 GitHub / 上传 / 同步改动”的请求都按这里执行，不要临时发明步骤。

## 0. 三条铁律

1. **推完要校验**：远端 `refs/heads/<branch>` 必须等于本地 `HEAD`，否则视为没推成功。
2. **不猜网络**：本机直连与代理（`127.0.0.1:7890`）会交替失效，每次推送前先探测，哪条通走哪条。
3. **凭据不落库**：GitHub token 只从 Git Credential Manager 取（`git credential fill`），不写进仓库、不回显、不写进日志。

## 1. 前置检查（缺一不可）

```powershell
git -C <repo> rev-parse --abbrev-ref HEAD     # 当前分支
git -C <repo> status --short                   # 待提交内容
git credential fill                            # protocol=https / host=github.com
```

- `git credential fill` 没有输出 `password=`：让用户在弹窗里登录一次（Git Credential Manager），或提供 PAT；**不要**尝试去磁盘上找 token。
- 仓库在远端不存在：先在 GitHub 建空仓库（不要勾 README），再推。GitHub 不支持 push 建仓。

## 2. 探测网络并选择路径

```powershell
curl.exe -s -o NUL -w "%{http_code}" --max-time 8 https://github.com
curl.exe -s -o NUL -w "%{http_code}" --max-time 8 -x http://127.0.0.1:7890 https://github.com
```

- 直连 `200` → 推的时候显式绕开代理：`git -c http.proxy= -c https.proxy= push`
- 只有代理 `200` → `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push`
- 两个都失败 → 等几秒重试；连续失败再向用户报告网络不可用，不要空等。

> Windows 系统代理可能是坏的：`HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable` 指向死端口时，浏览器和 GCM 授权页都会打不开。必要时关掉系统代理，用 TUN/直连。

## 3. 提交

- 先更新版本号（`package.json`）与文档，再一起提交；一个改动一个提交。
- 提交信息用祈使句：`feat: …` / `fix: …` / `test: …` / `chore: …`，正文写「为什么」。
- 作者身份用用户本人（`git config user.name/user.email`），不要用 AI 名义。

```powershell
git -C <repo> add -A
git -C <repo> commit -m "<type>: <subject>" -m "<why>"
```

## 4. 推送并校验

```powershell
$env:GIT_TERMINAL_PROMPT='0'; $env:GCM_INTERACTIVE='Never'
git -c http.proxy= -c https.proxy= push origin <branch>
git -c http.proxy= -c https.proxy= ls-remote --heads origin
git rev-parse HEAD
```

两个 sha 相等才算完成。若 `push` 输出里出现 `main -> main` 但退出码非 0，那是 PowerShell 把 stderr 当错误，**以 ls-remote 为准**。

## 5. 打 tag 与 Release（有版本号时）

- tag 指向**最终提交**（修完再打；已经建过 Release 就移动 tag，`force: true`）。
- Release 正文只列事实（新增/修复/测试），不写营销词。
- 用缓存凭据调 API：`git credential fill` 取 token → `Authorization: Bearer <token>`。

## 6. 一键脚本

仓库内或任意目录执行（脚本会自己找仓库根）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\scripts\gh-push.ps1" `
  -RepoPath "D:\WorkBuddy\<repo>" `
  -Message "feat: ..." `
  -Tag "v1.2.3" `
  -ReleaseName "v1.2.3 - ..."
```

参数：
| 参数 | 说明 |
| --- | --- |
| `-RepoPath` | 仓库路径，默认当前目录 |
| `-Message` | 有未提交改动时必填 |
| `-Tag` | 可选，推送后在 HEAD 上打 tag |
| `-ReleaseName` | 可选，配合 `-Tag` 创建 GitHub Release |
| `-DryRun` | 只打印将执行的步骤 |

## 7. 故障速查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `could not read Username` | 没有缓存凭据 | 交互登录一次，或让用户提供 PAT |
| `Failed to connect ... port 443` | 直连/代理当前不可用 | 按第 2 步重新探测后重试 |
| `repository not found` / API 404 | 远端仓库不存在 | 先建空仓库 |
| 凭据窗口一直挂着 | GCM 在等交互 | 设 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=Never` 再跑 |
| 授权页空白 | 系统代理指向坏端口 | 关掉系统代理后用直连/TUN |
| 推完远端没变 | 推错分支或没推 tag | `ls-remote` 对 sha；tag 单独 `push --tags` |

## 8. 收尾

- 报告：分支、提交 sha、远端 sha 是否一致、Release 链接。
- 推送成功后不要在本地留下一次性脚本；流程本身就是本 skill 与它的脚本。
