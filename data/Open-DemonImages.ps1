# Open-DemonImages.ps1
# Reads demons.json and opens all "image" URLs in Google Chrome, pausing for Enter between batches.

param(
    [string]$JsonPath = "$PSScriptRoot\demons.json", # path to demons.json
    [int]$BatchSize = 15                            # number of tabs per batch
)

function Get-ChromePath {
    $candidates = @(
        "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
        "chrome.exe"
    )
    foreach ($p in $candidates) {
        try {
            $full = (Get-Command $p -ErrorAction SilentlyContinue).Source
            if ($full) { return $full }
        } catch { }
    }
    throw "Google Chrome not found. Please install Chrome or add it to PATH."
}

function Get-ImageUrlsFromJson {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File not found: $Path"
    }
    $raw = Get-Content -LiteralPath $Path -Raw
    $data = $raw | ConvertFrom-Json

    $items =
        if ($data -is [System.Collections.IEnumerable]) { $data }
        elseif ($data.psobject.Properties.Match('items').Count -gt 0) { $data.items }
        else { @($data) }

    $urls = $items |
        ForEach-Object { $_.image } |
        Where-Object { $_ -and ($_ -is [string]) -and ($_ -match '^https?://') } |
        ForEach-Object { $_.Trim() } |
        Select-Object -Unique

    return $urls
}

function Open-InChrome {
    param(
        [string[]]$Urls,
        [int]$BatchSize = 15
    )
    $chrome = Get-ChromePath

    for ($i = 0; $i -lt $Urls.Count; $i += $BatchSize) {
        $batch = $Urls[$i..([math]::Min($i + $BatchSize - 1, $Urls.Count - 1))]
        Start-Process -FilePath $chrome -ArgumentList $batch
        Write-Host "Opened $($batch.Count) tabs. Press Enter for next batch..."
        [void][System.Console]::ReadLine()
    }
}

try {
    Write-Host "Reading: $JsonPath"
    $urls = Get-ImageUrlsFromJson -Path $JsonPath
    if ($urls -and $urls.Count -gt 0) {
        Write-Host ("Found {0} unique image URLs." -f $urls.Count)
        Open-InChrome -Urls $urls -BatchSize $BatchSize
        Write-Host "All batches done."
    } else {
        Write-Warning "No URLs found."
    }
} catch {
    Write-Error $_
    exit 1
}
