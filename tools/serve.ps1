# Minimal static file server for local preview.
# No node / python needed. Uses HttpListener, which works without admin rights
# as long as the prefix is localhost.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8080
#
# Add -Lan to also listen on the machine's IP so a phone on the same wifi can
# reach it. That prefix needs an elevated shell (or a netsh urlacl entry).
param(
    [int]$Port = 8080,
    [string]$Root = $null,
    [switch]$Lan
)

if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path $Root).Path

$MIME = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.webp' = 'image/webp'
    '.pdf'  = 'application/pdf'
    '.woff2'= 'font/woff2'
    '.mp4'  = 'video/mp4'
    '.webm' = 'video/webm'
}

$listener = New-Object System.Net.HttpListener
if ($Lan) { $listener.Prefixes.Add("http://+:$Port/") } else { $listener.Prefixes.Add("http://localhost:$Port/") }

try {
    $listener.Start()
} catch {
    Write-Host ("Could not listen on port {0}: {1}" -f $Port, $_.Exception.Message)
    if ($Lan) { Write-Host "The -Lan prefix needs an elevated PowerShell." }
    exit 1
}

Write-Host "Serving $Root"
Write-Host "  http://localhost:$Port/"
if ($Lan) {
    foreach ($ip in [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())) {
        if ($ip.AddressFamily -eq 'InterNetwork') {
            Write-Host ("  http://{0}:{1}/   (phone on the same wifi)" -f $ip, $Port)
        }
    }
}

while ($listener.IsListening) {
    try {
        $ctx = $listener.GetContext()
        $req = $ctx.Request
        $res = $ctx.Response

        # Dev helper: let the page POST canvas data back so it can be saved as a
        # file for visual inspection. Writes into _tmp only, filename sanitised.
        if ($req.HttpMethod -eq 'POST' -and $req.Url.AbsolutePath -eq '/__save') {
            $name = $req.QueryString['name']
            if (-not $name) { $name = 'upload.bin' }
            $name = ($name -replace '[^A-Za-z0-9._-]', '_')
            $dir = Join-Path $Root '_tmp'
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

            $ms = New-Object System.IO.MemoryStream
            $req.InputStream.CopyTo($ms)
            [System.IO.File]::WriteAllBytes((Join-Path $dir $name), $ms.ToArray())
            $ms.Dispose()

            $res.StatusCode = 200
            $res.ContentType = 'text/plain'
            $ok = [System.Text.Encoding]::UTF8.GetBytes("saved _tmp/$name")
            $res.ContentLength64 = $ok.Length
            $res.OutputStream.Write($ok, 0, $ok.Length)
            $res.OutputStream.Close()
            Write-Host ("SAVE _tmp/{0}" -f $name)
            continue
        }

        $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
        if ($rel -eq '') { $rel = 'index.html' }
        $rel = $rel -replace '/', '\'

        $resolved = $null
        try { $resolved = (Resolve-Path -LiteralPath (Join-Path $Root $rel) -ErrorAction Stop).Path } catch { }

        if ($resolved -and $resolved.StartsWith($Root) -and (Test-Path -LiteralPath $resolved -PathType Leaf)) {
            $ext = [System.IO.Path]::GetExtension($resolved).ToLower()
            $res.ContentType = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { 'application/octet-stream' }
            $res.Headers.Add('Cache-Control', 'no-store')      # always serve fresh while developing
            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host ("200 {0}" -f $req.Url.AbsolutePath)
        } else {
            $res.StatusCode = 404
            $res.ContentType = 'text/plain; charset=utf-8'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: " + $req.Url.AbsolutePath)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
            Write-Host ("404 {0}" -f $req.Url.AbsolutePath)
        }
        $res.OutputStream.Close()
    } catch {
        Write-Host ("error: {0}" -f $_.Exception.Message)
    }
}
