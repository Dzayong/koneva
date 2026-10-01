$ErrorActionPreference = 'Stop'
$listenerIp = '192.168.1.7'
$listenPort = 13000
$ruleName = 'KONEVA HTTPS LAN 13000'
$log = Join-Path $env:TEMP 'koneva-enable-lan-https-result.txt'
try {
  $wslIp = ((wsl.exe hostname -I) -join ' ').Trim().Split(' ')[0]
  if ($wslIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Could not determine WSL IPv4 address.' }
  & netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=13000 2>$null | Out-Null
  & netsh.exe interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=18000 2>$null | Out-Null
  & netsh.exe interface portproxy delete v4tov4 "listenaddress=$listenerIp" "listenport=$listenPort" 2>$null | Out-Null
  & netsh.exe interface portproxy add v4tov4 "listenaddress=$listenerIp" "listenport=$listenPort" "connectaddress=$wslIp" "connectport=$listenPort"
  if ($LASTEXITCODE -ne 0) { throw "netsh portproxy setup failed: $LASTEXITCODE" }
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $listenerIp -LocalPort $listenPort -RemoteAddress LocalSubnet -Profile Private | Out-Null
  $forward = & netsh.exe interface portproxy show v4tov4
  Set-Content -Path $log -Value @('result=success', "wsl_ip=$wslIp", "listener=$listenerIp`:$listenPort", "rule=$ruleName", $forward) -Encoding ascii
  Write-Output "KONEVA HTTPS LAN forwarding active: $listenerIp`:$listenPort -> $wslIp`:$listenPort (Private profile, LocalSubnet only)."
} catch {
  Set-Content -Path $log -Value @('result=failed', $_.Exception.Message) -Encoding ascii
  Write-Error $_
  exit 1
}
