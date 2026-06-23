$urls = @(
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/mocha/vue.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/mocha/rust.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/mocha/python.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/mocha/javascript.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/mocha/_folder.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/latte/vue.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/latte/rust.svg',
  'https://raw.githubusercontent.com/catppuccin/zed-icons/main/icons/latte/python.svg'
)
foreach ($u in $urls) {
  $parts = $u -split '/'
  $name = $parts[-1]
  $flavor = $parts[-2]
  $content = (Invoke-WebRequest -Uri $u).Content
  $hexes = [regex]::Matches($content, '#[0-9a-fA-F]{6}') | ForEach-Object { $_.Value } | Sort-Object -Unique
  Write-Host "${flavor}/${name}: $($hexes -join ', ')"
}
