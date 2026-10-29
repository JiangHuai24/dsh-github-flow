param(
  [string]$RepoPath = '.',
  [string]$Message,
  [string]$Tag,
  [string]$ReleaseName,
  [string]$ReleaseBody,
  [int]$Retries = 6,
  [switch]$DryRun,
  # Allow force-pushing an existing tag. Risky: rewriting a published tag is a
  # recognizable abuse signal. Prefer -Tag with a NEW version instead.
  [switch]$AllowForceTag,
  # Skip the pre-flight secret/large-file scan. Only for repos you fully trust.
  [switch]$SkipSafetyScan
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
# PowerShell 5.1 may default to TLS 1.0, which GitHub rejects.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'

function Step($text) { Write-Host ("== " + $text) }
function Fail($text) { Write-Host ("ERROR: " + $text); exit 1 }

function Invoke-Git {
  param([string[]]$GitArgs, [string]$Proxy)
  if ($Proxy) {
    return (& git -c "http.proxy=$Proxy" -c "https.proxy=$Proxy" @GitArgs 2>&1 | Out-String)
  }
  return (& git -c http.proxy= -c https.proxy= @GitArgs 2>&1 | Out-String)
}

function Test-GitHub {
  param([string]$Proxy)
  if ($Proxy) {
    $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 8 -x $Proxy https://github.com 2>$null
  } else {
    $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 8 https://github.com 2>$null
  }
  return ($code -eq '200')
}

# --- 1. repository ---------------------------------------------------------
Push-Location $RepoPath
try {
  $root = (Invoke-Git @('rev-parse','--show-toplevel')).Trim()
  if (-not $root) { Fail 'not a git repository' }
  Set-Location $root
  if (-not $root) { Fail 'git rev-parse failed' }
  $branch = (Invoke-Git @('rev-parse','--abbrev-ref','HEAD')).Trim()
  if (-not $branch) { Fail 'cannot determine current branch' }
  $repoName = Split-Path -Leaf $root
  $releaseUrl = ''
  Step ("repo   " + $root)
  Step ("branch " + $branch)

  # --- 2. working tree -----------------------------------------------------
  $status = (Invoke-Git @('status','--porcelain')).Trim()
  if ($status) {
    if (-not $Message) { Fail 'working tree has changes; pass -Message "<type>: <subject>"' }
    Step 'staging and committing'
    if (-not $DryRun) {
      Invoke-Git @('add','-A') | Out-Null
      $commit = Invoke-Git @('commit','-m',$Message)
      if ($LASTEXITCODE -ne 0) { Fail ("commit failed: " + $commit) }
    }
  } else {
    Step 'working tree clean'
  }

  # --- 2b. safety pre-flight ----------------------------------------------
  # GitHub's abuse detection reacts to the CONTENT being pushed, not to intent.
  # Four things cause account-level trouble far more often than people expect:
  #
  #  1. Secrets in the payload (OAuth client secrets, tokens, private keys).
  #     Secret scanning blocks the push; retrying or clicking "allow" is what
  #     escalates, so this stops before git ever talks to the server.
  #  2. Very large files. GitHub hard-refuses >100 MB and warns >50 MB; a repo
  #     that keeps packing oversized blobs is also an abuse signal.
  #  3. Rewriting published history (force-push, tag re-pointing, branch
  #     resets). Legitimate in rare cases, but it is also the shape of abuse.
  #  4. Rapid repeated pushes to the same ref. Retrying a failing push in a
  #     tight loop is the classic trigger.
  #
  # Each check only REPORTS unless -SkipSafetyScan; the caller decides.
  if (-not $SkipSafetyScan) {
    Step 'safety scan'
    # (a) collect the files this push would send
    $scanTargets = @()

    # Prefer staged paths (the normal case right after `git add`).
    $staged = (Invoke-Git @('diff','--cached','--name-only','--diff-filter=ACMR')) -split "\r?\n"
    foreach ($ln in $staged) {
      $f = ([string]$ln).Trim()
      if ($f -and (Test-Path -LiteralPath $f -PathType Leaf)) { $scanTargets += $f }
    }

    # Nothing staged: scan the single commit this run would publish. A ref name
    # printed by `rev-parse` can be an error message, so validate the shape
    # before using it as a range.
    if ($scanTargets.Count -eq 0) {
      $headSha = ([string](Invoke-Git @('rev-parse','HEAD'))).Trim()
      $parentSha = ([string](Invoke-Git @('rev-parse','HEAD~1'))).Trim()
      if ($headSha -match '^[0-9a-f]{40}$' -and $parentSha -match '^[0-9a-f]{40}$') {
        $changed = (Invoke-Git @('diff','--name-only',$parentSha,$headSha)) -split "\r?\n"
        foreach ($ln in $changed) {
          $f = ([string]$ln).Trim()
          if ($f -and (Test-Path -LiteralPath $f -PathType Leaf)) { $scanTargets += $f }
        }
      }
    }
    $secretHits = @()
    $largeHits = @()
    foreach ($f in $scanTargets) {
      if (-not (Test-Path -LiteralPath $f)) { continue }
      $item = Get-Item -LiteralPath $f -ErrorAction SilentlyContinue
      if (-not $item -or $item.PSIsContainer) { continue }
      if ($item.Length -gt 50MB) { $largeHits += ($f + ' (' + [math]::Round($item.Length / 1MB, 1) + ' MB)') }
      if ($item.Length -gt 4MB) { continue }  # binary/large: not worth scanning
      try { $text = Get-Content -LiteralPath $f -Raw -ErrorAction Stop } catch { continue }
      if ($text -match 'GOCSPX-[A-Za-z0-9_-]{10,}') { $secretHits += ($f + ': Google OAuth client secret') }
      if ($text -match 'gh[pousr]_[A-Za-z0-9]{30,}') { $secretHits += ($f + ': GitHub token') }
      if ($text -match 'AKIA[0-9A-Z]{16}') { $secretHits += ($f + ': AWS access key') }
      if ($text -match '-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----') { $secretHits += ($f + ': private key') }
      if ($text -match 'xox[abprs]-[A-Za-z0-9-]{10,}') { $secretHits += ($f + ': Slack token') }
    }

    if ($secretHits.Count -gt 0) {
      Write-Host 'BLOCKED: the payload looks like it contains secrets'
      $secretHits | ForEach-Object { Write-Host ('  - ' + $_) }
      Write-Host 'Remove them and rewrite the commit before pushing. Do not retry, and do not'
      Write-Host 'use the "allow secret" link: repeated or bypassed secret-scanning hits are'
      Write-Host 'what gets an account restricted, not the secret itself.'
      Fail 'refusing to push secrets'
    }
    if ($largeHits.Count -gt 0) {
      Write-Host 'WARN: files above 50 MB (GitHub warns at this size, hard-refuses >100 MB)'
      $largeHits | ForEach-Object { Write-Host ('  - ' + $_) }
      Write-Host 'Consider Git LFS or dropping these from history before pushing.'
    }

    # (b) history rewrite detection
    $rewrite = $false
    $upRaw = [string](Invoke-Git @('rev-parse','--verify','--quiet','@{u}'))
    $upSha = $upRaw.Trim()
    if ($upSha -match '^[0-9a-f]{40}$') {
      # Count only the commits this branch is MISSING from upstream. A value that
      # is not a plain integer means git returned an error, so it is ignored
      # rather than cast (which would throw on the error text).
      $behindRaw = [string](Invoke-Git @('rev-list','--count','HEAD','--not',$upSha))
      $behindNum = 0
      if ($behindRaw.Trim() -match '^\d+') { $behindNum = [int]$Matches[0] }
      if ($behindNum -gt 0) { $rewrite = $true }
    }
    if ($rewrite) {
      Write-Host 'WARN: this push rewrites published history (local branch is behind upstream)'
      Write-Host 'Prefer a plain commit on top. If the rewrite is intentional, keep it to ONE'
      Write-Host 'force-push with --force-with-lease rather than a series of retries.'
    }

    if ($secretHits.Count -eq 0 -and $rewrite -eq $false) { Step 'safety scan clean' }
  }

  # --- 3. connectivity -----------------------------------------------------
  $route = $null
  for ($i = 1; $i -le $Retries -and -not $route; $i++) {
    if (Test-GitHub '') { $route = 'direct' }
    elseif (Test-GitHub 'http://127.0.0.1:7890') { $route = 'proxy' }
    else {
      Step ("network unavailable (attempt " + $i + "/" + $Retries + "), retrying")
      Start-Sleep -Seconds 3
    }
  }
  if (-not $route) { Fail 'no route to github.com (direct and proxy both failed)' }
  Step ("route  " + $route)

  $proxy = $null
  if ($route -eq 'proxy') { $proxy = 'http://127.0.0.1:7890' }

  # --- 4. push -------------------------------------------------------------
  #
  # Retry policy: a push is retried ONLY when the failure is clearly transient
  # (network/transport). Server-side rejections (rejected, protected branch,
  # secret scanning, push protection, non-fast-forward) are NOT retried --
  # hammering the same rejected push is itself an abuse signal, and it is one of
  # the most common reasons an otherwise innocent account gets flagged.
  if ($DryRun) {
    Step ("dry-run: would push " + $branch + " via " + $route)
  } else {
    $pushed = $false
    $lastOut = ''
    for ($i = 1; $i -le $Retries -and -not $pushed; $i++) {
      $out = Invoke-Git @('push','origin',$branch) $proxy
      $lastOut = [string]$out
      if ($LASTEXITCODE -eq 0 -or $out -match 'Everything up-to-date') { $pushed = $true; break }

      if ($out -match 'rejected|non-fast-forward|protected branch|secret|push protection|GH0\d\d|denied|forbidden|not authorized') {
        Write-Host 'PUSH REJECTED (server-side refusal) -- not retrying'
        Write-Host ('  reason: ' + (($lastOut -split "`n")[0]))
        Write-Host 'Repeatedly re-sending a rejected push is an abuse signal. Fix the cause'
        Write-Host 'first: rewrite the secret out of history, pull/merge instead of forcing,'
        Write-Host 'or use a NEW version tag instead of re-pointing a published one.'
        Fail 'push rejected by the server'
      }

      if ($i -lt $Retries) {
        $wait = [math]::Min(30, [math]::Pow(2, $i))   # 2,4,8,16,30 s -- back off
        Step ("push attempt " + $i + " hit a transport error, retrying in " + $wait + "s")
        Start-Sleep -Seconds $wait
      }
    }
    if (-not $pushed) { Fail ('push failed after retries: ' + (($lastOut -split "`n")[0])) }
  }

  # --- 5. verify -----------------------------------------------------------
  $local = (Invoke-Git @('rev-parse','HEAD')).Trim()
  if (-not $DryRun) {
    # ls-remote can fail (network blip) or return warning text; only a real
    # 40-hex first field counts as a remote head, otherwise retry before failing.
    $remote = ''
    for ($attempt = 1; $attempt -le 4; $attempt++) {
      $raw = ''
      try { $raw = (Invoke-Git @('ls-remote','--heads','origin',$branch) $proxy) } catch { $raw = '' }
      $match = [regex]::Match([string]$raw, '^([0-9a-f]{40})\s', 'Multiline')
      if ($match.Success) { $remote = $match.Groups[1].Value; break }
      if ($attempt -lt 4) { Start-Sleep -Seconds 2 }
    }
    Step ("local  " + $local)
    Step ("remote " + $remote)
    if ($remote -eq '') { Fail 'cannot read remote head (network?)' }
    if ($remote -ne $local) { Fail 'remote head does not match local head' }
  }

  # --- 6. tag --------------------------------------------------------------
  if ($Tag -and -not $DryRun) {
    Step ("tag    " + $Tag)
    # Re-pointing an EXISTING published tag is a rewrite of public history.
    # It is legal, but it is also one of the shapes abuse detection looks for,
    # so it needs an explicit opt-in rather than happening silently.
    $tagExistsRemote = $false
    try {
      $tagRaw = (Invoke-Git @('ls-remote','--tags','origin','refs/tags/' + $Tag) $proxy)
      $tagExistsRemote = ($tagRaw -match '^[0-9a-f]{40}\s')
    } catch { $tagExistsRemote = $false }

    if ($tagExistsRemote -and -not $AllowForceTag) {
      Write-Host ('WARN: tag ' + $Tag + ' already exists on the remote')
      Write-Host 'Re-pointing a published tag rewrites public history. Use a NEW version'
      Write-Host 'tag instead (recommended), or pass -AllowForceTag to accept the risk.'
      Fail 'refusing to re-point an existing tag'
    }

    Invoke-Git @('tag','-f',$Tag,$local) | Out-Null
    $out = Invoke-Git @('push','-f','origin',$Tag) $proxy
    if ($LASTEXITCODE -ne 0) { Fail ("tag push failed: " + (($out -split "`n")[0])) }
  }

  # --- 7. release ----------------------------------------------------------
  if ($Tag -and $ReleaseName -and -not $DryRun) {
    Step ("release " + $ReleaseName)
    $cred = "protocol=https`nhost=github.com`n`n" | & git credential fill 2>&1 | Out-String
    $m = [regex]::Match($cred, 'password=(.+)')
    if (-not $m.Success) { Write-Host 'WARN: no cached credential, skipping Release'; }
    else {
      $slug = (Invoke-Git @('remote','get-url','origin')).Trim()
      $slug = ($slug -replace '^.*github\.com[:/]','' -replace '\.git$','').Trim()
      $headers = @{
        Authorization          = "Bearer " + $m.Groups[1].Value.Trim()
        Accept                 = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent'           = 'gh-push'
      }
      $body = @{
        tag_name = $Tag
        target_commitish = $branch
        name = $ReleaseName
        body = $ReleaseBody
        draft = $false
        prerelease = $false
      } | ConvertTo-Json -Depth 4 -Compress
      function Invoke-Api {
        param([string]$Method, [string]$Uri, [string]$Json)
        for ($attempt = 1; $attempt -le 3; $attempt++) {
          try {
            if ($Json) {
              return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -ContentType 'application/json' -Body $Json -TimeoutSec 30
            }
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -TimeoutSec 30
          } catch {
            $code = 0
            if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
            if ($code -eq 404) { return $null }
            if ($attempt -eq 3) { break }
            Start-Sleep -Seconds 2
          }
        }
        # Invoke-RestMethod intermittently fails on flaky links while curl
        # keeps working, so the last resort goes through curl.exe.
        $auth = $headers["Authorization"]
        $curlArgs = @("-s", "-X", $Method, "-H", ("Authorization: " + $auth), "-H", "Accept: application/vnd.github+json", "-H", "User-Agent: gh-push", "--max-time", "30")
        if ($Json) { $curlArgs += @("-H", "Content-Type: application/json", "--data-binary", $Json) }
        $curlArgs += $Uri
        $raw = & curl.exe @curlArgs 2>$null
        if (-not $raw) { throw "api call failed (Invoke-RestMethod and curl)" }
        if ($raw -match '"message"\s*:\s*"Not Found"') { return $null }
        return ($raw | ConvertFrom-Json)
      }

      try {
        $existing = Invoke-Api -Method GET -Uri ("https://api.github.com/repos/" + $slug + "/releases/tags/" + $Tag)
        if ($existing) {
          Invoke-Api -Method PATCH -Uri ("https://api.github.com/repos/" + $slug + "/releases/" + $existing.id) -Json $body | Out-Null
          $releaseUrl = "https://github.com/" + $slug + "/releases/tag/" + $Tag
          Step ("release updated " + $releaseUrl)
        } else {
          Invoke-Api -Method POST -Uri ("https://api.github.com/repos/" + $slug + "/releases") -Json $body | Out-Null
          $releaseUrl = "https://github.com/" + $slug + "/releases/tag/" + $Tag
          Step ("release created " + $releaseUrl)
        }
      } catch {
        Write-Host ("WARN: release failed: " + $_.Exception.Message)
        $releaseUrl = ''
      }
    }
  }

  $subject = (Invoke-Git @('log','-1','--pretty=%s')).Trim()
  $short = $local.Substring(0, [Math]::Min(7, $local.Length))
  $remoteShort = ''
  if ($remote) { $remoteShort = $remote.Substring(0, [Math]::Min(7, $remote.Length)) }
  $matches = ($remote -eq $local) -or $DryRun

  Write-Host ''
  Write-Host '========== PUSH RECEIPT =========='
  if ($DryRun) {
    Write-Host 'DRY RUN - nothing was pushed'
    Write-Host ('repo    ' + $repoName)
    Write-Host ('branch  ' + $branch)
    Write-Host ('route   ' + $route)
    Write-Host '=================================='
  } elseif ($matches) {
    Write-Host ('PUSH OK  ' + $repoName)
    Write-Host ('branch  ' + $branch)
    Write-Host ('commit  ' + $short + ' ' + $subject)
    Write-Host ('verify  remote ' + $remoteShort + ' = local ' + $short)
    if ($Tag) { Write-Host ('tag     ' + $Tag) }
    if ($releaseUrl) { Write-Host ('release ' + $releaseUrl) } else { Write-Host 'release (none)' }
    Write-Host '=================================='
  } else {
    Write-Host ('PUSH FAILED  ' + $repoName)
    Write-Host ('branch  ' + $branch)
    Write-Host ('local   ' + $short)
    Write-Host ('remote  ' + $remoteShort)
    Write-Host 'remote head does not match local head'
    Write-Host '=================================='
    Pop-Location
    exit 1
  }
} finally {
  Pop-Location
}
