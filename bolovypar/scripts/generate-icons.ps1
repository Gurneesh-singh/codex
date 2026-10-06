Add-Type -AssemblyName System.Drawing

$assetDir = Join-Path $PSScriptRoot '..\mobile\assets'
$green = [System.Drawing.ColorTranslator]::FromHtml('#006B60')
$white = [System.Drawing.Color]::White

function New-Icon([string]$name, [int]$size, [string]$mode) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $greenBrush = [System.Drawing.SolidBrush]::new($green)
  $whiteBrush = [System.Drawing.SolidBrush]::new($white)

  if ($mode -eq 'background' -or $mode -eq 'full') {
    $graphics.FillRectangle($greenBrush, 0, 0, $size, $size)
  }

  if ($mode -eq 'full' -or $mode -eq 'foreground') {
    $x = [int]($size * 0.19)
    $y = [int]($size * 0.18)
    $diameter = [int]($size * 0.62)
    $graphics.FillEllipse($whiteBrush, $x, $y, $diameter, $diameter)
    $tail = [System.Drawing.Point[]]@(
      [System.Drawing.Point]::new([int]($size * 0.26), [int]($size * 0.67)),
      [System.Drawing.Point]::new([int]($size * 0.23), [int]($size * 0.85)),
      [System.Drawing.Point]::new([int]($size * 0.42), [int]($size * 0.76))
    )
    $graphics.FillPolygon($whiteBrush, $tail)
  }

  if ($mode -eq 'full' -or $mode -eq 'foreground' -or $mode -eq 'monochrome') {
    $font = [System.Drawing.Font]::new('Arial', [single]($size * 0.43), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = [System.Drawing.RectangleF]::new([single]($size * 0.19), [single]($size * 0.14), [single]($size * 0.62), [single]($size * 0.67))
    $graphics.DrawString('B', $font, $(if ($mode -eq 'monochrome') { $whiteBrush } else { $greenBrush }), $rect, $format)
    $format.Dispose()
    $font.Dispose()
  }

  $bitmap.Save((Join-Path $assetDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $whiteBrush.Dispose()
  $greenBrush.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-Icon 'icon.png' 1024 'full'
New-Icon 'splash-icon.png' 1024 'full'
New-Icon 'android-icon-foreground.png' 432 'foreground'
New-Icon 'android-icon-background.png' 432 'background'
New-Icon 'android-icon-monochrome.png' 432 'monochrome'
New-Icon 'favicon.png' 48 'full'
