param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Submit', 'Query')][string]$Action,
    [string]$Gateway = 'http://127.0.0.1:11435',
    [string]$ReceiptPath = (Join-Path $env:USERPROFILE 'SysTorch-choice-demo.json'),
    [Security.SecureString]$Token
)

# Each invocation finishes immediately. Only the request and task ID are saved;
# the caller token is requested again in a later process and never saved here.
$ErrorActionPreference = 'Stop'
$ReceiptPath = [IO.Path]::GetFullPath($ReceiptPath)
$utf8 = New-Object Text.UTF8Encoding($false)

function Save-Receipt($Receipt) {
    $directory = [IO.Path]::GetDirectoryName($ReceiptPath)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    [IO.File]::WriteAllText($ReceiptPath, ($Receipt | ConvertTo-Json -Depth 20), $utf8)
}

if (Test-Path -LiteralPath $ReceiptPath) {
    $receipt = [IO.File]::ReadAllText($ReceiptPath, $utf8) | ConvertFrom-Json
} elseif ($Action -eq 'Submit') {
    $receipt = [pscustomobject]@{
        gateway = $Gateway.TrimEnd('/')
        task_id = $null
        submission = [pscustomobject]@{
            entry = 'human:owner'
            idempotency_key = [Guid]::NewGuid().ToString('N')
            question = 'Should I review the changes before continuing?'
            context = @{ purpose = 'External caller exit and resume demo; no action is executed.' }
            choices = @(
                @{ id = 'review'; label = 'Review the changes first' },
                @{ id = 'continue'; label = 'Continue, review later' }
            )
            ttl_seconds = 3600
        }
    }
    # Save the exact key and body BEFORE sending. If the response is lost, rerun
    # Submit with this same receipt; the daemon deduplicates the original request.
    Save-Receipt $receipt
} else {
    throw "Receipt not found: $ReceiptPath. Run Submit first."
}

$base = [Uri]$receipt.gateway
if (-not $base.IsAbsoluteUri -or $base.Scheme -notin @('http', 'https') -or $base.UserInfo -or $base.Query -or $base.Fragment) {
    throw 'Receipt gateway must be an absolute HTTP(S) gateway URL without credentials, query or fragment.'
}
Write-Host "SysTorch gateway: $($receipt.gateway)"
Write-Host "Receipt: $ReceiptPath"
if ($null -eq $Token) { $Token = Read-Host 'Paste the SAME caller token (hidden input)' -AsSecureString }
if ($Token.Length -eq 0) { throw 'Caller token cannot be empty.' }
$credential = [System.Management.Automation.PSCredential]::new('caller', $Token)
$headers = @{ Authorization = "Bearer $($credential.GetNetworkCredential().Password)" }

try {
    $prefix = "$($receipt.gateway)/v1/systorch/decisions"
    if ($Action -eq 'Submit') {
        $body = $utf8.GetBytes(($receipt.submission | ConvertTo-Json -Depth 20))
        $task = Invoke-RestMethod -Method Post -Uri $prefix -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 15
        if (-not $task.id) { throw 'The server did not return a durable task ID; keep the receipt and retry Submit.' }
        $receipt.task_id = $task.id
        Save-Receipt $receipt
        Write-Host "Accepted task: $($task.id) ($($task.status)). This caller process can now exit."
        Write-Host 'Answer in the native app decision desk, then run Query with this same receipt and token.'
    } else {
        if (-not $receipt.task_id) { throw 'No acknowledged task ID. Retry Submit with this receipt to recover it safely.' }
        $url = "$prefix/$([Uri]::EscapeDataString($receipt.task_id))"
        $task = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 15
        Write-Host "Task: $($task.id) | status: $($task.status)"
        if ($task.status -eq 'pending') {
            Write-Host 'Still waiting. No action was cancelled; answer in the app and run Query again.'
        } elseif ($task.status -eq 'completed' -and $task.observation.kind -eq 'answered') {
            Write-Host 'Original human observation:'
            $task.observation | ConvertTo-Json -Depth 20
            Write-Host 'Strict result (one-hot encoding, not calibrated confidence):'
            Invoke-RestMethod -Uri "$url/result" -Headers $headers -TimeoutSec 15 | ConvertTo-Json -Depth 20
        } else {
            Write-Host 'No unconditional approval: inspect the authoritative state and original observation.'
            [pscustomobject]@{ status = $task.status; observation = $task.observation } | ConvertTo-Json -Depth 20
        }
    }
} catch {
    # PowerShell preserves the server's machine code/remediation in ErrorDetails.
    # Do not print request headers or turn a conditional/refused answer into yes.
    if ($_.ErrorDetails.Message) { Write-Error -Message $_.ErrorDetails.Message -ErrorAction Continue }
    throw
} finally {
    $headers.Clear()
    $credential = $null
    $Token = $null
}
