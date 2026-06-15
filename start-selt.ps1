$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  Write-Host "Created .env. Add a NEW Groq API key to it, then run this script again." -ForegroundColor Yellow
  exit 1
}

node ".\server.js"
