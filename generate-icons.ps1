Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Home\.gemini\antigravity\brain\c7e3b058-ca8d-4604-8e0f-a15756d2d838\.user_uploaded\media_1792475935262_860f6b53.jpg"
$baseDir = "C:\Users\Home\.gemini\antigravity\scratch\nexus-ai"

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

function Resize-Image($img, $w, $h) {
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($img, 0, 0, $w, $h)
    $g.Dispose()
    return $bmp
}

function Image-To-Png-Bytes($img) {
    $ms = New-Object System.IO.MemoryStream
    $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

# 1. Save high-res PNGs
$img1024 = Resize-Image $srcImg 1024 1024
$png1024Bytes = Image-To-Png-Bytes $img1024

[System.IO.File]::WriteAllBytes("$baseDir\build\icon.png", $png1024Bytes)
[System.IO.File]::WriteAllBytes("$baseDir\public\icon.png", $png1024Bytes)
[System.IO.File]::WriteAllBytes("$baseDir\src\assets\nexus-logo.png", $png1024Bytes)
Write-Output "Saved 1024x1024 PNGs to build/icon.png, public/icon.png, src/assets/nexus-logo.png"

# 2. Build multi-res ICO
$sizes = @(256, 128, 64, 48, 32, 16)
$pngList = @()

foreach ($s in $sizes) {
    $resized = Resize-Image $srcImg $s $s
    $pngBytes = Image-To-Png-Bytes $resized
    $resized.Dispose()
    $pngList += ,@($s, $pngBytes)
}

# Construct ICO binary
$icoStream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoStream)

# Header: reserved(0), type(1=icon), count
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$sizes.Length)

$offset = 6 + ($sizes.Length * 16)

foreach ($item in $pngList) {
    $s = $item[0]
    $data = $item[1]
    
    $bw.Write([byte]$(if ($s -eq 256) { 0 } else { $s }))
    $bw.Write([byte]$(if ($s -eq 256) { 0 } else { $s }))
    $bw.Write([byte]0) # colors
    $bw.Write([byte]0) # reserved
    $bw.Write([uint16]1) # color planes
    $bw.Write([uint16]32) # bpp
    $bw.Write([uint32]$data.Length) # data size
    $bw.Write([uint32]$offset) # offset
    
    $offset += $data.Length
}

foreach ($item in $pngList) {
    $data = $item[1]
    $bw.Write($data)
}

$bw.Flush()
$icoBytes = $icoStream.ToArray()
$bw.Dispose()
$icoStream.Dispose()
$img1024.Dispose()
$srcImg.Dispose()

[System.IO.File]::WriteAllBytes("$baseDir\build\icon.ico", $icoBytes)
[System.IO.File]::WriteAllBytes("$baseDir\public\favicon.ico", $icoBytes)
Write-Output "Saved multi-resolution ICO ($($icoBytes.Length) bytes) to build/icon.ico and public/favicon.ico"
