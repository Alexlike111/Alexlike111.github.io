# Simple local web server for testing the game (no install needed)
$root = Join-Path $PSScriptRoot 'game'
$port = 8160
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript'; '.css'='text/css'; '.json'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.webp'='image/webp'; '.svg'='image/svg+xml'; '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'; '.wasm'='application/wasm'; '.woff2'='font/woff2' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$port/")
$l.Start()
Write-Host "Crush City 3D 1.5.0: http://localhost:$port/  (close this window to stop)"
Start-Process "http://localhost:$port/"
while ($l.IsListening) {
  $c = $l.GetContext()
  $p = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath.TrimStart('/'))
  if ($p -eq '') { $p = 'index.html' }
  $f = Join-Path $root $p
  if ((Test-Path $f -PathType Leaf) -and ((Resolve-Path $f).Path.StartsWith($root))) {
    $b = [IO.File]::ReadAllBytes($f)
    $e = [IO.Path]::GetExtension($f).ToLower()
    if ($types[$e]) { $c.Response.ContentType = $types[$e] }
    $c.Response.Headers.Add('Cache-Control', 'no-store')
    $c.Response.OutputStream.Write($b, 0, $b.Length)
  } else { $c.Response.StatusCode = 404 }
  $c.Response.Close()
}
