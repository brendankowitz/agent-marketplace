<#
.SYNOPSIS
    Lists .NET test projects and the production project Stryker.NET should mutate for each.

.DESCRIPTION
    Finds C# test projects and lists their project references, excluding other test projects,
    as candidates. A project is a test project when it sets IsTestProject to true (and not
    false), uses the MSTest.Sdk SDK, or references a known test package (Microsoft.NET.Test.Sdk,
    xunit.v3, TUnit, MSTest.TestFramework).

    Suggested Target (a project file name, which is what Stryker's -p takes), first match wins:
      exact           the reference named after the test project minus its Tests, UnitTests,
                      IntegrationTests, E2ETests or FunctionalTests suffix
      sole-reference  the only non-test reference
      prefix          the longest reference whose name is a dotted prefix of the test name
    Otherwise Match is 'none' and Target is empty. Only 'exact' is trustworthy: confirm every
    other Match by reading the test code, because a sole reference can be a helper project.

    In a git repository the script lists tracked and untracked-but-not-ignored projects, which
    skips nested worktrees and build output. Elsewhere it walks the directory and skips bin,
    obj, node_modules, .git, .claude and .worktrees.

    Not detected: projects that get their test settings only from Directory.Build.props or
    .targets, and non-C# projects. The script warns about projects named *Test or *Tests that
    it did not detect; add those to the profile by hand.

    Requires PowerShell 7+ (pwsh).

.PARAMETER Root
    Repository root to search. Defaults to the current directory.

.NOTES
    Exits 2 when no test project is found, rather than printing nothing.

.EXAMPLE
    ./Get-MutationTargets.ps1 | Format-List TestProject, Target, Match, Candidates
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Root = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TestPackages = '^(Microsoft\.NET\.Test\.Sdk|xunit\.v3(\..*)?|TUnit(\..*)?|MSTest\.TestFramework)$'
$TestSuffix = '\.(Unit|Integration|E2E|Functional)?Tests?$'
$ExcludedDirectories = '(^|/)(bin|obj|node_modules|\.git|\.claude|\.worktrees)/'

function Find-ProjectFiles([string]$root) {
    $isGit = (& git -C $root rev-parse --is-inside-work-tree 2>$null) -eq 'true'
    if ($isGit) {
        $relative = & git -C $root ls-files --cached --others --exclude-standard -- '*.csproj'
        return @($relative | Where-Object { $_ } | ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { Get-Item -LiteralPath $_ })
    }

    return @(Get-ChildItem -LiteralPath $root -Recurse -Filter *.csproj | Where-Object {
            $relative = [System.IO.Path]::GetRelativePath($root, $_.FullName) -replace '\\', '/'
            $relative -notmatch $ExcludedDirectories
        })
}

function Read-Project([System.IO.FileInfo]$project) {
    [xml]$xml = Get-Content -LiteralPath $project.FullName -Raw
    return $xml
}

function Test-IsTestProject($xml) {
    $sdk = $xml.SelectSingleNode("/*[local-name()='Project']/@Sdk")
    if ($sdk -and $sdk.Value -match '^MSTest\.Sdk') {
        return $true
    }

    $flags = @($xml.SelectNodes("//*[local-name()='IsTestProject']") | ForEach-Object { $_.InnerText.Trim() })
    if ($flags -contains 'false') {
        return $false
    }

    if ($flags -contains 'true') {
        return $true
    }

    $packages = @($xml.SelectNodes("//*[local-name()='PackageReference']/@Include") | ForEach-Object { $_.Value })
    return @($packages | Where-Object { $_ -match $TestPackages }).Count -gt 0
}

function Get-ProjectReferences($xml) {
    foreach ($node in $xml.SelectNodes("//*[local-name()='ProjectReference']")) {
        $include = $node.GetAttribute('Include')
        if (-not $include) {
            Write-Warning 'Skipped a ProjectReference with no Include (Update or Remove).'
            continue
        }

        [System.IO.Path]::GetFileName(($include -replace '\\', '/'))
    }
}

$Root = (Resolve-Path -LiteralPath $Root).Path
$projects = Find-ProjectFiles $Root
$parsed = @{}
foreach ($project in $projects) {
    $parsed[$project.FullName] = Read-Project $project
}

$testProjects = @($projects | Where-Object { Test-IsTestProject $parsed[$_.FullName] })
$testProjectNames = @($testProjects | ForEach-Object { $_.Name })
if ($testProjects.Count -eq 0) {
    Write-Error "No test projects found under $Root. Projects that take IsTestProject only from Directory.Build.props are not detected; add them to the profile by hand."
    exit 2
}

$undetected = @($projects | Where-Object { $_.Name -notin $testProjectNames -and $_.BaseName -match '\.(Tests?|UnitTests?|IntegrationTests?|E2ETests?)$' })
foreach ($project in $undetected) {
    Write-Warning "Named like a test project but not detected as one: $([System.IO.Path]::GetRelativePath($Root, $project.FullName))"
}

foreach ($project in $testProjects | Sort-Object FullName) {
    $references = @(Get-ProjectReferences $parsed[$project.FullName])
    $candidates = @($references | Where-Object { $_ -notin $testProjectNames })
    $testBaseName = $project.BaseName -replace $TestSuffix, ''
    $expected = "$testBaseName.csproj"
    $prefixMatch = $candidates |
        Where-Object { $testBaseName.StartsWith([System.IO.Path]::GetFileNameWithoutExtension($_) + '.', [System.StringComparison]::OrdinalIgnoreCase) } |
        Sort-Object Length -Descending |
        Select-Object -First 1

    $match = 'none'
    $target = ''
    if ($candidates -contains $expected) { $match = 'exact'; $target = $expected }
    elseif ($candidates.Count -eq 1) { $match = 'sole-reference'; $target = $candidates[0] }
    elseif ($prefixMatch) { $match = 'prefix'; $target = $prefixMatch }

    [pscustomobject]@{
        TestProject = [System.IO.Path]::GetRelativePath($Root, $project.FullName)
        Target      = $target
        Match       = $match
        Candidates  = $candidates -join ', '
    }
}
