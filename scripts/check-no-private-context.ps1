#Requires -Version 7
<#
.SYNOPSIS
  Pre-commit guard for the PUBLIC sluice repo: refuses to commit any path under
  `.claude/`, so private Claude context can never leak into the public tree.

.DESCRIPTION
  Designed to run as a lefthook `pre-commit` job. lefthook passes the staged files
  as arguments via its `{staged_files}` template; if none are passed (e.g. invoked
  by hand) it falls back to `git diff --cached --name-only`.

  Legitimate `.claude/` files are already gitignored in sluice, so nothing valid is
  ever staged — a hit here means something was force-added.

.NOTES
  Escape hatch (use sparingly, only when you are certain):
    LEFTHOOK=0 git commit ...        # skip all lefthook hooks
    git commit --no-verify ...       # skip git hooks entirely
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$StagedFiles
)

if (-not $StagedFiles -or $StagedFiles.Count -eq 0) {
    $StagedFiles = git diff --cached --name-only
}

# Normalise separators and match anything inside a .claude/ directory.
$offenders = $StagedFiles |
    Where-Object { $_ } |
    ForEach-Object { $_ -replace '\\', '/' } |
    Where-Object { $_ -match '(^|/)\.claude/' }

if ($offenders) {
    Write-Host '❌ Refusing to commit .claude/ content to the public sluice repo.' -ForegroundColor Red
    Write-Host '   Private context belongs in caracal-lynx/claude-context.' -ForegroundColor Red
    Write-Host '   Offending staged paths:' -ForegroundColor Red
    $offenders | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
    Write-Host '   (Override only if you are certain: `LEFTHOOK=0 git commit` or `git commit --no-verify`.)'
    exit 1
}

exit 0
