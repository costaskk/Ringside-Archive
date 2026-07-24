param(
  [string]$PlexUrl = "http://127.0.0.1:32400",
  [string]$Token = "",
  [string]$Output = ".\plex-library-export.json"
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Token)) { $Token = Read-Host "Enter your Plex token" }
$headers = @{ "X-Plex-Token" = $Token; "Accept" = "application/json"; "X-Plex-Product" = "Ringside Archive"; "X-Plex-Client-Identifier" = "ringside-archive-local-export" }
$base = $PlexUrl.TrimEnd('/')
Write-Host "Reading Plex libraries from $base..."
$identity = Invoke-RestMethod -Uri "$base/identity" -Headers $headers
$sections = Invoke-RestMethod -Uri "$base/library/sections" -Headers $headers
$items = New-Object System.Collections.Generic.List[object]
foreach ($section in @($sections.MediaContainer.Directory)) {
  if ($section.type -notin @('show','movie','video')) { continue }
  Write-Host "Exporting $($section.title)..."
  $type = if ($section.type -eq 'show') { 4 } else { 1 }
  $start = 0
  do {
    $page = Invoke-RestMethod -Uri "$base/library/sections/$($section.key)/all?type=$type&includeGuids=1&X-Plex-Container-Start=$start&X-Plex-Container-Size=500" -Headers $headers
    $rows = @($page.MediaContainer.Metadata)
    foreach ($entry in $rows) {
      $thumbUrl = if ($entry.thumb) { "$base$($entry.thumb)?X-Plex-Token=$([uri]::EscapeDataString($Token))" } else { "" }
      $artUrl = if ($entry.art) { "$base$($entry.art)?X-Plex-Token=$([uri]::EscapeDataString($Token))" } else { "" }
      $items.Add([pscustomobject]@{
        title = $entry.title
        grandparentTitle = $entry.grandparentTitle
        parentTitle = $entry.parentTitle
        year = $entry.year
        type = $entry.type
        ratingKey = $entry.ratingKey
        index = $entry.index
        parentIndex = $entry.parentIndex
        originallyAvailableAt = $entry.originallyAvailableAt
        duration = $entry.duration
        guid = $entry.guid
        guids = @($entry.Guid | ForEach-Object { $_.id })
        thumb = $entry.thumb
        art = $entry.art
        thumbUrl = $thumbUrl
        artUrl = $artUrl
        library = $section.title
        machineIdentifier = $identity.MediaContainer.machineIdentifier
      })
    }
    $start += $rows.Count
    $total = [int]($page.MediaContainer.totalSize)
    if ($total -le 0) { $total = [int]($page.MediaContainer.size) }
  } while ($rows.Count -gt 0 -and $start -lt $total)
}
$payload = [pscustomobject]@{
  format = "ringside-plex-export"
  version = 2
  exportedAt = (Get-Date).ToUniversalTime().ToString("o")
  server = $base
  serverInfo = [pscustomobject]@{ name = $identity.MediaContainer.friendlyName; machineIdentifier = $identity.MediaContainer.machineIdentifier; uri = $base }
  titles = $items
}
$payload | ConvertTo-Json -Depth 8 | Set-Content -Path $Output -Encoding UTF8
Write-Host "Saved $($items.Count) Plex records to $Output"
