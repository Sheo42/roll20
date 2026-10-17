# dps_ui.ps1 - drive Dungeon Painter Studio's window for the DPS Maps extension.
#   -Action window : report the DPS window geometry (no input sent)
#   -Action export : open -MapPath in DPS, export a JPG and save it as -OutPath
# Clicks use points from -PointsFile (physical pixels from the client area's top-left or centre);
# native Windows dialogs (open / save) are driven with the keyboard. Prints one JSON object.
param(
    [Parameter(Mandatory = $true)][string]$Action,
    [string]$Exe,
    [string]$MapPath,
    [string]$OutPath,
    [string]$PointsFile,
    [int]$LoadWait = 5,
    [int]$RenderTimeout = 180,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$log = New-Object System.Collections.ArrayList
function Say($m) { [void]$log.Add(('{0:HH:mm:ss.f} {1}' -f (Get-Date), $m)) }
function Done($obj) { $obj['log'] = $log; $obj | ConvertTo-Json -Depth 6 -Compress; exit 0 }
function Fail($msg) { Done @{ ok = $false; error = $msg } }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class DpsW {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  public static List<IntPtr> Windows(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, x) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static void Click(int x, int y) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(120);
    mouse_event(2, 0, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(60); mouse_event(4, 0, 0, 0, UIntPtr.Zero);
  }
  public static void Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);   // Alt tap lets SetForegroundWindow work
    BringWindowToTop(h); SetForegroundWindow(h);
  }
}
"@
try { [void][DpsW]::SetProcessDpiAwareness(2) } catch { [void][DpsW]::SetProcessDPIAware() }

function Get-DpsProcess {
    $exeFull = [IO.Path]::GetFullPath($Exe)
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $exeFull) } | Select-Object -First 1
}
function Get-Windows($proc) {
    foreach ($h in [DpsW]::Windows([uint32]$proc.Id)) {
        $r = New-Object DpsW+RECT; [void][DpsW]::GetWindowRect($h, [ref]$r)
        [pscustomobject]@{ h = $h; cls = [DpsW]::Cls($h); title = [DpsW]::Title($h); w = $r.R - $r.L; hgt = $r.B - $r.T; rect = $r }
    }
}
function Get-Main($proc) { Get-Windows $proc | Where-Object { $_.cls -ne '#32770' } | Sort-Object { $_.w * $_.hgt } -Descending | Select-Object -First 1 }
function Get-Dialog($proc) { Get-Windows $proc | Where-Object { $_.cls -eq '#32770' } | Select-Object -First 1 }
function Wait-Dialog($proc, $seconds, [bool]$present) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
        $d = Get-Dialog $proc
        if ($present -and $d) { return $d }
        if (-not $present -and -not $d) { return $true }
        Start-Sleep -Milliseconds 200
    }
    if ($present) { return $null } else { return $false }
}
function Client($h) {
    $c = New-Object DpsW+RECT; [void][DpsW]::GetClientRect($h, [ref]$c)
    $p = New-Object DpsW+POINT; [void][DpsW]::ClientToScreen($h, [ref]$p)
    @{ x = $p.X; y = $p.Y; w = $c.R; h = $c.B }
}
function Point($h, $name) {
    $pt = $points.$name
    if (-not $pt) { throw "no point '$name' in $PointsFile" }
    $c = Client $h
    if ($pt.from -eq 'center') { $x = $c.x + [int]($c.w / 2) + [int]$pt.x; $y = $c.y + [int]($c.h / 2) + [int]$pt.y }
    else { $x = $c.x + [int]$pt.x; $y = $c.y + [int]$pt.y }
    @{ x = $x; y = $y }
}
function ClickPoint($h, $name) {
    $p = Point $h $name
    Say "click $name at $($p.x),$($p.y)"
    if (-not $DryRun) { [DpsW]::Focus($h); Start-Sleep -Milliseconds 150; [DpsW]::Click($p.x, $p.y) }
}
function Esc($s) { ($s -replace '([\+\^%~\(\)\{\}\[\]])', '{$1}') }
function TypeIn($text) { [System.Windows.Forms.SendKeys]::SendWait((Esc $text)) }

$proc = Get-DpsProcess
if ($Action -eq 'window') {
    if (-not $proc) { Done @{ ok = $true; running = $false; exe = $Exe } }
    $main = Get-Main $proc
    $scr = [System.Windows.Forms.Screen]::FromHandle($main.h)
    Done @{ ok = $true; running = $true; pid = $proc.Id; title = $main.title; cls = $main.cls
        window = @{ x = $main.rect.L; y = $main.rect.T; w = $main.w; h = $main.hgt }; client = (Client $main.h)
        dpi = [DpsW]::GetDpiForWindow($main.h); screen = @{ x = $scr.Bounds.X; y = $scr.Bounds.Y; w = $scr.Bounds.Width; h = $scr.Bounds.Height }
        foreground = ([DpsW]::GetForegroundWindow() -eq $main.h); dialogs = @(Get-Windows $proc | Where-Object { $_.cls -eq '#32770' } | ForEach-Object { $_.title }) }
}

if ($Action -ne 'export') { Fail "unknown action $Action" }
if (-not (Test-Path -LiteralPath $MapPath)) { Fail "map not found: $MapPath" }
$points = Get-Content -LiteralPath $PointsFile -Raw | ConvertFrom-Json

if (-not $proc) {
    Say "starting DPS"
    if ($DryRun) { Fail 'DPS is not running (dry run does not start it)' }
    Start-Process -FilePath $Exe -WorkingDirectory (Split-Path $Exe) | Out-Null
    $t = (Get-Date).AddSeconds(60)
    while (-not $proc -and (Get-Date) -lt $t) { Start-Sleep -Seconds 1; $proc = Get-DpsProcess }
    if (-not $proc) { Fail 'DPS did not start' }
    $t = (Get-Date).AddSeconds(60)
    while (-not (Get-Main $proc) -and (Get-Date) -lt $t) { Start-Sleep -Seconds 1 }
    Start-Sleep -Seconds 8
}
if (Get-Dialog $proc) { Fail 'a DPS dialog is already open: close it first' }
$main = Get-Main $proc
if (-not $main) { Fail 'DPS window not found' }
Say "DPS window $($main.w)x$($main.hgt) '$($main.title)'"

# 1. open the map
ClickPoint $main.h 'open'
if ($DryRun) {
    ClickPoint $main.h 'confirm_ok'; ClickPoint $main.h 'export'; ClickPoint $main.h 'create_jpg'
    Done @{ ok = $true; dryRun = $true }
}
$dlg = Wait-Dialog $proc 2.5 $true
if (-not $dlg) {
    Say 'no file dialog yet: confirming "the current map will be lost"'
    ClickPoint $main.h 'confirm_ok'
    $dlg = Wait-Dialog $proc 6 $true
}
if (-not $dlg) { Fail 'the open-file dialog did not appear (check the points file)' }
Say "open dialog: $($dlg.title)"
[DpsW]::Focus($dlg.h); Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('%n'); Start-Sleep -Milliseconds 200
TypeIn $MapPath; Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
if (-not (Wait-Dialog $proc 10 $false)) {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Fail 'the open-file dialog did not close (file refused?)'
}
Say "loading, waiting $LoadWait s"
Start-Sleep -Seconds $LoadWait

# 2. export
$main = Get-Main $proc
ClickPoint $main.h 'export'
Start-Sleep -Milliseconds 2500
ClickPoint $main.h 'create_jpg'
Say 'rendering'
$dlg = Wait-Dialog $proc $RenderTimeout $true
if (-not $dlg) { Fail "no save dialog after $RenderTimeout s (check the points file)" }
Say "save dialog: $($dlg.title)"
[DpsW]::Focus($dlg.h); Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('%n'); Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('^a'); Start-Sleep -Milliseconds 100
TypeIn $OutPath; Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 1500
$still = Get-Dialog $proc
if ($still) {
    Say "a dialog is still open: '$($still.title)' (overwrite question?) - cancelling"
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 400
    if (Get-Dialog $proc) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}') }
    Fail 'saving did not finish: the save dialog stayed open'
}
# 3. wait for the file to be complete
$t = (Get-Date).AddSeconds(90); $last = -1
while ((Get-Date) -lt $t) {
    if (Test-Path -LiteralPath $OutPath) {
        $n = (Get-Item -LiteralPath $OutPath).Length
        if ($n -gt 0 -and $n -eq $last) { Done @{ ok = $true; out = $OutPath; bytes = $n } }
        $last = $n
    }
    Start-Sleep -Milliseconds 700
}
Fail "the export file did not appear: $OutPath"
