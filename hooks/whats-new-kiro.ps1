#requires -Version 5.1
<#
.SYNOPSIS
    Fetches the Kiro changelog and blog RSS feeds and prints entries published
    since the last time this script ran. Used by the "What's new Kiro?" SessionStart hook.

.DESCRIPTION
    On each run the script:
      1. Reads the timestamp of the newest entry seen during the previous run
         from small state files (one per feed).
      2. Downloads and parses:
           - https://kiro.dev/changelog/feed.rss  (changelog)
           - https://kiro.dev/blog/feed.rss       (blog posts)
      3. Prints every entry newer than the stored timestamp (most recent first)
         so the agent can summarize them for the user.
      4. Updates the state files to the newest entry's timestamp per feed.

    If nothing is new across both feeds, the script prints nothing and exits 0
    so it stays quiet.
    On the very first run there is no state, so it seeds the state files and
    shows the most recent few entries as an initial "what's new" overview.

    The script always exits 0 (even on network/parse failure) so it can never
    block Kiro from starting.
#>
param(
    # Directory for state files. Overridable for testing.
    [string]$StateDir = (Join-Path $PSScriptRoot '.state'),

    # How many recent entries to show the first time the hook ever runs (per feed).
    [int]$FirstRunCount = 5
)

$ErrorActionPreference = 'Stop'
# Suppress Invoke-WebRequest's progress stream so it never leaks into hook output.
$ProgressPreference = 'SilentlyContinue'
# Windows PowerShell 5.1 can default to old TLS; force 1.2 so the HTTPS fetch works.
try {
    [System.Net.ServicePointManager]::SecurityProtocol =
        [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
} catch { }

# --- Feed configuration ------------------------------------------------------
$Feeds = @(
    @{ Name = 'Changelog'; Url = 'https://kiro.dev/changelog/feed.rss'; StateFile = (Join-Path $StateDir 'whats-new-kiro-changelog.last') }
    @{ Name = 'Blog';      Url = 'https://kiro.dev/blog/feed.rss';      StateFile = (Join-Path $StateDir 'whats-new-kiro-blog.last') }
)

# --- Helper functions --------------------------------------------------------

# Reads the text of a child element by name. Uses InnerText so CDATA / HTML
# wrapped values (like <description>) come back as plain strings rather than
# XmlElement objects.
function Get-NodeText($parent, [string]$name) {
    if ($null -eq $parent) { return '' }
    $node = $parent.SelectSingleNode($name)
    if ($node) { return [string]$node.InnerText }
    return ''
}

function ConvertTo-Date([string]$value) {
    $parsed = [datetime]::MinValue
    if ($value -and [datetime]::TryParse(
            $value,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::AssumeUniversal -bor
            [System.Globalization.DateTimeStyles]::AdjustToUniversal,
            [ref]$parsed)) {
        return $parsed
    }
    return [datetime]::MinValue
}

function Clear-Html([string]$text) {
    if (-not $text) { return '' }
    $t = $text -replace '(?s)<[^>]+>', ' '
    $t = $t -replace '&nbsp;', ' ' -replace '&amp;', '&' -replace '&lt;', '<' `
            -replace '&gt;', '>' -replace '&quot;', '"' -replace '&#39;', "'" `
            -replace '&#x27;', "'"
    return ($t -replace '\s+', ' ').Trim()
}

function Get-FeedNewItems {
    param(
        [string]$FeedUrl,
        [string]$StateFile,
        [int]$FirstRunCount
    )

    # Fetch and parse the feed (never fatal)
    try {
        $response = Invoke-WebRequest -Uri $FeedUrl -UseBasicParsing -TimeoutSec 25
        [xml]$feed = $response.Content
        $items = @($feed.rss.channel.item)
    } catch {
        return @{ NewItems = @(); FirstRun = $false }
    }

    if (-not $items -or $items.Count -eq 0) {
        return @{ NewItems = @(); FirstRun = $false }
    }

    # Newest first.
    $items = $items | Sort-Object -Property @{ Expression = { ConvertTo-Date (Get-NodeText $_ 'pubDate') } } -Descending

    # Read previous state
    $lastSeen = $null
    if (Test-Path -LiteralPath $StateFile) {
        $raw = (Get-Content -LiteralPath $StateFile -Raw).Trim()
        $prev = ConvertTo-Date $raw
        if ($prev -gt [datetime]::MinValue) { $lastSeen = $prev }
    }

    # Decide which entries are "new"
    $firstRun = ($null -eq $lastSeen)
    if ($firstRun) {
        $newItems = @($items | Select-Object -First $FirstRunCount)
    } else {
        $newItems = @($items | Where-Object { (ConvertTo-Date (Get-NodeText $_ 'pubDate')) -gt $lastSeen })
    }

    # Persist the newest timestamp we have seen
    $newestDate = ConvertTo-Date (Get-NodeText $items[0] 'pubDate')
    if ($newestDate -gt [datetime]::MinValue) {
        if (-not (Test-Path -LiteralPath $StateDir)) {
            New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
        }
        $newestDate.ToString('o') | Set-Content -LiteralPath $StateFile -NoNewline -Encoding UTF8
    }

    return @{ NewItems = $newItems; FirstRun = $firstRun }
}

# --- Process each feed -------------------------------------------------------
$allOutput = @()
$anyFirstRun = $false

foreach ($feedCfg in $Feeds) {
    $result = Get-FeedNewItems -FeedUrl $feedCfg.Url -StateFile $feedCfg.StateFile -FirstRunCount $FirstRunCount

    if ($result.FirstRun) { $anyFirstRun = $true }

    if ($result.NewItems -and $result.NewItems.Count -gt 0) {
        $allOutput += @{ Name = $feedCfg.Name; Items = $result.NewItems; FirstRun = $result.FirstRun }
    }
}

if ($allOutput.Count -eq 0) {
    # Nothing new from any feed. Stay quiet.
    exit 0
}

# --- Emit entries for the agent to summarize ---------------------------------
if ($anyFirstRun) {
    Write-Output "The 'What's new Kiro?' hook ran for the first time. Below are the most recent Kiro changelog and blog entries. Please give the user a short, friendly summary of what's new, grouped by theme where it makes sense, and mention this is the initial overview so future sessions will only show newer entries."
} else {
    Write-Output "New Kiro changelog and/or blog entries have been published since the last session. Please give the user a short, friendly summary of what's new below, grouped by theme where it makes sense, and include the links."
}
Write-Output ''

foreach ($section in $allOutput) {
    Write-Output "## $($section.Name)"
    Write-Output ''

    foreach ($item in $section.Items) {
        $titleText = (Get-NodeText $item 'title').Trim()
        $title = if ($titleText) { $titleText } else { '(untitled)' }
        $link = (Get-NodeText $item 'link').Trim()
        $pub = Get-NodeText $item 'pubDate'
        $date = ConvertTo-Date $pub
        $dateText = if ($date -gt [datetime]::MinValue) { $date.ToString('yyyy-MM-dd') } else { $pub.Trim() }
        $desc = Clear-Html (Get-NodeText $item 'description')
        if ($desc.Length -gt 600) { $desc = $desc.Substring(0, 600).Trim() + '...' }

        Write-Output "### $title"
        Write-Output "Date: $dateText"
        if ($link) { Write-Output "Link: $link" }
        if ($desc) {
            Write-Output ''
            Write-Output $desc
        }
        Write-Output ''
    }
}

exit 0
