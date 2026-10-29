# GitHub 推送固定流程

这是所有会话共用的**唯一**推送流程。任何“推到 GitHub / 上传 / 同步改动”的请求都按这里执行，不要临时发明步骤。

## 时机

**任何代码/文档改动完成后立即走一遍本流程**，不要攒着等用户提醒；用户说「推」时，默认已经改完、只差推送与校验。

## 0. 四条铁律

1. **推完要校验**：远端 `refs/heads/<branch>` 必须等于本地 `HEAD`，否则视为没推成功。
2. **不猜网络**：本机直连与代理（`127.0.0.1:7890`）会交替失效，每次推送前先探测，哪条通走哪条。
3. **凭据不落库**：GitHub token 只从 Git Credential Manager 取（`git credential fill`），不写进仓库、不回显、不写进日志。
4. **必须回执**：每次推送都要给用户明确反馈，不能只在心里"推完了"就结束（格式见第 8 节）。

## 0.5 账号安全（先看这条）

GitHub 的滥用判定看的是**行为形态**，不是意图。远端仓库只是做个小修复也可能触发风控，
常见触发点如下，每一条都要主动避开：

| 触发点 | 为什么危险 | 正确做法 |
| --- | --- | --- |
| 载荷里有 secret（OAuth client secret、token、私钥） | 触发 secret scanning / push protection，**重试或点「允许」才是升级为账号限制的那一步** | 推送前本地扫出来，重写提交把它去掉 |
| 单文件 > 50MB | 50MB 起告警、100MB 硬拒；反复推送大包也是滥用信号 | 上 Git LFS，或从历史里剔除 |
| 强制推送 / 重指已发布 tag | 改写公开历史，形态上就是滥用 | 叠一个新提交；tag 用**新版本号**，不要重指 |
| 失败的 push 连续重试 | 同一笔被拒请求反复重发，是最典型的触发项 | 只有**网络/传输**类错误才重试，且指数退避；服务端拒绝立即停 |
| 短时间大量 API 调用 | 触发次级速率限制 | 复用响应、不轮询、不在循环里创建 Release |

`gh-push.ps1` 已内置这些检查：推送前先扫 secret 与大文件（`-SkipSafetyScan` 可跳过），
push 只对传输错误重试、服务端拒绝立即终止，重指已存在的 tag 需显式 `-AllowForceTag`。

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

- tag 指向**最终提交**（修完再打）。⚠️ **不要重指已发布 tag**：那会改写公开历史，且是风控信号；版本有变就发**新版本号**。确需重指时脚本要 `-AllowForceTag` 显式授权。
- Release 正文只列事实（新增/修复/测试），不写营销词。
- 用缓存凭据调 API：`git credential fill` 取 token → `Authorization: Bearer <token>`。

## 6. 一键脚本

仓库内或任意目录执行（脚本会自己找仓库根）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "{{SKILL_DIR}}\scripts\gh-push.ps1" `
  -RepoPath "<repo path>" `
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
| `GH0xx` / `push protection` / `secret scanning` | 载荷里有 secret 或违反仓库规则 | **不要重试、不要点允许**；重写提交去掉它 |
| `non-fast-forward` / `rejected` | 远端有你没有的提交 | 先 pull/merge，**不要 force** |
| tag 已存在于远端 | 重指会改写公开历史 | 换新版本号，或 `-AllowForceTag` 显式授权 |
| `repository not found` / API 404 | 远端仓库不存在 | 先建空仓库 |
| 凭据窗口一直挂着 | GCM 在等交互 | 设 `GIT_TERMINAL_PROMPT=0`、`GCM_INTERACTIVE=Never` 再跑 |
| 授权页空白 | 系统代理指向坏端口 | 关掉系统代理后用直连/TUN |
| 推完远端没变 | 推错分支或没推 tag | `ls-remote` 对 sha；tag 单独 `push --tags` |
| `Invoke-RestMethod` 报“基础连接已经关闭” | PS 5.1 的 TLS/网络栈抖动 | 用 `curl.exe` 调 API；脚本已内置 curl 兜底 |

## 8. 收尾：必须给用户反馈

推送（无论成功或失败）都要用下面这份回执结束，不要只说"已推送"。

**成功**

```
✅ 已推送 <仓库名>
- 分支：<branch>
- 提交：<short-sha> <commit subject>
- 校验：远端 <short-sha> = 本地 <short-sha>
- 发布：<Release 链接，没有就写"未发版">
```

**失败**（必须说清卡在哪一步、下一步怎么办）

```
❌ 推送失败：<仓库名>
- 阶段：<网络探测 / 提交 / 推送 / 校验 / 打 tag / 发 Release>
- 原因：<原始错误摘要>
- 已尝试：<直连 / 代理 / 重试次数>
- 下一步：<需要用户做什么，例如登录 GCM、建空仓库、检查代理>
```

规则：

- 没通过 sha 校验就不能报成功；
- 部分成功（推了但没发 Release）要写明哪部分成了；
- 批量推送多个仓库时，逐个仓库给出回执；
- 界面上用「推送 GitHub」面板推送时，同样把面板底部的输出摘要复述给用户。

推送成功后不要在本地留下一次性脚本；流程本身就是本 skill 与它的脚本。
