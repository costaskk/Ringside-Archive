param(
  [string]$PlexUrl = "http://127.0.0.1:32400",
  [string]$Token = "",
  [string]$Output = ".\plex-library-export.json",
  [string[]]$LibraryNames = @(),
  [switch]$AllLibraries
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($Token)) { $Token = Read-Host "Enter your Plex token" }
if ([string]::IsNullOrWhiteSpace($Token)) { throw "A Plex token is required." }

$base = $PlexUrl.TrimEnd('/')
$clientId = "ringside-archive-local-export-$([guid]::NewGuid().ToString('N'))"
$headers = @{
  "X-Plex-Token" = $Token
  "Accept" = "application/json"
  "X-Plex-Product" = "Ringside Archive"
  "X-Plex-Version" = "5.8.1"
  "X-Plex-Client-Identifier" = $clientId
}

function Invoke-PlexJson {
  param([Parameter(Mandatory=$true)][string]$Uri, [hashtable]$ExtraHeaders = @{})
  $requestHeaders = @{} + $headers
  foreach ($key in $ExtraHeaders.Keys) { $requestHeaders[$key] = $ExtraHeaders[$key] }
  $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Headers $requestHeaders -TimeoutSec 90
  $bytes = $response.RawContentStream.ToArray()
  $text = [Text.Encoding]::UTF8.GetString($bytes)
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return $text | ConvertFrom-Json
}

function First-Value {
  param($Object, [string[]]$Names)
  foreach ($name in $Names) {
    if ($null -ne $Object -and $Object.PSObject.Properties.Name -contains $name) {
      $value = $Object.$name
      if ($null -ne $value -and "$value" -ne "") { return $value }
    }
  }
  return $null
}

Write-Host "Reading Plex server and libraries from $base..." -ForegroundColor Cyan
$identity = Invoke-PlexJson "$base/identity"
$sectionsPayload = Invoke-PlexJson "$base/library/sections"
$sections = @($sectionsPayload.MediaContainer.Directory | Where-Object { $_ -and $_.type -in @('show','movie','video') })
if (-not $sections.Count) { throw "No scannable show, movie or video libraries were returned by Plex." }

Write-Host "Available libraries:" -ForegroundColor Cyan
$sections | ForEach-Object { Write-Host ("  [{0}] {1} ({2})" -f $_.key, $_.title, $_.type) }

$selected = @()
if ($AllLibraries) {
  $selected = $sections
} elseif ($LibraryNames.Count) {
  $wanted = @($LibraryNames | ForEach-Object { $_.Trim().ToLowerInvariant() })
  $selected = @($sections | Where-Object { $wanted -contains ([string]$_.title).Trim().ToLowerInvariant() -or $wanted -contains ([string]$_.key) })
} else {
  $selected = @($sections | Where-Object { $_.title -match '(?i)wrestl|ppv|combat|sports shows' })
  if (-not $selected.Count) {
    Write-Warning "No wrestling-named libraries were detected; all scannable libraries will be exported. Use -LibraryNames to limit the next export."
    $selected = $sections
  }
}

Write-Host "Selected libraries: $((@($selected.title) -join ', '))" -ForegroundColor Green
$items = New-Object System.Collections.Generic.List[object]
$libraries = New-Object System.Collections.Generic.List[object]

foreach ($section in $selected) {
  Write-Host "Exporting $($section.title)..." -ForegroundColor Cyan
  $libraries.Add([pscustomobject]@{ key = [string]$section.key; title = $section.title; type = $section.type; scanner = $section.scanner; agent = $section.agent })
  $start = 0
  $sectionCount = 0
  do {
    $query = @{
      includeGuids = '1'
      includeUserState = '1'
      'X-Plex-Container-Start' = [string]$start
      'X-Plex-Container-Size' = '500'
    }
    # For show libraries request episodes. For movie/video libraries omit type so
    # Plex returns the section's native item type (including Other Videos).
    if ($section.type -eq 'show') { $query.type = '4' }
    $queryString = ($query.GetEnumerator() | ForEach-Object { "{0}={1}" -f [uri]::EscapeDataString([string]$_.Key), [uri]::EscapeDataString([string]$_.Value) }) -join '&'
    $page = Invoke-PlexJson "$base/library/sections/$($section.key)/all?$queryString" @{
      'X-Plex-Container-Start' = [string]$start
      'X-Plex-Container-Size' = '500'
    }
    $container = $page.MediaContainer
    $rows = @($container.Metadata | Where-Object { $_ -and ($_.title -or $_.grandparentTitle -or $_.ratingKey) })

    foreach ($entry in $rows) {
      $guidValues = @()
      foreach ($guidEntry in @($entry.Guid)) { if ($guidEntry -and $guidEntry.id) { $guidValues += [string]$guidEntry.id } }
      $items.Add([pscustomobject]@{
        title = $entry.title
        grandparentTitle = $entry.grandparentTitle
        parentTitle = $entry.parentTitle
        year = $entry.year
        type = $entry.type
        ratingKey = [string]$entry.ratingKey
        index = $entry.index
        parentIndex = $entry.parentIndex
        originallyAvailableAt = $entry.originallyAvailableAt
        duration = $entry.duration
        lastViewedAt = $entry.lastViewedAt
        viewCount = [int](First-Value $entry @('viewCount','viewcount'))
        viewOffset = [long](First-Value $entry @('viewOffset','viewoffset'))
        userRating = $entry.userRating
        guid = $entry.guid
        guids = $guidValues
        thumb = $entry.thumb
        art = $entry.art
        library = $section.title
        libraryKey = [string]$section.key
        machineIdentifier = $identity.MediaContainer.machineIdentifier
        serverName = First-Value $identity.MediaContainer @('friendlyName','name')
      })
    }

    $sectionCount += $rows.Count
    $start += $rows.Count
    $total = [int](First-Value $container @('totalSize','size'))
    if ($rows.Count -eq 0) { break }
  } while ($start -lt $total)
  Write-Host "  $sectionCount valid items" -ForegroundColor DarkGray
}

$payload = [ordered]@{
  format = "ringside-plex-export"
  version = 3
  exportedAt = (Get-Date).ToUniversalTime().ToString("o")
  server = $base
  serverInfo = [ordered]@{
    name = First-Value $identity.MediaContainer @('friendlyName','name')
    machineIdentifier = $identity.MediaContainer.machineIdentifier
    uri = $base
  }
  libraries = $libraries
  titles = $items
}

# The token is deliberately never written to the JSON file or image URLs.
$json = $payload | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText((Join-Path (Get-Location) $Output), $json, (New-Object Text.UTF8Encoding($false)))
Write-Host "Saved $($items.Count) Plex records to $Output" -ForegroundColor Green
if (-not $items.Count) { Write-Warning "No valid media rows were exported. Check the selected library names and Plex permissions." }
