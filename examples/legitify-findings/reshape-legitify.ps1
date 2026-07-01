<#
.SYNOPSIS
  Explode a Legitify "flattened" JSON scan into a flat findings array for Sluice.

.DESCRIPTION
  Legitify's JSON output is an object keyed by policy
  (`content.<policy> = { policyInfo, violations[] }`), which the generic Sluice
  `json` adapter cannot ingest directly (it wants an array of records). This
  reshape emits one row per (policy, violation/resource) so the finding grain
  matches the posture-trend table. Legitify-specific, so it lives here in the
  example rather than in core Sluice.

.EXAMPLE
  ./reshape-legitify.ps1 -InputJson ..\..\legitify-2026-07-01.json -OutputJson .\findings.json
#>
param(
  [Parameter(Mandatory)][string]$InputJson,
  [Parameter(Mandatory)][string]$OutputJson,
  [string]$ScanDate
)

if (-not $ScanDate) {
  # Prefer a YYYY-MM-DD embedded in the filename; fall back to the file's mtime.
  if ($InputJson -match '(\d{4}-\d{2}-\d{2})') { $ScanDate = $Matches[1] }
  else { $ScanDate = (Get-Item $InputJson).LastWriteTime.ToString('yyyy-MM-dd') }
}

$doc = Get-Content $InputJson -Raw | ConvertFrom-Json
$rows = foreach ($p in $doc.content.PSObject.Properties) {
  $info = $p.Value.policyInfo
  foreach ($v in $p.Value.violations) {
    [pscustomobject]@{
      scan_date   = $ScanDate
      policy      = $info.policyName
      namespace   = $info.namespace
      severity    = $info.severity
      title       = $info.title
      status      = $v.status
      entity_type = $v.violationEntityType
      entity_name = $v.aux.entityName
    }
  }
}
# @($rows) keeps the output a JSON array for single-row AND zero-finding (clean-week)
# scans — piping $null through ConvertTo-Json -AsArray would emit `null`, not `[]`.
ConvertTo-Json -InputObject @($rows) -Depth 5 | Set-Content $OutputJson -Encoding utf8
Write-Host "Wrote $($rows.Count) findings to $OutputJson (scan_date=$ScanDate)"
