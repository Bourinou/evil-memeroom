param([long]$OverlayHandle, [long]$TargetHandle)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class MemeRoomWindowOrder {
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);
}
'@
$cursor = [IntPtr]$TargetHandle
$above = $false
for ($index = 0; $index -lt 2000; $index++) {
  $cursor = [MemeRoomWindowOrder]::GetWindow($cursor, 3)
  if ($cursor -eq [IntPtr]::Zero) { break }
  if ($cursor -eq [IntPtr]$OverlayHandle) { $above = $true; break }
}
$style = [MemeRoomWindowOrder]::GetWindowLongPtr([IntPtr]$OverlayHandle, -20).ToInt64()
@{ above=$above; clickThrough=(($style -band 0x20) -ne 0); noActivate=(($style -band 0x08000000) -ne 0) } | ConvertTo-Json -Compress
