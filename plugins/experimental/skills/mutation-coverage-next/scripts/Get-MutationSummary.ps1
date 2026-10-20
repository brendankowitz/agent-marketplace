<#
.SYNOPSIS
    Summarizes a Stryker.NET mutation-report.json for test-suite curation.

.DESCRIPTION
    Reports surviving and uncovered mutants with their source lines, tests that kill no
    mutants, and tests whose kill set is contained in another test's kill set. Also prints
    status counts, the score (killed / tested; Timeout counts as killed; Ignored, CompileError,
    RuntimeError and Pending are excluded), a PARTIAL-scope notice and a missing --disable-bail
    warning. When a baseline report is supplied, lists mutants the baseline killed that are no
    longer killed.

    The kill matrix is only complete when Stryker ran with --disable-bail; otherwise each
    killed mutant records just the first failing test. The two redundancy sections are
    withheld when the report cannot support them (no test data, bail-mode data, partial scope).

    Tests with identical kill sets cover each other; only the lexically later one is listed,
    so removing every listed test keeps one of each group. Review the list before deleting.

    Requires PowerShell 7+ (pwsh).

.PARAMETER ReportPath
    Path to the current mutation-report.json.

.PARAMETER BaselinePath
    Optional mutation-report.json from an earlier run over the same source and scope.

.PARAMETER Top
    Maximum items to print per section. Defaults to 50.

.NOTES
    Exit codes: 0 = summary printed, no lost kills; 1 = lost kills versus the baseline (a
    verdict); 2 = the script could not produce a trustworthy summary (a missing, malformed,
    empty or stale report). Exit 2 is not a verdict: read the message and fix the run.

.EXAMPLE
    ./Get-MutationSummary.ps1 -ReportPath StrykerOutput/run/reports/mutation-report.json
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$ReportPath,

    [string]$BaselinePath,

    [int]$Top = 50
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$KilledStatuses = @('Killed', 'Timeout')
$UntestedStatuses = @('Ignored', 'CompileError', 'RuntimeError', 'Pending')
$KnownStatuses = $KilledStatuses + $UntestedStatuses + @('Survived', 'NoCoverage')
$ScopeReason = '^Removed by .*(mutate|since)'

function Get-OptionalProperty($object, [string]$name, $default) {
    if ($object.PSObject.Properties[$name]) {
        return $object.$name
    }

    return $default
}

function Read-Report([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Report not found: $path"
    }

    $report = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if (-not $report.PSObject.Properties['files']) {
        throw "Not a Stryker mutation-report.json (no 'files'): $path"
    }

    return $report
}

function Get-RelativePath([string]$root, [string]$path) {
    if ($root) {
        $prefix = ($root -replace '\\', '/').TrimEnd('/') + '/'
        $normalized = $path -replace '\\', '/'
        if ($normalized.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $normalized.Substring($prefix.Length)
        }
    }

    return $path
}

function Get-Mutants($report) {
    $root = Get-OptionalProperty $report 'projectRoot' ''
    $seen = @{}
    foreach ($file in $report.files.PSObject.Properties) {
        $relative = Get-RelativePath $root $file.Name
        $source = Get-OptionalProperty $file.Value 'source' ''
        $lines = $source -split "`r?`n"
        foreach ($mutant in (Get-OptionalProperty $file.Value 'mutants' @())) {
            $line = $mutant.location.start.line
            $column = $mutant.location.start.column
            $replacement = Get-OptionalProperty $mutant 'replacement' ''

            # Stryker can emit several mutants with the same location, mutator and replacement;
            # an ordinal keeps them distinct so one cannot mask another in a baseline comparison.
            $baseKey = '{0}|{1}:{2}|{3}|{4}' -f $relative, $line, $column, $mutant.mutatorName, $replacement
            $seen[$baseKey] = 1 + $(if ($seen.ContainsKey($baseKey)) { $seen[$baseKey] } else { 0 })

            [pscustomobject]@{
                Id          = [string]$mutant.id
                File        = $relative
                Line        = $line
                Column      = $column
                Mutator     = $mutant.mutatorName
                Replacement = $replacement
                Status      = $mutant.status
                Reason      = Get-OptionalProperty $mutant 'statusReason' ''
                KilledBy    = @(Get-OptionalProperty $mutant 'killedBy' @())
                SourceLine  = if ($line -ge 1 -and $line -le $lines.Count) { $lines[$line - 1].Trim() } else { '' }
                Key         = '{0}#{1}' -f $baseKey, $seen[$baseKey]
            }
        }
    }
}

# A file excluded by -m is written with no mutants and language 'none', so it leaves no per-mutant
# reason behind; detect it from the file entry as well as from the mutant reasons.
function Test-IsPartialScope($report, $mutants) {
    $filteredFile = $report.files.PSObject.Properties | Where-Object {
        (Get-OptionalProperty $_.Value 'language' '') -eq 'none' -and @(Get-OptionalProperty $_.Value 'mutants' @()).Count -eq 0
    }

    return (@($filteredFile).Count -gt 0) -or (@($mutants | Where-Object { $_.Reason -match $ScopeReason }).Count -gt 0)
}

# Maps each test id to its test method. Runners may report one id per theory or one per data row
# (with or without arguments in the name), so redundancy is judged per method, never per row.
function Get-TestMethods($report) {
    $methods = @{}
    foreach ($file in (Get-OptionalProperty $report 'testFiles' ([pscustomobject]@{})).PSObject.Properties) {
        foreach ($test in (Get-OptionalProperty $file.Value 'tests' @())) {
            $name = Get-OptionalProperty $test 'name' ([string]$test.id)
            $methods[[string]$test.id] = $name -replace '\s*\(.*\)\s*$', ''
        }
    }

    return $methods
}

function ConvertTo-MethodKills($killedMutants, $testMethods) {
    foreach ($mutant in $killedMutants) {
        [pscustomobject]@{
            Id       = $mutant.Id
            KilledBy = @($mutant.KilledBy | ForEach-Object { if ($testMethods.ContainsKey($_)) { $testMethods[$_] } else { $_ } } | Select-Object -Unique)
        }
    }
}

function New-KillSets($testIds, $killedMutants) {
    $sets = @{}
    foreach ($id in $testIds) {
        $sets[$id] = [System.Collections.Generic.HashSet[string]]::new()
    }

    foreach ($mutant in $killedMutants) {
        foreach ($testId in $mutant.KilledBy) {
            if (-not $sets.ContainsKey($testId)) {
                $sets[$testId] = [System.Collections.Generic.HashSet[string]]::new()
            }

            [void]$sets[$testId].Add($mutant.Id)
        }
    }

    return $sets
}

function Get-SubsumedTests($killSets, $mutantKillers) {
    foreach ($testId in $killSets.Keys) {
        $kills = $killSets[$testId]
        if ($kills.Count -eq 0) {
            continue
        }

        # Any superset of this test's kills must also kill its first mutant. When two tests have
        # identical kills, only the one sorting later is covered, so one of each group survives.
        $firstMutant = [System.Linq.Enumerable]::First($kills)
        $supersets = @($mutantKillers[$firstMutant] | Where-Object {
                $_ -ne $testId -and $kills.IsSubsetOf($killSets[$_]) -and
                ($kills.Count -lt $killSets[$_].Count -or [string]::CompareOrdinal($_, $testId) -lt 0)
            })
        if ($supersets.Count -gt 0) {
            [pscustomobject]@{
                TestId    = $testId
                Kills     = $kills.Count
                Supersets = $supersets
            }
        }
    }
}

function Write-Section([string]$title, [string[]]$lines, [int]$total) {
    Write-Output ''
    Write-Output "## $title ($total)"
    if ($total -eq 0) {
        Write-Output 'None.'
        return
    }

    $lines | ForEach-Object { Write-Output $_ }
    if ($total -gt $Top) {
        Write-Output ('... {0} more' -f ($total - $Top))
    }
}

function Write-Unavailable([string]$title, [string]$reason) {
    Write-Output ''
    Write-Output "## $title"
    Write-Output "UNAVAILABLE: $reason"
}

function Format-Gaps($gaps) {
    foreach ($fileGroup in $gaps | Group-Object File) {
        "### $($fileGroup.Name)"
        foreach ($gap in $fileGroup.Group) {
            "- L{0} [{1}] {2} -> {3}" -f $gap.Line, $gap.Status, $gap.Mutator, $gap.Replacement
            "    {0}" -f $gap.SourceLine
        }
    }
}

function Get-LostKills($baselineMutants, $currentMutants) {
    $current = @{}
    foreach ($mutant in $currentMutants) {
        $current[$mutant.Key] = $mutant
    }

    foreach ($mutant in $baselineMutants | Where-Object { $_.Status -in $KilledStatuses }) {
        $now = if ($current.ContainsKey($mutant.Key)) { $current[$mutant.Key].Status } else { 'Missing' }
        if ($now -notin $KilledStatuses) {
            "- {0} L{1} {2} -> {3} (was {4}, now {5})" -f $mutant.File, $mutant.Line, $mutant.Mutator, $mutant.Replacement, $mutant.Status, $now
        }
    }
}

function Invoke-Summary {
    $report = Read-Report $ReportPath
    $mutants = @(Get-Mutants $report)
    if ($mutants.Count -eq 0) {
        throw "Report contains no mutants: $ReportPath. Check -p, the scope flags and that Stryker finished."
    }

    $unknown = @($mutants | Where-Object { $_.Status -notin $KnownStatuses } | Select-Object -ExpandProperty Status -Unique)
    $tested = @($mutants | Where-Object { $_.Status -notin $UntestedStatuses })
    if ($tested.Count -eq 0) {
        throw "Report contains no tested mutants (all Ignored, CompileError, RuntimeError or Pending): $ReportPath"
    }

    $killed = @($tested | Where-Object { $_.Status -in $KilledStatuses })
    $testMethods = Get-TestMethods $report
    $methodKills = @(ConvertTo-MethodKills $killed $testMethods)
    $isScoped = Test-IsPartialScope $report $mutants
    $maxKillers = ($methodKills | ForEach-Object { $_.KilledBy.Count } | Measure-Object -Maximum).Maximum
    $hasKillData = $killed.Count -gt 0 -and $maxKillers -gt 0
    $hasTestNames = $testMethods.Count -gt 0

    Write-Output '# Mutation summary'
    Write-Output ("Report: {0} (written {1:u})" -f (Resolve-Path -LiteralPath $ReportPath), (Get-Item -LiteralPath $ReportPath).LastWriteTime)
    foreach ($group in $mutants | Group-Object Status | Sort-Object Name) {
        Write-Output ("- {0}: {1}" -f $group.Name, $group.Count)
    }

    Write-Output ("- Score (killed / tested): {0:N2}%" -f (100.0 * $killed.Count / $tested.Count))
    Write-Output ("- Test methods in report: {0}" -f @($testMethods.Values | Select-Object -Unique).Count)

    if ($unknown.Count -gt 0) {
        Write-Output ("- Warning: unrecognized mutant status {0}; they count as tested and not killed." -f ($unknown -join ', '))
    }

    if ($isScoped) {
        Write-Output '- Scope: PARTIAL (mutate filter or --since). Redundancy sections are withheld; re-run over the whole target project to prune.'
    }

    $gaps = @($tested | Where-Object { $_.Status -in 'Survived', 'NoCoverage' } | Sort-Object File, Line, Column)
    $shownGaps = @($gaps | Select-Object -First $Top)
    Write-Section 'Survived and NoCoverage mutants' @(Format-Gaps $shownGaps) $gaps.Count

    $reason = if (-not $hasTestNames) { "the report has no 'testFiles', so tests cannot be named" }
        elseif (-not $hasKillData) { 'killed mutants record no killing tests' }
        elseif ($maxKillers -le 1) { 'no mutant has more than one killer: either Stryker ran without --disable-bail, or each mutant really has one killer (coveredBy is empty, so the report cannot tell which)' }
        elseif ($isScoped) { 'the run was partial, and a test may kill mutants outside the scope' }

    if ($reason) {
        Write-Unavailable 'Test methods that killed no mutants' $reason
        Write-Unavailable 'Tests whose kills are all covered by another test' $reason
    }
    else {
        $methodNames = @($testMethods.Values | Select-Object -Unique)
        $killSets = New-KillSets $methodNames $methodKills
        $mutantKillers = @{}
        foreach ($mutant in $methodKills) {
            $mutantKillers[$mutant.Id] = $mutant.KilledBy
        }

        $zeroKill = @($methodNames | Where-Object { $killSets[$_].Count -eq 0 } | Sort-Object)
        Write-Section 'Test methods that killed no mutants' @($zeroKill | Select-Object -First $Top | ForEach-Object { "- $_" }) $zeroKill.Count

        $subsumed = @(Get-SubsumedTests $killSets $mutantKillers | Sort-Object Kills, TestId)
        $subsumedLines = @($subsumed | Select-Object -First $Top | ForEach-Object {
                $covering = ($_.Supersets | Sort-Object | Select-Object -First 3) -join ', '
                "- {0} ({1} kills) covered by: {2}" -f $_.TestId, $_.Kills, $covering
            })
        Write-Section 'Tests whose kills are all covered by another test' $subsumedLines $subsumed.Count
    }

    # Output is the report itself, so hand the mutants back through script scope.
    $script:AllMutants = $mutants
}

try {
    Invoke-Summary
    $mutants = $script:AllMutants

    if ($BaselinePath) {
        $baseline = @(Get-Mutants (Read-Report $BaselinePath))
        $baselineKilled = @($baseline | Where-Object { $_.Status -in $KilledStatuses })
        if ($baselineKilled.Count -eq 0) {
            throw "Baseline has no killed mutants, so nothing can be compared: $BaselinePath"
        }

        $currentKeys = @{}
        foreach ($mutant in $mutants) { $currentKeys[$mutant.Key] = $true }
        $matched = @($baselineKilled | Where-Object { $currentKeys.ContainsKey($_.Key) }).Count
        if ($matched -eq 0) {
            throw "No baseline mutant matches the current report by file, location and mutation. Different project, scope or source? ($BaselinePath)"
        }

        Write-Output ''
        Write-Output ("Baseline: {0} killed, {1} matched in current report" -f $baselineKilled.Count, $matched)
        $lost = @(Get-LostKills $baseline $mutants)
        Write-Section 'Kills lost versus baseline' @($lost | Select-Object -First $Top) $lost.Count
        if ($lost.Count -gt 0) {
            exit 1
        }
    }
}
catch {
    Write-Error $_.Exception.Message -ErrorAction Continue
    exit 2
}
