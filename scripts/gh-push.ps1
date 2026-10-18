param(
  [string]$RepoPath = '.',
  [string]$Message,
  [string]$Tag,
  [string]$ReleaseName,
  [string]$ReleaseBody,
  [int]$Retries = 6,
  [switch]$DryRun
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
  if ($DryRun) {
    Step ("dry-run: would push " + $branch + " via " + $route)
  } else {
    $pushed = $false
    for ($i = 1; $i -le $Retries -and -not $pushed; $i++) {
      $out = Invoke-Git @('push','origin',$branch) $proxy
      if ($LASTEXITCODE -eq 0 -or $out -match 'Everything up-to-date') { $pushed = $true }
      else {
        Step ("push attempt " + $i + " failed, retrying")
        Start-Sleep -Seconds 3
      }
    }
    if (-not $pushed) { Fail 'push failed after retries' }
  }

  # --- 5. verify -----------------------------------------------------------
  $local = (Invoke-Git @('rev-parse','HEAD')).Trim()
  if (-not $DryRun) {
    $remoteLine = (Invoke-Git @('ls-remote','--heads','origin',$branch) $proxy).Trim()
    $remote = ($remoteLine -split "\s+")[0]
    Step ("local  " + $local)
    Step ("remote " + $remote)
    if ($remote -ne $local) { Fail 'remote head does not match local head' }
  }

  # --- 6. tag --------------------------------------------------------------
  if ($Tag -and -not $DryRun) {
    Step ("tag    " + $Tag)
    Invoke-Git @('tag','-f',$Tag,$local) | Out-Null
    $out = Invoke-Git @('push','-f','origin',$Tag) $proxy
    if ($LASTEXITCODE -ne 0) { Fail ("tag push failed: " + $out) }
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
            if ($attempt -eq 3) { throw }
            Start-Sleep -Seconds 2
          }
        }
      }

      try {
        $existing = Invoke-Api -Method GET -Uri ("https://api.github.com/repos/" + $slug + "/releases/tags/" + $Tag)
        if ($existing) {
          Invoke-Api -Method PATCH -Uri ("https://api.github.com/repos/" + $slug + "/releases/" + $existing.id) -Json $body | Out-Null
          Step ("release updated https://github.com/" + $slug + "/releases/tag/" + $Tag)
        } else {
          Invoke-Api -Method POST -Uri ("https://api.github.com/repos/" + $slug + "/releases") -Json $body | Out-Null
          Step ("release created https://github.com/" + $slug + "/releases/tag/" + $Tag)
        }
      } catch {
        Write-Host ("WARN: release failed: " + $_.Exception.Message)
      }
    }
  }

  Write-Host 'DONE'
} finally {
  Pop-Location
}
