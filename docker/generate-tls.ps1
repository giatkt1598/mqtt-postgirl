$ErrorActionPreference = "Stop"

$certDirectory = Join-Path $PSScriptRoot "certs"
New-Item -ItemType Directory -Force -Path $certDirectory | Out-Null

openssl req -x509 -newkey rsa:4096 -sha256 -nodes `
  -keyout (Join-Path $certDirectory "ca.key") `
  -out (Join-Path $certDirectory "ca.crt") `
  -days 3650 -subj "/CN=MQTT - PostGirl Local CA"

openssl req -newkey rsa:2048 -nodes `
  -keyout (Join-Path $certDirectory "server.key") `
  -out (Join-Path $certDirectory "server.csr") `
  -subj "/CN=localhost"

openssl x509 -req -sha256 `
  -in (Join-Path $certDirectory "server.csr") `
  -CA (Join-Path $certDirectory "ca.crt") `
  -CAkey (Join-Path $certDirectory "ca.key") `
  -CAcreateserial `
  -out (Join-Path $certDirectory "server.crt") `
  -days 825 `
  -extfile (Join-Path $PSScriptRoot "tls-server.ext")

Remove-Item -LiteralPath (Join-Path $certDirectory "server.csr"), (Join-Path $certDirectory "ca.srl") -Force
Write-Host "Generated local MQTT TLS certificates in $certDirectory"
