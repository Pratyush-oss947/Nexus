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

namespace NexusDesktopHelper {
    public class WindowEntry {
        public long Hwnd;
        public uint ProcessId;
        public string ProcessName;
        public string Title;
        public int Left;
        public int Top;
        public int Width;
        public int Height;
        public bool IsForeground;
    }

    public static class Win32 {
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
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        public const byte VK_MENU = 0x12;
        public const uint KEYEVENTF_KEYUP = 0x0002;

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        public struct STARTUPINFO {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESS_INFORMATION {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern bool CreateProcess(
            string lpApplicationName,
            string lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);


        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        public const uint DESKTOP_ALL = 0x01FF;
        public const int SW_RESTORE = 9;
        public const int SW_SHOW = 5;
        public const uint WM_CLOSE = 0x0010;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
    }

    public class Program {
        static void AttachDesktop() {
            // Keep thread attached to the interactive user session desktop.
            // Explicitly calling SetThreadDesktop(OpenDesktop("Default", ...)) detaches the thread
            // from modern Windows 11 AppContainer apps (e.g. modern packaged Notepad, Calculator, Paint),
            // making EnumWindows unable to see their windows. Leaving default thread desktop intact ensures
            // full visibility of both Win32 and AppContainer application windows.
        }

        static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            var sb = new StringBuilder(s.Length + 10);
            foreach (char c in s) {
                switch (c) {
                    case '\\': sb.Append("\\\\"); break;
                    case '\"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') {
                            sb.AppendFormat("\\u{0:x4}", (int)c);
                        } else {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }

        static string WindowToJson(WindowEntry w) {
            return string.Format(
                "{{\"hwnd\":\"0x{0:X}\",\"processId\":{1},\"processName\":\"{2}\",\"title\":\"{3}\",\"left\":{4},\"top\":{5},\"width\":{6},\"height\":{7},\"isForeground\":{8}}}",
                w.Hwnd,
                w.ProcessId,
                EscapeJson(w.ProcessName),
                EscapeJson(w.Title),
                w.Left,
                w.Top,
                w.Width,
                w.Height,
                w.IsForeground ? "true" : "false"
            );
        }

        static List<WindowEntry> EnumerateWindowsInternal() {
            var list = new List<WindowEntry>();
            IntPtr fgHwnd = Win32.GetForegroundWindow();

            Win32.EnumWindows((hWnd, lParam) => {
                if (!Win32.IsWindowVisible(hWnd)) return true;

                var sb = new StringBuilder(512);
                int len = Win32.GetWindowText(hWnd, sb, 512);
                string title = sb.ToString().Trim();

                // Ignore system overlay noise
                if (title == "Program Manager" || title == "Windows Input Experience") return true;

                uint pid = 0;
                Win32.GetWindowThreadProcessId(hWnd, out pid);

                string procName = "";
                try {
                    using (var p = Process.GetProcessById((int)pid)) {
                        procName = p.ProcessName;
                    }
                } catch {}

                Win32.RECT rect;
                Win32.GetWindowRect(hWnd, out rect);
                int width = Math.Max(0, rect.Right - rect.Left);
                int height = Math.Max(0, rect.Bottom - rect.Top);

                // If title is empty, check if it's a known process or skip
                if (string.IsNullOrEmpty(title)) {
                    if (!procName.Equals("Notepad", StringComparison.OrdinalIgnoreCase) &&
                        !procName.Equals("Calculator", StringComparison.OrdinalIgnoreCase) &&
                        !procName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) {
                        return true;
                    }
                    title = "[" + procName + "]";
                }


                list.Add(new WindowEntry {
                    Hwnd = hWnd.ToInt64(),
                    ProcessId = pid,
                    ProcessName = procName,
                    Title = title,
                    Left = rect.Left,
                    Top = rect.Top,
                    Width = width,
                    Height = height,
                    IsForeground = (hWnd == fgHwnd)
                });

                return true;
            }, IntPtr.Zero);

            return list;
        }

        static WindowEntry GetActiveWindowInternal() {
            IntPtr fg = Win32.GetForegroundWindow();
            if (fg == IntPtr.Zero) return null;

            var sb = new StringBuilder(512);
            Win32.GetWindowText(fg, sb, 512);
            string title = sb.ToString();

            uint pid = 0;
            Win32.GetWindowThreadProcessId(fg, out pid);

            string procName = "";
            try {
                using (var p = Process.GetProcessById((int)pid)) {
                    procName = p.ProcessName;
                }
            } catch {}

            Win32.RECT rect;
            Win32.GetWindowRect(fg, out rect);

            return new WindowEntry {
                Hwnd = fg.ToInt64(),
                ProcessId = pid,
                ProcessName = procName,
                Title = title,
                Left = rect.Left,
                Top = rect.Top,
                Width = Math.Max(0, rect.Right - rect.Left),
                Height = Math.Max(0, rect.Bottom - rect.Top),
                IsForeground = true
            };
        }

        static bool ForceForeground(IntPtr hWnd) {
            uint curThread = Win32.GetCurrentThreadId();
            IntPtr fg = Win32.GetForegroundWindow();
            uint fgPid = 0;
            uint fgThread = (fg != IntPtr.Zero) ? Win32.GetWindowThreadProcessId(fg, out fgPid) : 0;
            uint targetPid = 0;
            uint targetThread = Win32.GetWindowThreadProcessId(hWnd, out targetPid);

            if (fgThread != 0 && fgThread != curThread) {
                Win32.AttachThreadInput(curThread, fgThread, true);
            }
            if (targetThread != 0 && targetThread != curThread && targetThread != fgThread) {
                Win32.AttachThreadInput(curThread, targetThread, true);
            }

            Win32.keybd_event(Win32.VK_MENU, 0, 0, UIntPtr.Zero);
            Win32.ShowWindow(hWnd, Win32.SW_RESTORE);
            Win32.BringWindowToTop(hWnd);
            bool ok = Win32.SetForegroundWindow(hWnd);
            Win32.keybd_event(Win32.VK_MENU, 0, Win32.KEYEVENTF_KEYUP, UIntPtr.Zero);

            if (targetThread != 0 && targetThread != curThread && targetThread != fgThread) {
                Win32.AttachThreadInput(curThread, targetThread, false);
            }
            if (fgThread != 0 && fgThread != curThread) {
                Win32.AttachThreadInput(curThread, fgThread, false);
            }

            return ok;
        }

        static IntPtr ResolveWindowHandle(string query) {
            long hwndVal = 0;
            if (query.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) {
                long.TryParse(query.Substring(2), System.Globalization.NumberStyles.HexNumber, null, out hwndVal);
            } else {
                long.TryParse(query, out hwndVal);
            }

            if (hwndVal > 0) return new IntPtr(hwndVal);

            var windows = EnumerateWindowsInternal();
            foreach (var w in windows) {
                if (w.Title.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    w.ProcessName.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0) {
                    return new IntPtr(w.Hwnd);
                }
            }

            return IntPtr.Zero;
        }

        static Process LaunchProcessOnDefaultDesktop(string target, string arguments) {
            var si = new Win32.STARTUPINFO();
            si.cb = Marshal.SizeOf(si);
            si.lpDesktop = "WinSta0\\Default";
            si.wShowWindow = 5; // SW_SHOW
            si.dwFlags = 1; // STARTF_USESHOWWINDOW

            var pi = new Win32.PROCESS_INFORMATION();
            string cmdLine = string.IsNullOrEmpty(arguments) ? target : (target + " " + arguments);

            bool ok = Win32.CreateProcess(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi);
            if (!ok) {
                // If it doesn't have an extension, try appending .exe
                if (!target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !target.Contains(":") && !target.Contains("\\") && !target.Contains("/")) {
                    string exeCmd = target + ".exe" + (string.IsNullOrEmpty(arguments) ? "" : " " + arguments);
                    ok = Win32.CreateProcess(null, exeCmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi);
                }

                // Only use cmd.exe /c start for explicit protocols (e.g. ms-settings:, shell:)
                if (!ok && target.Contains(":")) {
                    string cmdWrapper = "cmd.exe /c start \"\" " + cmdLine;
                    ok = Win32.CreateProcess(null, cmdWrapper, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, null, ref si, out pi);
                }

                if (!ok) return null;
            }

            int pid = pi.dwProcessId;
            if (pi.hProcess != IntPtr.Zero) Win32.CloseHandle(pi.hProcess);
            if (pi.hThread != IntPtr.Zero) Win32.CloseHandle(pi.hThread);

            try {
                if (pid > 0) return Process.GetProcessById(pid);
            } catch {}
            return null;
        }

        [STAThread]
        static void Main(string[] args) {
            if (args.Length == 0) {
                Console.WriteLine("{\"success\":false,\"error\":\"No command specified\"}");
                return;
            }

            string cmd = args[0].ToLowerInvariant();
            object runResult = null;

            // Worker thread attached to Default desktop
            var worker = new Thread(() => {
                AttachDesktop();

                try {
                    switch (cmd) {
                        case "list-windows": {
                            var list = EnumerateWindowsInternal();
                            var sb = new StringBuilder();
                            sb.Append("{\"success\":true,\"windows\":[");
                            for (int i = 0; i < list.Count; i++) {
                                if (i > 0) sb.Append(",");
                                sb.Append(WindowToJson(list[i]));
                            }
                            sb.Append("]}");
                            runResult = sb.ToString();
                            break;
                        }

                        case "get-active-window": {
                            var active = GetActiveWindowInternal();
                            if (active != null) {
                                runResult = string.Format("{{\"success\":true,\"activeWindow\":{0}}}", WindowToJson(active));
                            } else {
                                runResult = "{\"success\":false,\"error\":\"No active window found\"}";
                            }
                            break;
                        }

                        case "activate-window": {
                            if (args.Length < 2) {
                                runResult = "{\"success\":false,\"error\":\"Window title or HWND required\"}";
                                break;
                            }
                            string query = args[1];
                            IntPtr hWnd = ResolveWindowHandle(query);
                            if (hWnd == IntPtr.Zero) {
                                runResult = string.Format("{{\"success\":false,\"error\":\"Window '{0}' not found\"}}", EscapeJson(query));
                                break;
                            }

                            bool ok = ForceForeground(hWnd);
                            Thread.Sleep(200);

                            // Find the window entry for the target
                            var wins = EnumerateWindowsInternal();
                            WindowEntry targetWin = null;
                            foreach (var w in wins) {
                                if (w.Hwnd == hWnd.ToInt64()) {
                                    targetWin = w;
                                    break;
                                }
                            }

                            runResult = string.Format(
                                "{{\"success\":true,\"activated\":{0},\"window\":{1}}}",
                                ok ? "true" : "false",
                                targetWin != null ? WindowToJson(targetWin) : "null"
                            );
                            break;
                        }

                        case "type-text": {
                            if (args.Length < 2) {
                                runResult = "{\"success\":false,\"error\":\"Text parameter is required\"}";
                                break;
                            }
                            string rawText = args[1];
                            string targetQuery = args.Length > 2 ? args[2] : "";

                            if (!string.IsNullOrEmpty(targetQuery)) {
                                IntPtr targetHwnd = ResolveWindowHandle(targetQuery);
                                if (targetHwnd != IntPtr.Zero) {
                                    ForceForeground(targetHwnd);
                                    Thread.Sleep(200);
                                }
                            } else {
                                IntPtr fg = Win32.GetForegroundWindow();
                                if (fg != IntPtr.Zero) {
                                    ForceForeground(fg);
                                    Thread.Sleep(100);
                                }
                            }

                            // Send input via Clipboard paste (Ctrl+V) for multi-line text or long poems,
                            // or fallback to SendKeys with proper {ENTER} translation
                            bool usedClipboard = false;
                            try {
                                if (rawText.Contains("\n") || rawText.Length > 25) {
                                    Clipboard.SetText(rawText);
                                    SendKeys.SendWait("^v");
                                    usedClipboard = true;
                                }
                            } catch {}

                            if (!usedClipboard) {
                                var sbEscaped = new StringBuilder();
                                for (int i = 0; i < rawText.Length; i++) {
                                    char c = rawText[i];
                                    if (c == '\r') continue;
                                    if (c == '\n') {
                                        sbEscaped.Append("{ENTER}");
                                    } else if ("+^%~{}[]()".IndexOf(c) >= 0) {
                                        sbEscaped.Append("{" + c + "}");
                                    } else {
                                        sbEscaped.Append(c);
                                    }
                                }
                                SendKeys.SendWait(sbEscaped.ToString());
                            }

                            runResult = string.Format("{{\"success\":true,\"typed\":\"{0}\"}}", EscapeJson(rawText));
                            break;
                        }

                        case "press-key": {
                            if (args.Length < 2) {
                                runResult = "{\"success\":false,\"error\":\"Key name required\"}";
                                break;
                            }
                            string keyArg = args[1].ToUpperInvariant().Trim();
                            string targetQuery = args.Length > 2 ? args[2] : "";

                            if (!string.IsNullOrEmpty(targetQuery)) {
                                IntPtr targetHwnd = ResolveWindowHandle(targetQuery);
                                if (targetHwnd != IntPtr.Zero) {
                                    ForceForeground(targetHwnd);
                                    Thread.Sleep(200);
                                }
                            }

                            string sendKeyStr = "";
                            switch (keyArg) {
                                case "ENTER":
                                case "RETURN":
                                    sendKeyStr = "{ENTER}"; break;
                                case "ESCAPE":
                                case "ESC":
                                    sendKeyStr = "{ESC}"; break;
                                case "TAB":
                                    sendKeyStr = "{TAB}"; break;
                                case "BACKSPACE":
                                    sendKeyStr = "{BACKSPACE}"; break;
                                case "UP":
                                    sendKeyStr = "{UP}"; break;
                                case "DOWN":
                                    sendKeyStr = "{DOWN}"; break;
                                case "LEFT":
                                    sendKeyStr = "{LEFT}"; break;
                                case "RIGHT":
                                    sendKeyStr = "{RIGHT}"; break;
                                case "CTRL+C":
                                    sendKeyStr = "^c"; break;
                                case "CTRL+V":
                                    sendKeyStr = "^v"; break;
                                case "CTRL+A":
                                    sendKeyStr = "^a"; break;
                                case "CTRL+S":
                                    sendKeyStr = "^s"; break;
                                case "ALT+F4":
                                    sendKeyStr = "%{F4}"; break;
                                default:
                                    sendKeyStr = keyArg.StartsWith("{") ? keyArg : "{" + keyArg + "}";
                                    break;
                            }

                            SendKeys.SendWait(sendKeyStr);
                            runResult = string.Format("{{\"success\":true,\"pressed\":\"{0}\"}}", EscapeJson(keyArg));
                            break;
                        }

                        case "launch-app": {
                            if (args.Length < 2) {
                                runResult = "{\"success\":false,\"error\":\"App name required\"}";
                                break;
                            }
                            string appName = args[1].ToLowerInvariant().Trim();
                            string extraArgs = args.Length > 2 ? args[2] : "";
                            string ignoreHwndList = args.Length > 3 ? args[3].ToLowerInvariant() : "";

                            Process proc = null;
                            string resolvedTarget = "";

                            if (appName == "notepad" || appName.Contains("notepad")) {
                                resolvedTarget = "notepad.exe";
                                proc = LaunchProcessOnDefaultDesktop("notepad.exe", extraArgs);
                            } else if (appName == "calc" || appName == "calculator" || appName.Contains("calc")) {
                                resolvedTarget = "calc.exe";
                                proc = LaunchProcessOnDefaultDesktop("calc.exe", extraArgs);
                            } else if (appName == "paint" || appName == "mspaint" || appName.Contains("paint")) {
                                resolvedTarget = "mspaint.exe";
                                proc = LaunchProcessOnDefaultDesktop("mspaint.exe", extraArgs);
                            } else if (appName == "explorer" || appName == "files" || appName.Contains("explorer") || appName.Contains("downloads")) {
                                resolvedTarget = "explorer.exe";
                                string folder = string.IsNullOrEmpty(extraArgs) ? "shell:Downloads" : extraArgs;
                                proc = LaunchProcessOnDefaultDesktop("explorer.exe", folder);
                            } else if (appName == "settings" || appName.Contains("settings")) {
                                resolvedTarget = "ms-settings:";
                                string page = string.IsNullOrEmpty(extraArgs) ? "ms-settings:" : (extraArgs.StartsWith("ms-settings:") ? extraArgs : "ms-settings:" + extraArgs);
                                proc = LaunchProcessOnDefaultDesktop("cmd.exe /c start " + page, "");
                            } else if (appName == "chrome" || appName.Contains("chrome")) {
                                resolvedTarget = "chrome";
                                string chromePath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
                                if (!File.Exists(chromePath)) {
                                    chromePath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
                                }
                                if (File.Exists(chromePath)) {
                                    proc = LaunchProcessOnDefaultDesktop("\"" + chromePath + "\"", extraArgs);
                                } else {
                                    proc = LaunchProcessOnDefaultDesktop(string.IsNullOrEmpty(extraArgs) ? "cmd.exe /c start chrome" : ("cmd.exe /c start chrome " + extraArgs), "");
                                }
                            } else if (appName == "edge" || appName.Contains("edge")) {
                                resolvedTarget = "msedge";
                                proc = LaunchProcessOnDefaultDesktop(string.IsNullOrEmpty(extraArgs) ? "cmd.exe /c start msedge" : ("cmd.exe /c start msedge " + extraArgs), "");
                            } else {
                                resolvedTarget = appName;
                                proc = LaunchProcessOnDefaultDesktop(appName, extraArgs);
                            }

                            // Wait up to 3 seconds for window to appear
                            WindowEntry foundWin = null;
                            for (int attempts = 0; attempts < 15; attempts++) {
                                Thread.Sleep(200);
                                var wins = EnumerateWindowsInternal();
                                foreach (var w in wins) {
                                    if (w.ProcessName.Equals("cmd", StringComparison.OrdinalIgnoreCase) ||
                                        w.ProcessName.Equals("powershell", StringComparison.OrdinalIgnoreCase)) {
                                        continue;
                                    }
                                    if (!string.IsNullOrEmpty(ignoreHwndList)) {
                                        string hHex = string.Format("0x{0:x}", w.Hwnd).ToLowerInvariant();
                                        if (ignoreHwndList.Contains(hHex) || ignoreHwndList.Contains(w.Hwnd.ToString())) {
                                            continue;
                                        }
                                    }
                                    if ((proc != null && w.ProcessId == (uint)proc.Id) ||
                                        w.ProcessName.IndexOf(appName, StringComparison.OrdinalIgnoreCase) >= 0 ||
                                        w.Title.IndexOf(appName, StringComparison.OrdinalIgnoreCase) >= 0) {
                                        foundWin = w;
                                        break;
                                    }
                                }
                                if (foundWin != null) break;
                            }

                            if (proc == null && foundWin == null) {
                                runResult = string.Format("{{\"success\":false,\"error\":\"Application '{0}' not found or failed to start. Ensure the application is installed and available in system PATH or provide the full executable path.\"}}", EscapeJson(appName));
                                break;
                            }

                            if (foundWin != null) {
                                ForceForeground(new IntPtr(foundWin.Hwnd));
                            }

                            runResult = string.Format(
                                "{{\"success\":true,\"target\":\"{0}\",\"processId\":{1},\"window\":{2}}}",
                                EscapeJson(resolvedTarget),
                                proc != null ? proc.Id : (foundWin != null ? (int)foundWin.ProcessId : 0),
                                foundWin != null ? WindowToJson(foundWin) : "null"
                            );
                            break;
                        }

                        case "wait-for-window": {
                            if (args.Length < 2) {
                                runResult = "{\"success\":false,\"error\":\"Window title query required\"}";
                                break;
                            }
                            string query = args[1];
                            int timeoutSeconds = 6;
                            if (args.Length > 2) int.TryParse(args[2], out timeoutSeconds);
                            string ignoreHwndList = args.Length > 3 ? args[3].ToLowerInvariant() : "";

                            WindowEntry matched = null;
                            int totalMs = timeoutSeconds * 1000;
                            int waited = 0;
                            while (waited < totalMs) {
                                var wins = EnumerateWindowsInternal();
                                foreach (var w in wins) {
                                    if (!string.IsNullOrEmpty(ignoreHwndList)) {
                                        string hHex = string.Format("0x{0:x}", w.Hwnd).ToLowerInvariant();
                                        if (ignoreHwndList.Contains(hHex) || ignoreHwndList.Contains(w.Hwnd.ToString())) {
                                            continue;
                                        }
                                    }
                                    if (w.Title.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0 ||
                                        w.ProcessName.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0) {
                                        matched = w;
                                        break;
                                    }
                                }
                                if (matched != null) break;
                                Thread.Sleep(250);
                                waited += 250;
                            }

                            if (matched != null) {
                                runResult = string.Format("{{\"success\":true,\"window\":{0}}}", WindowToJson(matched));
                            } else {
                                runResult = string.Format("{{\"success\":false,\"error\":\"Timeout after {0}s waiting for window: {1}\"}}", timeoutSeconds, EscapeJson(query));
                            }
                            break;
                        }

                        case "click": {
                            int x = 0, y = 0;
                            if (args.Length > 2) {
                                int.TryParse(args[1], out x);
                                int.TryParse(args[2], out y);
                            }
                            Win32.SetCursorPos(x, y);
                            Thread.Sleep(50);
                            Win32.mouse_event(Win32.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                            Thread.Sleep(50);
                            Win32.mouse_event(Win32.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);

                            runResult = string.Format("{{\"success\":true,\"clicked\":{{\"x\":{0},\"y\":{1}}}}}", x, y);
                            break;
                        }

                        case "double-click": {
                            int x = 0, y = 0;
                            if (args.Length > 2) {
                                int.TryParse(args[1], out x);
                                int.TryParse(args[2], out y);
                            }
                            Win32.SetCursorPos(x, y);
                            Thread.Sleep(50);
                            Win32.mouse_event(Win32.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                            Win32.mouse_event(Win32.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                            Thread.Sleep(100);
                            Win32.mouse_event(Win32.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                            Win32.mouse_event(Win32.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);

                            runResult = string.Format("{{\"success\":true,\"doubleClicked\":{{\"x\":{0},\"y\":{1}}}}}", x, y);
                            break;
                        }

                        case "scroll": {
                            int delta = -120; // default down
                            if (args.Length > 1) int.TryParse(args[1], out delta);
                            Win32.mouse_event(Win32.MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
                            runResult = string.Format("{{\"success\":true,\"scrolled\":{0}}}", delta);
                            break;
                        }

                        case "capture-screen": {
                            string outPath = args.Length > 1 ? args[1] : Path.Combine(Path.GetTempPath(), "nexus_screen_" + DateTime.Now.Ticks + ".png");
                            string dir = Path.GetDirectoryName(outPath);
                            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) {
                                Directory.CreateDirectory(dir);
                            }

                            Rectangle bounds = Screen.PrimaryScreen.Bounds;
                            using (Bitmap bmp = new Bitmap(bounds.Width, bounds.Height)) {
                                using (Graphics g = Graphics.FromImage(bmp)) {
                                    g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                                }
                                bmp.Save(outPath, ImageFormat.Png);

                                string base64Data = "";
                                using (var ms = new MemoryStream()) {
                                    bmp.Save(ms, ImageFormat.Png);
                                    base64Data = Convert.ToBase64String(ms.ToArray());
                                }

                                runResult = string.Format(
                                    "{{\"success\":true,\"path\":\"{0}\",\"width\":{1},\"height\":{2},\"base64\":\"data:image/png;base64,{3}\"}}",
                                    EscapeJson(outPath),
                                    bounds.Width,
                                    bounds.Height,
                                    base64Data
                                );
                            }
                            break;
                        }

                        case "close-window": {
                            if (args.Length < 2) {
                                runResult = "{\"success\":false,\"error\":\"Target window query or HWND required\"}";
                                break;
                            }
                            string query = args[1];
                            IntPtr hWnd = ResolveWindowHandle(query);
                            if (hWnd == IntPtr.Zero) {
                                runResult = string.Format("{{\"success\":false,\"error\":\"Window '{0}' not found to close\"}}", EscapeJson(query));
                                break;
                            }

                            Win32.PostMessage(hWnd, Win32.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                            runResult = string.Format("{{\"success\":true,\"closed\":true,\"query\":\"{0}\"}}", EscapeJson(query));
                            break;
                        }

                        default:
                            runResult = string.Format("{{\"success\":false,\"error\":\"Unknown command: {0}\"}}", EscapeJson(cmd));
                            break;
                    }
                } catch (Exception ex) {
                    runResult = string.Format("{{\"success\":false,\"error\":\"{0}\"}}", EscapeJson(ex.Message));
                }
            });

            worker.SetApartmentState(ApartmentState.STA);
            worker.Start();
            worker.Join();

            Console.WriteLine(runResult != null ? runResult.ToString() : "{\"success\":false,\"error\":\"No response\"}");
        }
    }
}
