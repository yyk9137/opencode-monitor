$resp = Invoke-RestMethod -Uri 'https://api.github.com/repos/catppuccin/zed-icons/git/trees/main?recursive=1'
$svgs = $resp.tree | Where-Object { $_.path -match '^icons/.*\.svg$' }
$flavors = @{}
foreach ($s in $svgs) {
    $parts = $s.path.Split('/')
    if ($parts.Count -ge 3) {
        $flavor = $parts[1]
        if (-not $flavors.ContainsKey($flavor)) { $flavors[$flavor] = @() }
        $flavors[$flavor] += $s.path
    }
}
Write-Host "Total SVG files in icons/: $($svgs.Count)"
foreach ($f in ($flavors.Keys | Sort-Object)) {
    Write-Host "  ${f}: $($flavors[$f].Count) SVGs"
}
Write-Host ''
Write-Host 'Sample mocha icons (first 30):'
$mocha = $flavors['mocha'] | Sort-Object
$mocha | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
Write-Host "..."
Write-Host "Total mocha icons: $($flavors['mocha'].Count)"
