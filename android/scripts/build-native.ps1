# Rebuilds the Rust spreadsheet engine for Android and copies it into the app.
# Needs: rustup targets aarch64-linux-android and x86_64-linux-android, NDK 28 at D:\Android\ndk.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location "$root\native\apex-sheets-core"
foreach ($pair in @(@('aarch64-linux-android','arm64-v8a'), @('x86_64-linux-android','x86_64'))) {
    cargo build --release --target $pair[0]
    New-Item -ItemType Directory -Force -Path "$root\app\src\main\jniLibs\$($pair[1])" | Out-Null
    Copy-Item "target\$($pair[0])\release\libapex_sheets_core.so" "$root\app\src\main\jniLibs\$($pair[1])\"
}
Pop-Location
