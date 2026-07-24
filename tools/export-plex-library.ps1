param(
  [string]$PlexUrl = "http://127.0.0.1:32400",
  [string]$Token = "",
  [string]$Output = ".\plex-library-export.json"
)
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Token)) {
  $Token = Read-Host "Enter your Plex token"
}
$headers = @{ "X-Plex-Token" = $Token; "Accept" = "application/json" }
$base = $PlexUrl.TrimEnd('/')
Write-Host "Reading Plex libraries from $base..."
$sections = Invoke-RestMethod -Uri "$base/library/sections" -Headers $headers
$items = New-Object System.Collections.Generic.List[object]
foreach ($section in $sections.MediaContainer.Directory) {
  Write-Host "Exporting $($section.title)..."
  $result = Invoke-RestMethod -Uri "$base/library/sections/$($section.key)/all" -Headers $headers
  foreach ($entry in @($result.MediaContainer.Metadata)) {
    $items.Add([pscustomobject]@{
      title = $entry.title
      grandparentTitle = $entry.grandparentTitle
      parentTitle = $entry.parentTitle
      year = $entry.year
      type = $entry.type
      ratingKey = $entry.ratingKey
      library = $section.title
    })
  }
}
$payload = [pscustomobject]@{
  format = "ringside-plex-export"
  exportedAt = (Get-Date).ToUniversalTime().ToString("o")
  server = $base
  titles = $items
}
$payload | ConvertTo-Json -Depth 5 | Set-Content -Path $Output -Encoding UTF8
Write-Host "Saved $($items.Count) Plex records to $Output"
