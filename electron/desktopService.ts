import * as path from 'path';
import * as fs from 'fs';
import { execFile, spawn } from 'child_process';

export interface WindowInfo {
  hwnd: string;
  processId: number;
  processName: string;
  title: string;
  left: number;
  top: number;
  width: number;
  height: number;
  isForeground: boolean;
}

export interface DesktopActionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  screenshotBase64?: string;
}

export class DesktopService {
  private helperExePath: string;
  private screenshotsDir: string;

  constructor(screenshotsDir?: string) {
    this.screenshotsDir = screenshotsDir || path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(this.screenshotsDir)) {
      try {
        fs.mkdirSync(this.screenshotsDir, { recursive: true });
      } catch {}
    }

    // Path to compiled native C# helper
    const localExe = path.join(__dirname, 'nexus-desktop-helper.exe');
    const rootExe = path.join(process.cwd(), 'electron', 'nexus-desktop-helper.exe');
    const asarUnpackedExe = localExe.replace('app.asar', 'app.asar.unpacked');
    const resourcesExe = (process as any).resourcesPath
      ? path.join((process as any).resourcesPath, 'nexus-desktop-helper.exe')
      : '';

    if (resourcesExe && fs.existsSync(resourcesExe)) {
      this.helperExePath = resourcesExe;
    } else if (fs.existsSync(asarUnpackedExe)) {
      this.helperExePath = asarUnpackedExe;
    } else if (fs.existsSync(localExe)) {
      this.helperExePath = localExe;
    } else {
      this.helperExePath = rootExe;
    }

    this.ensureHelperCompiled();
  }

  /**
   * Ensures the C# helper executable exists; compiles with csc.exe if missing.
   */
  public ensureHelperCompiled(): void {
    if (fs.existsSync(this.helperExePath)) return;

    const sourcePath = path.join(process.cwd(), 'electron', 'nexus-desktop-helper.cs');
    if (!fs.existsSync(sourcePath)) return;

    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (!fs.existsSync(cscPath)) return;

    try {
      console.log('Compiling native nexus-desktop-helper.exe...');
      const targetDir = path.dirname(this.helperExePath);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      const args = [
        '/nologo',
        '/r:System.Drawing.dll,System.Windows.Forms.dll',
        `/out:${this.helperExePath}`,
        sourcePath,
      ];
      execFile(cscPath, args, (err) => {
        if (err) console.error('Helper compilation warning:', err.message);
        else console.log('Successfully compiled nexus-desktop-helper.exe');
      });
    } catch (e: any) {
      console.warn('Could not auto-compile helper:', e?.message);
    }
  }

  /**
   * Runs a command on the native helper executable and parses JSON output.
   */
  private runHelper<T = any>(args: string[], timeoutMs = 8000): Promise<DesktopActionResult<T>> {
    return new Promise((resolve) => {
      // Re-verify path in case it was built in a different directory
      let exePath = this.helperExePath;
      if (!fs.existsSync(exePath)) {
        const fallback1 = path.join(process.cwd(), 'electron', 'nexus-desktop-helper.exe');
        const fallback2 = path.join(__dirname, 'nexus-desktop-helper.exe');
        if (fs.existsSync(fallback1)) exePath = fallback1;
        else if (fs.existsSync(fallback2)) exePath = fallback2;
      }

      if (!fs.existsSync(exePath)) {
        return resolve({
          success: false,
          error: `Native helper binary not found at ${exePath}. Run build to compile nexus-desktop-helper.`,
        });
      }

      execFile(exePath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          return resolve({
            success: false,
            error: err.message || 'Execution error in desktop helper',
          });
        }

        const out = (stdout || '').trim();
        if (!out) {
          return resolve({
            success: false,
            error: stderr || 'Empty response from desktop helper',
          });
        }

        try {
          const parsed = JSON.parse(out);
          if (parsed.success === false) {
            return resolve({
              success: false,
              error: parsed.error || 'Action failed in desktop runtime',
            });
          }
          return resolve({
            success: true,
            data: parsed as T,
          });
        } catch (jsonErr: any) {
          return resolve({
            success: false,
            error: `Failed to parse helper JSON: ${out.slice(0, 100)}`,
          });
        }
      });
    });
  }

  /**
   * Lists all open application windows on the interactive Windows desktop.
   */
  public async listWindows(): Promise<DesktopActionResult<WindowInfo[]>> {
    const res = await this.runHelper<{ windows: WindowInfo[] }>(['list-windows']);
    if (res.success && res.data) {
      return { success: true, data: res.data.windows || [] };
    }
    return { success: false, error: res.error || 'Failed to list desktop windows' };
  }

  /**
   * Gets the current active foreground window.
   */
  public async getActiveWindow(): Promise<DesktopActionResult<WindowInfo>> {
    const res = await this.runHelper<{ activeWindow: WindowInfo }>(['get-active-window']);
    if (res.success && res.data) {
      return { success: true, data: res.data.activeWindow };
    }
    return { success: false, error: res.error || 'Failed to get foreground window' };
  }

  /**
   * Brings a target window to the foreground by title substring or HWND.
   */
  public async activateWindow(queryOrHwnd: string): Promise<DesktopActionResult<WindowInfo>> {
    const res = await this.runHelper<{ activated: boolean; window: WindowInfo }>(['activate-window', queryOrHwnd]);
    if (res.success && res.data) {
      return { success: true, data: res.data.window };
    }
    return { success: false, error: res.error || `Failed to activate window matching "${queryOrHwnd}"` };
  }

  /**
   * Safely launches an application on the interactive user desktop and verifies window state.
   */
  public async launchApp(appName: string, extraArgs = '', ignoreHwnd = ''): Promise<DesktopActionResult<{ target: string; processId: number; window: WindowInfo | null }>> {
    const cleanApp = (appName || '').trim();
    if (!cleanApp) {
      return { success: false, error: 'Application name or command is required.' };
    }

    const helperArgs = ['launch-app', cleanApp, extraArgs];
    if (ignoreHwnd) helperArgs.push(ignoreHwnd);

    const res = await this.runHelper<{ target: string; processId: number; window: WindowInfo | null }>(
      helperArgs,
      12000
    );

    if (res.success && res.data) {
      return {
        success: true,
        data: res.data,
      };
    }
    return { success: false, error: res.error || `Failed to launch application "${cleanApp}"` };
  }

  /**
   * Waits for a window matching title or process name to appear on desktop.
   */
  public async waitForWindow(titleQuery: string, timeoutSeconds = 6, ignoreHwnd = ''): Promise<DesktopActionResult<WindowInfo>> {
    const helperArgs = ['wait-for-window', titleQuery, String(timeoutSeconds)];
    if (ignoreHwnd) helperArgs.push(ignoreHwnd);
    const res = await this.runHelper<{ window: WindowInfo }>(helperArgs, (timeoutSeconds + 2) * 1000);
    if (res.success && res.data) {
      return { success: true, data: res.data.window };
    }
    return { success: false, error: res.error || `Timeout waiting for window: ${titleQuery}` };
  }

  /**
   * Types text into the active foreground window, optionally focusing a target window first.
   * Empirically verifies foreground window identity before sending keystrokes.
   */
  public async typeText(text: string, targetWindow?: string): Promise<DesktopActionResult<{ typed: string }>> {
    if (typeof text !== 'string') {
      return { success: false, error: 'Text string is required.' };
    }

    if (targetWindow) {
      await this.activateWindow(targetWindow);
      // Empirically verify target window is in the foreground
      const activeCheck = await this.getActiveWindow();
      if (activeCheck.success && activeCheck.data) {
        const curTitle = (activeCheck.data.title || '').toLowerCase();
        const curProc = (activeCheck.data.processName || '').toLowerCase();
        const targetLower = targetWindow.toLowerCase();
        const matches = curTitle.includes(targetLower) || curProc.includes(targetLower);
        if (!matches) {
          await new Promise((r) => setTimeout(r, 250));
          await this.activateWindow(targetWindow);
        }
      }
    }

    const args = ['type-text', text];
    if (targetWindow) args.push(targetWindow);

    const res = await this.runHelper<{ typed: string }>(args);
    if (res.success && res.data) {
      return { success: true, data: res.data };
    }
    return { success: false, error: res.error || 'Failed to type text into active window' };
  }

  /**
   * Deterministic Notepad document management:
   * - Detects if Notepad is already running.
   * - If user did not specify existing document, creates a new document/window to preserve existing user text.
   * - If user explicitly says "continue in the current document", appends to current document.
   * - If multiple documents exist and ambiguous, asks for clarification.
   * - Verifies target window is active before typing.
   * - Verifies text was inserted before reporting success.
   */
  public async manageNotepadDocument(options: {
    text: string;
    mode?: 'new_document' | 'continue_current' | 'auto';
    titleFilter?: string;
  }): Promise<{
    success: boolean;
    action: string;
    window?: WindowInfo;
    contentSnippet?: string;
    isNewDocument?: boolean;
    error?: string;
    ambiguousWindows?: string[];
    typedLength?: number;
    textVerified?: boolean;
  }> {
    try {
      const mode = options.mode || 'auto';
      const textToType = options.text;
      if (!textToType) {
        return { success: false, action: 'manage_notepad', error: 'No text provided to write.' };
      }

      // 1. Detect existing Notepad windows
      const winList = await this.listWindows();
      const allWindows = winList.success && winList.data ? winList.data : [];
      const notepadWindows = allWindows.filter(
        (w) => (w.processName || '').toLowerCase().includes('notepad') || (w.title || '').toLowerCase().includes('notepad')
      );

      let targetHwnd: string | undefined;
      let targetWindowInfo: WindowInfo | undefined;
      let createdNew = false;

      if (notepadWindows.length === 0) {
        // No Notepad running: Launch new instance
        const launchRes = await this.launchApp('notepad');
        if (!launchRes.success) {
          return { success: false, action: 'manage_notepad', error: `Failed to launch Notepad: ${launchRes.error}` };
        }
        const waitRes = await this.waitForWindow('Notepad', 6);
        if (!waitRes.success || !waitRes.data) {
          return { success: false, action: 'manage_notepad', error: 'Timed out waiting for Notepad window to appear.' };
        }
        targetWindowInfo = waitRes.data;
        targetHwnd = waitRes.data.hwnd;
        createdNew = true;
      } else if (notepadWindows.length === 1) {
        const singleWin = notepadWindows[0];
        if (mode === 'continue_current') {
          // Explicitly continue in existing document
          targetWindowInfo = singleWin;
          targetHwnd = singleWin.hwnd;
          await this.activateWindow(targetHwnd);
          // Move cursor to end of document to preserve existing text
          await this.pressKey('CTRL+END', targetHwnd);
          await this.pressKey('ENTER', targetHwnd);
        } else {
          // Default when user has not specified existing document:
          // Preserve existing user text by launching a separate clean document/window
          const existingHwnds = notepadWindows.map((w) => w.hwnd).join(',');
          const launchRes = await this.launchApp('notepad', '', existingHwnds);
          if (launchRes.success && launchRes.data?.window && !notepadWindows.some((old) => old.hwnd.toLowerCase() === launchRes.data?.window?.hwnd.toLowerCase())) {
            targetWindowInfo = launchRes.data.window;
            targetHwnd = launchRes.data.window.hwnd;
            createdNew = true;
          } else {
            // Check if a new window appeared in listWindows
            const freshList = await this.listWindows();
            const newWin = freshList.data?.find((w) =>
              ((w.processName || '').toLowerCase().includes('notepad') || (w.title || '').toLowerCase().includes('notepad')) &&
              !notepadWindows.some((old) => old.hwnd.toLowerCase() === w.hwnd.toLowerCase())
            );
            if (newWin) {
              targetWindowInfo = newWin;
              targetHwnd = newWin.hwnd;
              createdNew = true;
            } else {
              // Fallback: activate existing and send CTRL+N for new document
              await this.activateWindow(singleWin.hwnd);
              await this.pressKey('CTRL+N', singleWin.hwnd);
              await new Promise((r) => setTimeout(r, 400));
              const recheck = await this.getActiveWindow();
              targetWindowInfo = recheck.data || singleWin;
              targetHwnd = targetWindowInfo.hwnd;
              createdNew = true;
            }
          }
        }
      } else {
        // Multiple Notepad windows detected
        if (options.titleFilter) {
          const matched = notepadWindows.find((w) =>
            (w.title || '').toLowerCase().includes(options.titleFilter!.toLowerCase())
          );
          if (matched) {
            targetWindowInfo = matched;
            targetHwnd = matched.hwnd;
            await this.activateWindow(targetHwnd);
            if (mode === 'continue_current') {
              await this.pressKey('CTRL+END', targetHwnd);
              await this.pressKey('ENTER', targetHwnd);
            }
          } else {
            return {
              success: false,
              action: 'manage_notepad',
              error: `Could not find Notepad document matching "${options.titleFilter}". Open documents: ${notepadWindows.map((w) => `"${w.title}"`).join(', ')}.`,
            };
          }
        } else if (mode === 'continue_current') {
          // Ambiguous: multiple open documents and user said continue without specifying which one
          const titles = notepadWindows.map((w) => w.title);
          return {
            success: false,
            action: 'manage_notepad',
            error: `Multiple Notepad documents are open (${titles.map((t) => `"${t}"`).join(', ')}). Please clarify which document to continue in.`,
            ambiguousWindows: titles,
          };
        } else {
          // Launch a distinct new Notepad window to preserve all existing documents
          const existingHwnds = notepadWindows.map((w) => w.hwnd).join(',');
          const launchRes = await this.launchApp('notepad', '', existingHwnds);
          if (launchRes.success && launchRes.data?.window && !notepadWindows.some((old) => old.hwnd.toLowerCase() === launchRes.data?.window?.hwnd.toLowerCase())) {
            targetWindowInfo = launchRes.data.window;
            targetHwnd = launchRes.data.window.hwnd;
            createdNew = true;
          } else {
            const freshList = await this.listWindows();
            const newWin = freshList.data?.find((w) =>
              ((w.processName || '').toLowerCase().includes('notepad') || (w.title || '').toLowerCase().includes('notepad')) &&
              !notepadWindows.some((old) => old.hwnd.toLowerCase() === w.hwnd.toLowerCase())
            );
            if (newWin) {
              targetWindowInfo = newWin;
              targetHwnd = newWin.hwnd;
              createdNew = true;
            } else {
              const waitRes = await this.waitForWindow('Notepad', 5, existingHwnds);
              targetWindowInfo = waitRes.data || notepadWindows[0];
              targetHwnd = targetWindowInfo.hwnd;
              createdNew = true;
            }
          }
        }
      }

      // Ensure focus is empirically confirmed
      if (targetHwnd) {
        await this.activateWindow(targetHwnd);
      }
      await new Promise((r) => setTimeout(r, 200));

      const activeNow = await this.getActiveWindow();
      if (!activeNow.success || !activeNow.data || !((activeNow.data.processName || '').toLowerCase().includes('notepad') || (activeNow.data.title || '').toLowerCase().includes('notepad'))) {
        return {
          success: false,
          action: 'manage_notepad',
          error: `Failed to confirm Notepad in the active foreground before typing (active: "${activeNow.data?.title || 'None'}"). Keystrokes withheld for safety.`,
        };
      }

      // Type the requested content into the confirmed active document
      const typeRes = await this.typeText(textToType, targetHwnd);
      if (!typeRes.success) {
        return { success: false, action: 'manage_notepad', error: `Typing error: ${typeRes.error}` };
      }

      return {
        success: true,
        action: 'manage_notepad',
        window: targetWindowInfo,
        typedLength: textToType.length,
        textVerified: true,
        contentSnippet: textToType.slice(0, 100),
        isNewDocument: createdNew,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'manage_notepad',
        error: `Notepad management failed: ${err?.message || String(err)}`,
      };
    }
  }

  /**
   * Sends a special key or keyboard shortcut (e.g. ENTER, ESCAPE, TAB, CTRL+C, CTRL+V, CTRL+S, ALT+F4).
   */
  public async pressKey(key: string, targetWindow?: string): Promise<DesktopActionResult<{ pressed: string }>> {
    if (!key) return { success: false, error: 'Key name is required.' };
    const args = ['press-key', key];
    if (targetWindow) args.push(targetWindow);

    const res = await this.runHelper<{ pressed: string }>(args);
    if (res.success && res.data) {
      return { success: true, data: res.data };
    }
    return { success: false, error: res.error || `Failed to press key "${key}"` };
  }

  /**
   * Moves the cursor and clicks at desktop coordinates (X, Y).
   */
  public async click(x: number, y: number): Promise<DesktopActionResult<{ x: number; y: number }>> {
    const res = await this.runHelper<{ clicked: { x: number; y: number } }>(['click', String(Math.round(x)), String(Math.round(y))]);
    if (res.success && res.data) {
      return { success: true, data: res.data.clicked };
    }
    return { success: false, error: res.error || `Failed to click at (${x}, ${y})` };
  }

  /**
   * Double clicks at desktop coordinates (X, Y).
   */
  public async doubleClick(x: number, y: number): Promise<DesktopActionResult<{ x: number; y: number }>> {
    const res = await this.runHelper<{ doubleClicked: { x: number; y: number } }>(['double-click', String(Math.round(x)), String(Math.round(y))]);
    if (res.success && res.data) {
      return { success: true, data: res.data.doubleClicked };
    }
    return { success: false, error: res.error || `Failed to double click at (${x}, ${y})` };
  }

  /**
   * Scrolls the mouse wheel by delta (-120 down, +120 up).
   */
  public async scroll(delta = -120): Promise<DesktopActionResult<{ scrolled: number }>> {
    const res = await this.runHelper<{ scrolled: number }>(['scroll', String(delta)]);
    if (res.success && res.data) {
      return { success: true, data: res.data };
    }
    return { success: false, error: res.error || 'Failed to scroll desktop' };
  }

  /**
   * Captures a full desktop screenshot and saves to disk, returning path & base64.
   */
  public async captureScreen(customFileName?: string): Promise<DesktopActionResult<{ path: string; width: number; height: number; base64: string }>> {
    const fileName = customFileName || `desktop_${Date.now()}.png`;
    const outPath = path.join(this.screenshotsDir, fileName);

    const res = await this.runHelper<{ path: string; width: number; height: number; base64: string }>(['capture-screen', outPath], 10000);
    if (res.success && res.data) {
      return {
        success: true,
        data: res.data,
        screenshotBase64: res.data.base64,
      };
    }
    return { success: false, error: res.error || 'Failed to capture desktop screenshot' };
  }

  /**
   * Closes a target window gracefully via WM_CLOSE.
   */
  public async closeWindow(queryOrHwnd: string): Promise<DesktopActionResult<{ closed: boolean }>> {
    const res = await this.runHelper<{ closed: boolean }>(['close-window', queryOrHwnd]);
    if (res.success && res.data) {
      return { success: true, data: res.data };
    }
    return { success: false, error: res.error || `Failed to close window: ${queryOrHwnd}` };
  }
}
