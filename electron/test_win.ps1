Add-Type -ReferencedAssemblies "System.Drawing", "System.Windows.Forms" -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class DesktopAutomation {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    const uint DESKTOP_ALL = 0x01FF;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;

    public static void AttachToDefaultDesktop() {
        IntPtr hDefault = OpenDesktop("Default", 0, false, DESKTOP_ALL);
        if (hDefault != IntPtr.Zero) {
            SetThreadDesktop(hDefault);
        }
    }

    public static List<string> GetWindows() {
        var list = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                var sb = new StringBuilder(512);
                int len = GetWindowText(hWnd, sb, 512);
                if (len > 0) {
                    list.Add(sb.ToString());
                }
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }

    public static IntPtr FindWindowByTitle(string query) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                var sb = new StringBuilder(512);
                int len = GetWindowText(hWnd, sb, 512);
                if (len > 0) {
                    string t = sb.ToString();
                    if (t.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0) {
                        found = hWnd;
                        return false;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool ActivateWindow(IntPtr hWnd) {
        ShowWindow(hWnd, 9); // SW_RESTORE
        return SetForegroundWindow(hWnd);
    }
}
'@

$thread = [System.Threading.Thread]::new([System.Threading.ThreadStart]{
    [DesktopAutomation]::AttachToDefaultDesktop()

    Write-Output "--- Current Windows ---"
    $wins = [DesktopAutomation]::GetWindows()
    $wins | ForEach-Object { Write-Output " - $_" }

    Write-Output "--- Starting Notepad ---"
    $proc = [System.Diagnostics.Process]::Start("notepad.exe")
    [System.Threading.Thread]::Sleep(1500)

    $notepadHwnd = [DesktopAutomation]::FindWindowByTitle("Notepad")
    Write-Output "Found Notepad HWND: 0x$($notepadHwnd.ToString('X'))"

    if ($notepadHwnd -ne [IntPtr]::Zero) {
        [DesktopAutomation]::ActivateWindow($notepadHwnd) | Out-Null
        [System.Threading.Thread]::Sleep(500)
        [System.Windows.Forms.SendKeys]::SendWait("Hello from NEXUS AI Desktop Agent!")
        Write-Output "Typed text into Notepad successfully."
    }
})

$thread.Start()
$thread.Join()
