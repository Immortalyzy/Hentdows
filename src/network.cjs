const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
// Read the lowest-metric default route rather than treating any enabled Wi-Fi card
// as the active connection. Unknown/VPN routes fail closed for Wi-Fi-only mode.
const QUERY = `$ErrorActionPreference = 'Stop'
$taskAdapters = @(Get-NetAdapter)
$taskInterfaces = @(Get-NetIPInterface)
$taskRoutes = @(Get-NetRoute | Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','::/0') -and $_.State -ne 'Invalid' } | ForEach-Object {
  $taskRoute = $_
  $taskInterface = $taskInterfaces | Where-Object { $_.InterfaceIndex -eq $taskRoute.InterfaceIndex -and $_.AddressFamily -eq $taskRoute.AddressFamily -and $_.ConnectionState -eq 'Connected' } | Select-Object -First 1
  if ($taskInterface) { [pscustomobject]@{ Index = $taskRoute.InterfaceIndex; Metric = $taskRoute.RouteMetric + $taskInterface.InterfaceMetric } }
} | Sort-Object Metric)
if (!$taskRoutes.Count) { 'unknown'; exit }
$taskBest = @($taskRoutes | Where-Object { $_.Metric -eq $taskRoutes[0].Metric })
$taskWifi = @($taskBest | Where-Object { $taskIndex = $_.Index; $taskAdapters | Where-Object { $_.InterfaceIndex -eq $taskIndex -and $_.NdisPhysicalMedium -in @(1,9) } })
if ($taskWifi.Count -eq $taskBest.Count) { 'wifi' } else { 'other' }`;

function createNetworkProbe(isOnline = () => true) {
  let cached, expires = 0, pending;
  return async () => {
    if (!isOnline()) return { online: false, wifi: false };
    if (Date.now() < expires) return { online: true, wifi: cached };
    if (!pending) pending = (async () => {
      try {
        if (process.platform !== 'win32') return null;
        const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', QUERY], { windowsHide: true, timeout: 10000 });
        return stdout.trim() === 'wifi' ? true : stdout.trim() === 'other' ? false : null;
      } catch { return null; }
    })().then(wifi => { cached = wifi; expires = Date.now() + 15000; pending = null; return { online: true, wifi }; });
    return pending;
  };
}
module.exports = { createNetworkProbe };
