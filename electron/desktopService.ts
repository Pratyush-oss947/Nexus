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
  public async launchApp(appName: string, extraArgs = ''): Promise<DesktopActionResult<{ target: string; processId: number; window: WindowInfo | null }>> {
    const cleanApp = (appName || '').trim();
    if (!cleanApp) {
      return { success: false, error: 'Application name or command is required.' };
    }

    const res = await this.runHelper<{ target: string; processId: number; window: WindowInfo | null }>(
      ['launch-app', cleanApp, extraArgs],
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
  public async waitForWindow(titleQuery: string, timeoutSeconds = 6): Promise<DesktopActionResult<WindowInfo>> {
    const res = await this.runHelper<{ window: WindowInfo }>(['wait-for-window', titleQuery, String(timeoutSeconds)], (timeoutSeconds + 2) * 1000);
    if (res.success && res.data) {
      return { success: true, data: res.data.window };
    }
    return { success: false, error: res.error || `Timeout waiting for window: ${titleQuery}` };
  }

  /**
   * Types text into the active foreground window, optionally focusing a target window first.
   */
  public async typeText(text: string, targetWindow?: string): Promise<DesktopActionResult<{ typed: string }>> {
    if (typeof text !== 'string') {
      return { success: false, error: 'Text string is required.' };
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
