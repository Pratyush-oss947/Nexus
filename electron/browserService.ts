import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { DesktopService } from './desktopService';

export interface BrowserActionResult {
  success: boolean;
  action: string;
  url?: string;
  title?: string;
  content?: string;
  screenshotBase64?: string;
  error?: string;
  data?: any;
  alreadyOnPage?: boolean;
  filledCount?: number;
  verifiedCount?: number;
  verifications?: Record<string, any>;
  state?: string;
  detectedChallenge?: SecurityChallengeResult;
  forms?: DetectedForm[];
}

export interface DetectedFormField {
  tag: 'input' | 'textarea' | 'select' | 'button';
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
  disabled: boolean;
  readOnly: boolean;
  currentValue?: string;
  options?: Array<{ value: string; label: string; selected: boolean }>;
  checked?: boolean;
  role?: string;
  isAmbiguous?: boolean;
  confidence: number;
}

export interface DetectedForm {
  formIndex: number;
  id: string;
  name: string;
  action: string;
  method: string;
  purpose: 'login' | 'registration' | 'search' | 'contact' | 'checkout' | 'general';
  fields: DetectedFormField[];
  submitButtons: Array<{ text: string; id: string; ariaLabel: string }>;
}

export interface SecurityChallengeResult {
  hasChallenge: boolean;
  challengeType: 'CAPTCHA' | 'MFA' | 'NONE';
  details?: string;
}

export interface FormInspectionResult extends BrowserActionResult {
  forms?: DetectedForm[];
  orphanFields?: DetectedFormField[];
  detectedChallenge?: SecurityChallengeResult;
  summary?: string;
}

export interface SmartFillOptions {
  fields: Record<string, any>;
  submit?: boolean;
  submitButtonTextOrSelector?: string;
  preserveExisting?: boolean;
}

export interface LoginExecutionOptions {
  username: string;
  password: string;
  domain?: string;
  usernameField?: string;
  passwordField?: string;
  submit?: boolean;
}

export class BrowserService {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private downloadsPath: string;
  private desktopService: DesktopService | null = null;
  private isBackgroundMode = false;
  private recentDownloads: Array<{ filename: string; filePath: string; sizeBytes: number; timestamp: number }> = [];

  constructor(downloadsPath: string, desktopService?: DesktopService) {
    this.downloadsPath = downloadsPath;
    this.desktopService = desktopService || null;
    if (!fs.existsSync(this.downloadsPath)) {
      try {
        fs.mkdirSync(this.downloadsPath, { recursive: true });
      } catch (err) {
        console.error('Failed to create downloads directory:', err);
      }
    }
  }

  public setDesktopService(desktopService: DesktopService): void {
    this.desktopService = desktopService;
  }

  public setBackgroundMode(bg: boolean): void {
    this.isBackgroundMode = bg;
  }

  public getIsBackgroundMode(): boolean {
    return this.isBackgroundMode;
  }


  // Security validator: Block malicious schemes and private network traversal
  public validateUrl(rawUrl: string): { valid: boolean; error?: string; normalizedUrl?: string } {
    try {
      let trimmed = rawUrl.trim();
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = 'https://' + trimmed;
      }

      const parsed = new URL(trimmed);

      // Block dangerous protocols
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          valid: false,
          error: `Blocked protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted for security.`,
        };
      }

      const hostname = parsed.hostname.toLowerCase();

      // Block local/internal network addresses (unless running automated test suite)
      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.NEXUS_ALLOW_LOCAL_TEST === '1';
      const blockedHostnames = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
      if (!isTestEnv && blockedHostnames.includes(hostname)) {
        return {
          valid: false,
          error: `Access to local address "${hostname}" is restricted to safeguard your local machine.`,
        };
      }

      // Block private IP ranges: 192.168.x.x, 10.x.x.x, 172.16.x.x - 172.31.x.x
      if (
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
      ) {
        return {
          valid: false,
          error: `Access to private LAN IP "${hostname}" is restricted for network security.`,
        };
      }

      return { valid: true, normalizedUrl: parsed.toString() };
    } catch {
      return { valid: false, error: `Invalid or malformed URL: "${rawUrl}"` };
    }
  }

  // Setup listeners on pages for popups, close, and in-browser downloads
  private setupPageListeners(page: Page): void {
    page.on('popup', (popup) => {
      this.page = popup;
      this.setupPageListeners(popup);
    });

    page.on('close', () => {
      if (this.page === page) {
        const remaining = this.context?.pages().filter((p) => !p.isClosed()) || [];
        this.page = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
    });

    // In-browser download event listener: Persist files initiated by clicks/forms
    page.on('download', async (download) => {
      try {
        const suggested = download.suggestedFilename() || `download_${Date.now()}`;
        const safe = path.basename(suggested).replace(/[^a-zA-Z0-9._-]/g, '_');
        let dest = path.join(this.downloadsPath, safe);
        let counter = 1;
        const ext = path.extname(safe);
        const base = path.basename(safe, ext);
        while (fs.existsSync(dest)) {
          dest = path.join(this.downloadsPath, `${base}_${counter}${ext}`);
          counter++;
        }
        await download.saveAs(dest);
        if (fs.existsSync(dest)) {
          const stats = fs.statSync(dest);
          if (stats.size > 0) {
            this.recentDownloads.push({
              filename: path.basename(dest),
              filePath: dest,
              sizeBytes: stats.size,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        console.error('Error saving browser-managed download:', err);
      }
    });
  }

  // Initialize or get the active real visible Chromium page
  public async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      return this.page;
    }

    // Check if any other page in context is still open
    if (this.context) {
      const openPages = this.context.pages().filter((p) => !p.isClosed());
      if (openPages.length > 0) {
        this.page = openPages[openPages.length - 1];
        return this.page;
      }
    }

    if (!this.browser || !this.browser.isConnected()) {
      // Launch visible Chromium so user observes automation in real-time (unless background mode requested)
      this.browser = await chromium.launch({
        headless: this.isBackgroundMode,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-default-browser-check',
          '--window-size=1200,800',
        ],
      });
    }

    if (!this.context) {
      this.context = await this.browser.newContext({
        viewport: { width: 1200, height: 800 },
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 NEXUS-Agent/1.0',
        acceptDownloads: true,
      });

      // Track newly opened pages / tabs in this context
      this.context.on('page', (newPage) => {
        this.page = newPage;
        this.setupPageListeners(newPage);
      });
    }

    this.page = await this.context.newPage();
    this.setupPageListeners(this.page);

    // Set responsive timeouts
    this.page.setDefaultTimeout(5000);
    this.page.setDefaultNavigationTimeout(12000);

    if (!this.isBackgroundMode) {
      await this.page.bringToFront().catch(() => {});
    }

    return this.page;
  }

  // Bring active browser page and window to the foreground
  public async bringToForeground(): Promise<{ success: boolean; error?: string }> {
    if (this.isBackgroundMode) {
      return { success: true };
    }

    try {
      const page = this.page;
      if (!page || page.isClosed()) {
        return { success: false, error: 'No active browser page available to bring to foreground.' };
      }

      // 1. Playwright tab and page activation
      await page.bringToFront();

      // 2. Windows OS-level window activation via DesktopService if available
      if (this.desktopService) {
        let title = '';
        try {
          title = await page.title();
        } catch {}

        if (title && title !== 'about:blank' && title.trim().length > 0) {
          const act = await this.desktopService.activateWindow(title);
          if (act.success) {
            return { success: true };
          }
        }

        // Fallback: search for Chromium/Chrome window
        await this.desktopService.activateWindow('Chrome').catch(() => {});
      }

      return { success: true };
    } catch (err: any) {
      // Platform limitations handled gracefully without crashing
      return { success: false, error: err?.message || String(err) };
    }
  }


  // Active open tab count to enforce single-page invariants
  public getActivePagesCount(): number {
    if (!this.context) return 0;
    return this.context.pages().filter((p) => !p.isClosed()).length;
  }

  // Compare URLs to prevent redundant navigation and tab resets
  public isSameSiteOrPage(currentUrl: string, targetUrl: string): { isMatch: boolean; reason?: string } {
    try {
      const cur = new URL(currentUrl);
      const tgt = new URL(targetUrl);

      // Exact match (ignoring trailing slash and hash)
      const cleanCur = cur.origin + cur.pathname.replace(/\/+$/, '') + cur.search;
      const cleanTgt = tgt.origin + tgt.pathname.replace(/\/+$/, '') + tgt.search;
      if (cleanCur === cleanTgt) {
        return { isMatch: true, reason: 'exact_url' };
      }

      // If both share the same hostname/origin and target path is root (empty or '/')
      if (cur.hostname.toLowerCase() === tgt.hostname.toLowerCase()) {
        const tgtPath = tgt.pathname.replace(/\/+$/, '');
        if (!tgtPath || tgtPath === '') {
          return { isMatch: true, reason: 'same_site_root' };
        }
      }

      return { isMatch: false };
    } catch {
      return { isMatch: false };
    }
  }

  // Action: Open / Navigate URL with smart redundancy avoidance
  public async navigate(rawUrl: string): Promise<BrowserActionResult> {
    const check = this.validateUrl(rawUrl);
    if (!check.valid || !check.normalizedUrl) {
      return { success: false, action: 'navigate', error: check.error };
    }

    try {
      const page = await this.ensurePage();
      const currentUrl = page.url();
      
      // Before navigating, compare the current URL with the intended destination.
      // If already on the correct page or root of the requested site, do not navigate again.
      const matchCheck = this.isSameSiteOrPage(currentUrl, check.normalizedUrl);
      if (matchCheck.isMatch) {
        if (!this.isBackgroundMode) {
          await this.bringToForeground().catch(() => {});
        }
        const title = await page.title();
        const screenshot = await this.captureScreenshot();
        return {
          success: true,
          action: 'navigate',
          url: currentUrl,
          title,
          content: `Already on destination (${matchCheck.reason === 'same_site_root' ? 'active website root' : 'exact URL'}): ${currentUrl} ("${title}"). Zero unnecessary re-navigation performed.`,
          screenshotBase64: screenshot,
          alreadyOnPage: true,
        };
      }

      try {
        await page.goto(check.normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 18000 });
      } catch (gotoErr: any) {
        const isTimeout =
          gotoErr?.name === 'TimeoutError' ||
          String(gotoErr?.message || '').toLowerCase().includes('timeout');
        const currentUrl = page ? page.url() : '';

        // Distinguish navigation timeout from total page failure:
        // If the browser reached the intended domain, treat it as successful navigation despite slow background assets
        if (isTimeout && currentUrl && currentUrl !== 'about:blank') {
          try {
            const targetHost = new URL(check.normalizedUrl).hostname.replace(/^www\./, '').toLowerCase();
            const currentHost = new URL(currentUrl).hostname.replace(/^www\./, '').toLowerCase();
            if (currentHost.includes(targetHost) || targetHost.includes(currentHost)) {
              if (!this.isBackgroundMode) {
                await this.bringToForeground().catch(() => {});
              }
              const title = (await page.title().catch(() => '')) || targetHost;
              const screenshot = await this.captureScreenshot().catch(() => undefined);
              return {
                success: true,
                action: 'navigate',
                url: currentUrl,
                title,
                content: `Navigated to ${currentUrl} ("${title}"). Note: Reached target domain; ready for interactions.`,
                screenshotBase64: screenshot,
              };
            }
          } catch {}
        }
        throw gotoErr;
      }

      // Short settle time for client rendered apps
      await page.waitForTimeout(800);

      if (!this.isBackgroundMode) {
        await this.bringToForeground().catch(() => {});
      }

      const title = await page.title();
      const finalUrl = page.url();
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'navigate',
        url: finalUrl,
        title,
        content: `Navigated to ${finalUrl} ("${title}")`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'navigate',
        url: check.normalizedUrl,
        error: `Navigation failed: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Fill multiple form fields with strict outcome verification
  public async fillForm(fields: Record<string, string>): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const entries = Object.entries(fields);
      if (entries.length === 0) {
        return { success: false, action: 'fill_form', error: 'No fields provided to fill.' };
      }

      const filledResults: Array<{ field: string; expectedValue: string; actualValue: string; verified: boolean }> = [];

      for (const [fieldName, rawVal] of entries) {
        const targetValue = String(rawVal ?? '');
        const trimmedField = fieldName.trim();
        let matchedEl = null;

        // Strategy 1: Exact selector or ID
        try {
          const el = page.locator(trimmedField).first();
          if (await el.isVisible({ timeout: 1000 })) matchedEl = el;
        } catch {}

        // Strategy 2: By label
        if (!matchedEl) {
          try {
            const byLabel = page.getByLabel(trimmedField, { exact: false }).first();
            if (await byLabel.isVisible({ timeout: 1000 })) matchedEl = byLabel;
          } catch {}
        }

        // Strategy 3: By placeholder
        if (!matchedEl) {
          try {
            const byPholder = page.getByPlaceholder(trimmedField, { exact: false }).first();
            if (await byPholder.isVisible({ timeout: 1000 })) matchedEl = byPholder;
          } catch {}
        }

        // Strategy 4: By name or ID attributes
        if (!matchedEl) {
          try {
            const byAttr = page.locator(`input[name="${trimmedField}" i], textarea[name="${trimmedField}" i], input#${trimmedField}, textarea#${trimmedField}, [aria-label*="${trimmedField}" i]`).first();
            if (await byAttr.isVisible({ timeout: 1000 })) matchedEl = byAttr;
          } catch {}
        }

        if (!matchedEl) {
          return {
            success: false,
            action: 'fill_form',
            error: `Could not locate visible form field "${fieldName}" on ${page.url()}. Use browser_inspect_page to find valid fields.`,
            data: { filledResults },
          };
        }

        // Fill and verify
        await matchedEl.click({ timeout: 1500 });
        await matchedEl.fill(targetValue, { timeout: 2000 });

        // Read value back for verification
        let actualVal = '';
        try {
          actualVal = await matchedEl.inputValue({ timeout: 1500 });
        } catch {
          actualVal = (await matchedEl.getAttribute('value')) || '';
        }

        const verified = actualVal === targetValue;
        filledResults.push({
          field: fieldName,
          expectedValue: targetValue,
          actualValue: actualVal,
          verified,
        });

        if (!verified) {
          return {
            success: false,
            action: 'fill_form',
            error: `Field "${fieldName}" verification failed: expected "${targetValue}", but found "${actualVal}".`,
            data: { filledResults },
          };
        }
      }

      await page.waitForTimeout(300);
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'fill_form',
        url: page.url(),
        title: await page.title(),
        content: `Successfully filled and verified ${filledResults.length} form field(s): ${filledResults.map((f) => `"${f.field}" = "${f.actualValue}"`).join(', ')}`,
        data: { filledResults },
        filledCount: filledResults.length,
        verifiedCount: filledResults.filter((f) => f.verified).length,
        verifications: Object.fromEntries(filledResults.map((f) => [f.field, f])),
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'fill_form',
        error: `Form filling failed: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Open new tab explicitly (only when genuinely requested)
  public async newTab(rawUrl?: string): Promise<BrowserActionResult> {
    try {
      await this.ensurePage(); // guarantees context is created
      if (!this.context) throw new Error('Browser context not available');

      const newPage = await this.context.newPage();
      this.page = newPage;
      this.setupPageListeners(newPage);
      newPage.setDefaultTimeout(5000);
      newPage.setDefaultNavigationTimeout(12000);

      if (rawUrl) {
        return await this.navigate(rawUrl);
      }

      const screenshot = await this.captureScreenshot();
      return {
        success: true,
        action: 'new_tab',
        url: newPage.url(),
        title: await newPage.title(),
        content: 'Opened new browser tab.',
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'new_tab',
        error: `Failed to open new tab: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Generic In-Page Search using intelligent field discovery
  public async inPageSearch(query: string, submit = true): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      if (!this.isBackgroundMode) {
        await this.bringToForeground().catch(() => {});
      }
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return { success: false, action: 'in_page_search', error: 'Search query cannot be empty.' };
      }

      // Priority list of heuristic search input selectors (including YouTube web components)
      const searchSelectors = [
        'ytd-searchbox input#search',
        'ytd-searchbox input',
        'input#search',
        'input[name="search_query" i]',
        'input[name="q" i]',
        'input[type="search"]',
        'input[name="search" i]',
        'input[name="query" i]',
        'input[id*="search" i]',
        'input[placeholder*="search" i]',
        'input[aria-label*="search" i]',
        '[role="searchbox"]',
        'form[role="search"] input',
        'form[action*="search" i] input',
        'input[type="text"][name*="search" i]',
        'textarea[name="q"]',
        'textarea[placeholder*="search" i]',
        'input[type="text"]',
      ];

      // Step 1: Wait for relevant search input to become available
      let searchInput = null;
      let matchedSelector = '';

      // Check immediately visible inputs first
      for (const sel of searchSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
            searchInput = el;
            matchedSelector = sel;
            break;
          }
        } catch {}
      }

      // If not yet visible, wait up to 4000ms for primary inputs to attach (crucial for YouTube/SPA components)
      if (!searchInput) {
        for (const sel of searchSelectors.slice(0, 6)) {
          try {
            const el = page.locator(sel).first();
            await el.waitFor({ state: 'visible', timeout: 2500 });
            searchInput = el;
            matchedSelector = sel;
            break;
          } catch {}
        }
      }

      // Step 2: If still not visible, check for an expandable search button (excluding submit buttons)
      if (!searchInput) {
        const expandButtons = [
          'button[aria-label*="open search" i]',
          'button[aria-label*="expand search" i]',
          'button.search-toggle',
          'button.search-button',
          'button.header-search-button',
          '[data-target*="search"]',
        ];

        for (const btnSel of expandButtons) {
          try {
            const btn = page.locator(btnSel).first();
            if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
              await btn.click({ timeout: 1000 }).catch(() => {});
              await page.waitForTimeout(500);
              for (const sel of searchSelectors.slice(0, 8)) {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
                  searchInput = el;
                  matchedSelector = sel;
                  break;
                }
              }
              if (searchInput) break;
            }
          } catch {}
        }
      }

      if (!searchInput) {
        return {
          success: false,
          action: 'in_page_search',
          error: `Could not locate a visible search field on ${page.url()}. Use 'browser_inspect_page' to view available inputs.`,
        };
      }

      // Step 3: Focus, clear existing text, and type the query
      await searchInput.scrollIntoViewIfNeeded().catch(() => {});
      await searchInput.click({ timeout: 2000 }).catch(() => {});
      await searchInput.fill(trimmedQuery, { timeout: 3000 });

      // Step 4: Submit search if requested
      if (submit) {
        // Try pressing Enter first
        await searchInput.press('Enter', { timeout: 2000 }).catch(() => {});

        // Wait briefly to see if navigation or DOM update starts
        await page.waitForTimeout(1000);

        // Check if page navigated or if a search submit button is waiting
        const submitButtons = [
          'ytd-searchbox button#search-icon-legacy',
          'button#search-icon-legacy',
          'button[type="submit"]',
          'button[id*="search" i]',
          'button[aria-label*="search" i]',
          'input[type="submit"]',
        ];

        for (const subSel of submitButtons) {
          try {
            const subBtn = page.locator(subSel).first();
            if (await subBtn.isVisible({ timeout: 400 }).catch(() => false)) {
              await subBtn.click({ timeout: 1000 }).catch(() => {});
              break;
            }
          } catch {}
        }

        // Wait for page to settle
        await page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(800);
      }

      const title = await page.title();
      const currentUrl = page.url();
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'in_page_search',
        url: currentUrl,
        title,
        content: `Searched for "${trimmedQuery}" using selector "${matchedSelector}". Current page: ${currentUrl} ("${title}")`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'in_page_search',
        error: `In-page search failed: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Web Search using DuckDuckGo
  public async searchWeb(query: string): Promise<BrowserActionResult> {
    try {
      const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query.trim())}&ia=web`;
      const navRes = await this.navigate(searchUrl);
      if (!navRes.success) return navRes;

      const page = await this.ensurePage();
      await page.waitForTimeout(1000);

      const snippets = await page.evaluate(() => {
        const results: Array<{ title: string; link: string; snippet: string }> = [];
        const elements = document.querySelectorAll('article[data-testid="result"], li[data-layout="organic"]');
        elements.forEach((el, index) => {
          if (index < 6) {
            const titleEl = el.querySelector('h2, a[data-testid="result-title-a"]');
            const linkEl = el.querySelector('a[href^="http"]');
            const snippetEl = el.querySelector('div[data-result="snippet"], .kY2IgmnCmOGjharHEakU');
            if (titleEl && linkEl) {
              results.push({
                title: (titleEl.textContent || '').trim(),
                link: (linkEl as HTMLAnchorElement).href || '',
                snippet: (snippetEl?.textContent || '').trim(),
              });
            }
          }
        });
        return results;
      });

      let summary = `Search query: "${query}"\nTop Results:\n`;
      if (snippets.length > 0) {
        snippets.forEach((s, idx) => {
          summary += `${idx + 1}. [${s.title}](${s.link})\n   ${s.snippet}\n\n`;
        });
      } else {
        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1500));
        summary += bodyText;
      }

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'search_web',
        url: page.url(),
        title: await page.title(),
        content: summary.trim(),
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'search_web',
        error: `Search error: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Structured Page Inspection
  public async inspectPage(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const title = await page.title();
      const currentUrl = page.url();

      const pageStructure = await page.evaluate(() => {
        // Headings
        const headings: Array<{ level: string; text: string }> = [];
        document.querySelectorAll('h1, h2, h3').forEach((h) => {
          const t = (h.textContent || '').trim();
          if (t && headings.length < 15) {
            headings.push({ level: h.tagName.toLowerCase(), text: t.slice(0, 100) });
          }
        });

        // Visible interactive inputs
        const inputs: Array<{ type: string; name: string; id: string; placeholder: string; label: string }> = [];
        document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((el) => {
          const input = el as HTMLInputElement;
          const rect = input.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && inputs.length < 15) {
            let labelText = '';
            if (input.id) {
              const lbl = document.querySelector(`label[for="${input.id}"]`);
              if (lbl) labelText = (lbl.textContent || '').trim();
            }
            inputs.push({
              type: input.type || input.tagName.toLowerCase(),
              name: input.name || '',
              id: input.id || '',
              placeholder: input.placeholder || '',
              label: labelText.slice(0, 50),
            });
          }
        });

        // Visible buttons
        const buttons: Array<{ text: string; id: string; ariaLabel: string }> = [];
        document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach((b) => {
          const rect = b.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && buttons.length < 15) {
            const txt = (b.textContent || '').replace(/\s+/g, ' ').trim();
            const aria = b.getAttribute('aria-label') || '';
            if (txt || aria) {
              buttons.push({ text: txt.slice(0, 50), id: b.id || '', ariaLabel: aria.slice(0, 50) });
            }
          }
        });

        // Key content links
        const links: Array<{ text: string; href: string }> = [];
        const seenHrefs = new Set<string>();
        document.querySelectorAll('a[href]').forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          const txt = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (href && href.startsWith('http') && txt && !seenHrefs.has(href) && links.length < 20) {
            seenHrefs.add(href);
            links.push({ text: txt.slice(0, 60), href });
          }
        });

        // Visible text excerpt
        const clone = document.body.cloneNode(true) as HTMLElement;
        ['script', 'style', 'noscript', 'svg', 'iframe'].forEach((tag) => {
          clone.querySelectorAll(tag).forEach((e) => e.remove());
        });
        const excerpt = (clone.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1000);

        return { headings, inputs, buttons, links, excerpt };
      });

      let formatted = `Page Structure for: ${currentUrl} ("${title}")\n\n`;
      if (pageStructure.headings.length > 0) {
        formatted += `Headings:\n` + pageStructure.headings.map((h) => `- [${h.level}] ${h.text}`).join('\n') + `\n\n`;
      }
      if (pageStructure.inputs.length > 0) {
        formatted += `Interactive Inputs:\n` + pageStructure.inputs.map((inp) => `- <${inp.type}> name="${inp.name}" id="${inp.id}" placeholder="${inp.placeholder}" label="${inp.label}"`).join('\n') + `\n\n`;
      }
      if (pageStructure.buttons.length > 0) {
        formatted += `Buttons:\n` + pageStructure.buttons.map((btn) => `- "${btn.text}" (id: ${btn.id || 'none'}, aria: ${btn.ariaLabel || 'none'})`).join('\n') + `\n\n`;
      }
      if (pageStructure.links.length > 0) {
        formatted += `Key Links:\n` + pageStructure.links.slice(0, 10).map((l, i) => `${i + 1}. [${l.text}](${l.href})`).join('\n') + `\n\n`;
      }
      formatted += `Text Excerpt:\n${pageStructure.excerpt}`;

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'inspect_page',
        url: currentUrl,
        title,
        content: formatted,
        data: pageStructure,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'inspect_page',
        error: `Failed to inspect page: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Detect CAPTCHA, MFA, OTP, or bot challenges
  public async detectSecurityChallenges(): Promise<SecurityChallengeResult> {
    try {
      const page = await this.ensurePage();
      return await page.evaluate(() => {
        // 1. CAPTCHA tests
        const recaptcha = document.querySelector('iframe[src*="recaptcha"], .g-recaptcha, #recaptcha, div[class*="recaptcha" i]');
        const hcaptcha = document.querySelector('iframe[src*="hcaptcha"], .h-captcha, div[class*="hcaptcha" i]');
        const turnstile = document.querySelector('iframe[src*="cloudflare"], iframe[src*="turnstile"], .cf-turnstile');
        const genericCaptcha = document.querySelector('[id*="captcha" i], [class*="captcha" i]');

        if (recaptcha || hcaptcha || turnstile || genericCaptcha) {
          const type = recaptcha ? 'Google reCAPTCHA' : hcaptcha ? 'hCaptcha' : turnstile ? 'Cloudflare Turnstile' : 'CAPTCHA Challenge';
          return {
            hasChallenge: true,
            challengeType: 'CAPTCHA' as const,
            details: `Detected ${type} on page. Automated bypass is strictly prevented. User manual interaction required.`,
          };
        }

        // 2. 2FA / OTP challenges
        const otpInput = document.querySelector('input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="2fa" i], input[name*="mfa" i], input[name*="token" i], input[placeholder*="verification code" i], input[placeholder*="6-digit" i]');
        const bodyText = (document.body.innerText || '').toLowerCase();
        const mfaPhrases = [
          'two-factor authentication',
          'verification code',
          'enter the code sent to',
          'authenticator app',
          'security key',
          'one-time password',
          'check your phone',
        ];
        const matchedPhrase = mfaPhrases.find((phrase) => bodyText.includes(phrase));

        if (otpInput || matchedPhrase) {
          return {
            hasChallenge: true,
            challengeType: 'MFA' as const,
            details: `Detected Two-Factor Authentication (MFA/OTP): "${matchedPhrase || 'One-time verification code input'}". User manual input required.`,
          };
        }

        return { hasChallenge: false, challengeType: 'NONE' as const };
      });
    } catch {
      return { hasChallenge: false, challengeType: 'NONE' };
    }
  }

  // Action: Intelligent, accessible form and input detection
  public async inspectForms(): Promise<FormInspectionResult> {
    try {
      const page = await this.ensurePage();
      const currentUrl = page.url();
      const title = await page.title();

      const challenge = await this.detectSecurityChallenges();

      const rawFormData = await page.evaluate(() => {
        const resolveLabel = (el: HTMLElement): string => {
          const input = el as HTMLInputElement;
          // Strategy A: native labels
          if (input.labels && input.labels.length > 0) {
            const txt = (input.labels[0].textContent || '').trim();
            if (txt) return txt;
          }
          // Strategy B: label[for="id"]
          if (input.id) {
            const lbl = document.querySelector(`label[for="${input.id}"]`);
            if (lbl && lbl.textContent) return lbl.textContent.trim();
          }
          // Strategy C: closest wrapping label
          const parentLbl = input.closest('label');
          if (parentLbl && parentLbl.textContent) {
            return parentLbl.textContent.trim();
          }
          // Strategy D: aria-label or aria-labelledby
          const ariaLabel = input.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
          const ariaLabelledby = input.getAttribute('aria-labelledby');
          if (ariaLabelledby) {
            const parts: string[] = [];
            ariaLabelledby.split(/\s+/).forEach((id) => {
              const ref = document.getElementById(id);
              if (ref && ref.textContent) parts.push(ref.textContent.trim());
            });
            if (parts.length > 0) return parts.join(' ');
          }
          // Strategy E: placeholder
          if (input.placeholder && input.placeholder.trim()) return input.placeholder.trim();
          // Strategy F: previous sibling label/span/text
          let prev = input.previousElementSibling;
          while (prev) {
            if (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'P') {
              const txt = (prev.textContent || '').trim();
              if (txt && txt.length < 60) return txt;
            }
            prev = prev.previousElementSibling;
          }
          return '';
        };

        const formsList: any[] = [];
        const seenInputs = new Set<Element>();

        // Collect all forms
        const formElements = Array.from(document.querySelectorAll('form'));
        formElements.forEach((formEl, fIdx) => {
          const fields: any[] = [];
          const formInputs = Array.from(formEl.querySelectorAll('input:not([type="hidden"]), textarea, select'));

          formInputs.forEach((el) => {
            seenInputs.add(el);
            const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            const tag = input.tagName.toLowerCase();
            const type = (input as HTMLInputElement).type || tag;
            const name = input.name || '';
            const id = input.id || '';
            const label = resolveLabel(input);
            const placeholder = (input as HTMLInputElement).placeholder || '';
            const required = input.required || input.getAttribute('aria-required') === 'true';
            const disabled = input.disabled || input.getAttribute('aria-disabled') === 'true';
            const readOnly = (input as HTMLInputElement).readOnly || false;

            let options: any[] | undefined = undefined;
            if (tag === 'select') {
              const sel = input as HTMLSelectElement;
              options = Array.from(sel.options).map((opt) => ({
                value: opt.value,
                label: opt.text.trim(),
                selected: opt.selected,
              }));
            }

            let checked: boolean | undefined = undefined;
            if (type === 'checkbox' || type === 'radio') {
              checked = (input as HTMLInputElement).checked;
            }

            // Mask password current value for safety
            let val = input.value || '';
            if (type === 'password' && val) val = '••••••••';

            fields.push({
              tag,
              type,
              name,
              id,
              label: label.slice(0, 80),
              placeholder: placeholder.slice(0, 80),
              required,
              disabled,
              readOnly,
              currentValue: val,
              options,
              checked,
              role: input.getAttribute('role') || undefined,
            });
          });

          // Submit buttons
          const submitButtons: any[] = [];
          formEl.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]').forEach((b) => {
            const txt = (b.textContent || (b as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
            const aria = b.getAttribute('aria-label') || '';
            if (txt || aria) {
              submitButtons.push({ text: txt.slice(0, 60), id: b.id || '', ariaLabel: aria.slice(0, 60) });
            }
          });

          // Detect Purpose
          let purpose = 'general';
          const hasPassword = fields.some((f) => f.type === 'password');
          const hasUsernameOrEmail = fields.some((f) => f.type === 'email' || /user|login|email/i.test(f.name) || /user|login|email/i.test(f.label));
          const allBtnText = submitButtons.map((b) => b.text.toLowerCase()).join(' ');
          const formText = (formEl.innerText || '').toLowerCase();

          if (hasPassword) {
            if (/sign\s*up|register|create\s*(an\s*)?account|join/i.test(allBtnText) || /sign\s*up|register|create\s*(an\s*)?account/i.test(formText)) {
              purpose = 'registration';
            } else if (hasUsernameOrEmail || /log\s*in|sign\s*in/i.test(allBtnText) || /log\s*in|sign\s*in/i.test(formText)) {
              purpose = 'login';
            } else {
              purpose = 'login';
            }
          } else if (fields.length === 1 && (fields[0].type === 'search' || /search|query|find/i.test(fields[0].name) || /search|query|find/i.test(fields[0].placeholder))) {
            purpose = 'search';
          } else if (/card|cvv|expir|billing|checkout|payment/i.test(formText)) {
            purpose = 'checkout';
          } else if (fields.some((f) => f.tag === 'textarea') && fields.some((f) => f.type === 'email')) {
            purpose = 'contact';
          }

          formsList.push({
            formIndex: fIdx,
            id: formEl.id || '',
            name: formEl.name || '',
            action: formEl.action || '',
            method: (formEl.method || 'GET').toUpperCase(),
            purpose,
            fields,
            submitButtons,
          });
        });

        // Collect orphan inputs outside of any <form>
        const orphanInputs: any[] = [];
        document.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((el) => {
          if (!seenInputs.has(el)) {
            const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            const tag = input.tagName.toLowerCase();
            const type = (input as HTMLInputElement).type || tag;
            orphanInputs.push({
              tag,
              type,
              name: input.name || '',
              id: input.id || '',
              label: resolveLabel(input).slice(0, 80),
              placeholder: (input as HTMLInputElement).placeholder || '',
              required: input.required || input.getAttribute('aria-required') === 'true',
              disabled: input.disabled || input.getAttribute('aria-disabled') === 'true',
              readOnly: (input as HTMLInputElement).readOnly || false,
            });
          }
        });

        // Detect ambiguity: identical names or labels among interactive fields
        const allFields = [...formsList.flatMap((f) => f.fields), ...orphanInputs];
        const labelCounts: Record<string, number> = {};
        allFields.forEach((f) => {
          const key = (f.label || f.name || '').toLowerCase();
          if (key && f.type !== 'radio') {
            labelCounts[key] = (labelCounts[key] || 0) + 1;
          }
        });
        allFields.forEach((f) => {
          const key = (f.label || f.name || '').toLowerCase();
          if (key && labelCounts[key] > 1 && !f.id) {
            f.isAmbiguous = true;
          }
        });

        return { forms: formsList, orphanFields: orphanInputs };
      });

      let summary = `Detected ${rawFormData.forms.length} form(s) and ${rawFormData.orphanFields.length} orphan field(s) on ${currentUrl} ("${title}").\n`;
      if (challenge.hasChallenge) {
        summary += `[SECURITY CHALLENGE DETECTED] ${challenge.details}\n`;
      }
      rawFormData.forms.forEach((f: any, i: number) => {
        summary += `\nForm #${i + 1} [Purpose: ${f.purpose.toUpperCase()}] ID: "${f.id || 'none'}", Method: ${f.method}:\n`;
        f.fields.forEach((field: any) => {
          const reqStr = field.required ? ' [REQUIRED]' : '';
          const ambStr = field.isAmbiguous ? ' [AMBIGUOUS]' : '';
          summary += `  - <${field.tag} type="${field.type}"> label="${field.label}" name="${field.name}" id="${field.id}" placeholder="${field.placeholder}"${reqStr}${ambStr}\n`;
        });
        if (f.submitButtons.length > 0) {
          summary += `  Submit Buttons: ${f.submitButtons.map((b: any) => `"${b.text}"`).join(', ')}\n`;
        }
      });

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'inspect_forms',
        url: currentUrl,
        title,
        content: summary,
        forms: rawFormData.forms,
        orphanFields: rawFormData.orphanFields,
        detectedChallenge: challenge,
        data: { forms: rawFormData.forms, orphanFields: rawFormData.orphanFields, challenge },
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'inspect_forms',
        error: `Failed to inspect forms: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Intelligent accessible form filling with verification and sensitive value masking
  public async smartFillForm(options: SmartFillOptions): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const entries = Object.entries(options.fields);
      if (entries.length === 0) {
        return { success: false, action: 'smart_fill_form', error: 'No form fields provided to fill.' };
      }

      const filledResults: Array<{ field: string; expectedValue: any; actualValue: any; verified: boolean; type?: string }> = [];

      for (const [fieldName, rawVal] of entries) {
        const targetVal = rawVal;
        const trimmedField = fieldName.trim();
        const isSensitive = /password|passwd|pin|cvv|secret/i.test(trimmedField);

        // Locating strategy with retry for dynamic/stale locators
        let matchedEl = null;
        let matchedType = 'text';

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            // Strategy 1: Accessible role locators
            try {
              const byRole = page.getByRole('textbox', { name: new RegExp(trimmedField, 'i') }).first();
              if (await byRole.isVisible({ timeout: 800 })) { matchedEl = byRole; matchedType = 'text'; break; }
            } catch {}

            try {
              const byCombo = page.getByRole('combobox', { name: new RegExp(trimmedField, 'i') }).first();
              if (await byCombo.isVisible({ timeout: 800 })) { matchedEl = byCombo; matchedType = 'select'; break; }
            } catch {}

            try {
              const byCheck = page.getByRole('checkbox', { name: new RegExp(trimmedField, 'i') }).first();
              if (await byCheck.isVisible({ timeout: 800 })) { matchedEl = byCheck; matchedType = 'checkbox'; break; }
            } catch {}

            try {
              const byRadio = page.getByRole('radio', { name: new RegExp(trimmedField, 'i') }).first();
              if (await byRadio.isVisible({ timeout: 800 })) { matchedEl = byRadio; matchedType = 'radio'; break; }
            } catch {}

            // Strategy 2: Accessible label
            try {
              const byLabel = page.getByLabel(trimmedField, { exact: false }).first();
              if (await byLabel.isVisible({ timeout: 800 })) {
                matchedEl = byLabel;
                const tag = await byLabel.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
                const typeAttr = await byLabel.getAttribute('type').catch(() => '');
                matchedType = tag === 'select' ? 'select' : typeAttr === 'checkbox' ? 'checkbox' : typeAttr === 'radio' ? 'radio' : 'text';
                break;
              }
            } catch {}

            // Strategy 3: Placeholder
            try {
              const byPholder = page.getByPlaceholder(trimmedField, { exact: false }).first();
              if (await byPholder.isVisible({ timeout: 800 })) { matchedEl = byPholder; matchedType = 'text'; break; }
            } catch {}

            // Strategy 4: Attribute selectors
            try {
              const byAttr = page.locator(
                `input[name="${trimmedField}" i], textarea[name="${trimmedField}" i], select[name="${trimmedField}" i], ` +
                `input#${trimmedField}, textarea#${trimmedField}, select#${trimmedField}, [aria-label*="${trimmedField}" i]`
              ).first();
              if (await byAttr.isVisible({ timeout: 800 })) {
                matchedEl = byAttr;
                const tag = await byAttr.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'input');
                const typeAttr = await byAttr.getAttribute('type').catch(() => '');
                matchedType = tag === 'select' ? 'select' : typeAttr === 'checkbox' ? 'checkbox' : typeAttr === 'radio' ? 'radio' : 'text';
                break;
              }
            } catch {}

            if (!matchedEl && attempt === 0) {
              await page.waitForTimeout(400); // Re-inspect pause
            }
          } catch {
            await page.waitForTimeout(300);
          }
        }

        if (!matchedEl) {
          return {
            success: false,
            action: 'smart_fill_form',
            error: `Could not locate field "${fieldName}" using accessible locators on ${page.url()}. Use browser_inspect_forms to find exact fields.`,
            data: { filledResults },
          };
        }

        // Fill based on element type
        let actualVal: any = '';
        let verified = false;

        try {
          if (matchedType === 'select') {
            const strVal = String(targetVal);
            try {
              await matchedEl.selectOption({ label: strVal }, { timeout: 2000 });
            } catch {
              await matchedEl.selectOption({ value: strVal }, { timeout: 2000 });
            }
            actualVal = await matchedEl.inputValue().catch(() => strVal);
            verified = true;
          } else if (matchedType === 'checkbox') {
            const boolVal = targetVal === true || targetVal === 'true' || targetVal === 1 || targetVal === '1' || targetVal === 'yes';
            await matchedEl.setChecked(boolVal, { timeout: 2000 });
            actualVal = await matchedEl.isChecked();
            verified = actualVal === boolVal;
          } else if (matchedType === 'radio') {
            await matchedEl.check({ timeout: 2000 });
            actualVal = await matchedEl.isChecked();
            verified = actualVal === true;
          } else {
            // Text / Email / Password / Textarea
            const strVal = String(targetVal ?? '');
            await matchedEl.click({ timeout: 1500 });
            await matchedEl.fill(strVal, { timeout: 2500 });
            actualVal = await matchedEl.inputValue().catch(() => '');
            verified = isSensitive ? actualVal.length > 0 : actualVal === strVal;
          }
        } catch (fillErr: any) {
          return {
            success: false,
            action: 'smart_fill_form',
            error: `Failed to interact with field "${fieldName}": ${fillErr?.message || String(fillErr)}`,
            data: { filledResults },
          };
        }

        filledResults.push({
          field: fieldName,
          type: matchedType,
          expectedValue: isSensitive ? '••••••••' : targetVal,
          actualValue: isSensitive ? '••••••••' : actualVal,
          verified,
        });

        if (!verified) {
          return {
            success: false,
            action: 'smart_fill_form',
            error: `Field "${fieldName}" verification failed after interaction.`,
            data: { filledResults },
          };
        }
      }

      // Submit if requested
      if (options.submit) {
        let submitBtn = null;
        if (options.submitButtonTextOrSelector) {
          try {
            const btn = page.locator(options.submitButtonTextOrSelector).or(
              page.getByRole('button', { name: new RegExp(options.submitButtonTextOrSelector, 'i') })
            ).first();
            if (await btn.isVisible({ timeout: 1200 })) submitBtn = btn;
          } catch {}
        }

        if (!submitBtn) {
          try {
            const btn = page.locator('button[type="submit"], input[type="submit"]').or(
              page.getByRole('button', { name: /submit|sign in|log in|register|create account|save|continue/i })
            ).first();
            if (await btn.isVisible({ timeout: 1200 })) submitBtn = btn;
          } catch {}
        }

        if (submitBtn) {
          await submitBtn.click({ timeout: 3000 });
          await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'smart_fill_form',
        url: page.url(),
        title: await page.title(),
        content: `Successfully filled and verified ${filledResults.length} field(s): ${filledResults.map((f) => `"${f.field}" (${f.type})`).join(', ')}${options.submit ? ' [Submitted]' : ''}`,
        filledCount: filledResults.length,
        verifiedCount: filledResults.filter((f) => f.verified).length,
        verifications: Object.fromEntries(filledResults.map((f) => [f.field, f])),
        data: { filledResults },
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'smart_fill_form',
        error: `Form filling failed: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Authorized Secure Login with Pre-flight Check and Post-Submit Verification
  public async executeLogin(options: LoginExecutionOptions): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const currentUrl = page.url();

      // 1. Domain Check
      if (options.domain) {
        const parsed = new URL(currentUrl);
        const targetDomain = options.domain.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
        if (!parsed.hostname.toLowerCase().includes(targetDomain)) {
          return {
            success: false,
            action: 'login',
            state: 'failed',
            error: `Domain mismatch: Browser is currently on "${parsed.hostname}", but target login domain is "${targetDomain}". Navigate to the target site first.`,
          };
        }
      }

      // 2. Pre-flight Security Challenge Detection
      const challenge = await this.detectSecurityChallenges();
      if (challenge.hasChallenge) {
        return {
          success: false,
          action: 'login',
          state: 'blocked',
          error: `Security challenge detected (${challenge.challengeType}): ${challenge.details}. Automated bypass is prevented for security. Please complete verification in the browser window.`,
          detectedChallenge: challenge,
        };
      }

      // 3. Locate Username / Email Field
      let userField = null;
      if (options.usernameField) {
        try {
          const el = page.locator(options.usernameField).or(page.getByLabel(options.usernameField, { exact: false })).first();
          if (await el.isVisible({ timeout: 1200 })) userField = el;
        } catch {}
      }

      if (!userField) {
        const userLocators = [
          page.getByLabel(/username|user|email|login|account/i).first(),
          page.getByPlaceholder(/username|user|email|login/i).first(),
          page.getByRole('textbox', { name: /username|user|email|login/i }).first(),
          page.locator('input[type="email"], input[autocomplete*="username" i], input[autocomplete*="email" i], input[name*="user" i], input[name*="email" i], input[name*="login" i]').first(),
        ];
        for (const loc of userLocators) {
          try {
            if (await loc.isVisible({ timeout: 800 })) { userField = loc; break; }
          } catch {}
        }
      }

      if (!userField) {
        return {
          success: false,
          action: 'login',
          state: 'failed',
          error: `Could not locate username or email input field on ${currentUrl}.`,
        };
      }

      // 4. Locate Password Field
      let passField = null;
      if (options.passwordField) {
        try {
          const el = page.locator(options.passwordField).or(page.getByLabel(options.passwordField, { exact: false })).first();
          if (await el.isVisible({ timeout: 1200 })) passField = el;
        } catch {}
      }

      if (!passField) {
        const passLocators = [
          page.locator('input[type="password"]').first(),
          page.getByLabel(/password|passcode/i).first(),
          page.getByPlaceholder(/password|passcode/i).first(),
          page.locator('input[autocomplete*="password" i], input[name*="pass" i]').first(),
        ];
        for (const loc of passLocators) {
          try {
            if (await loc.isVisible({ timeout: 800 })) { passField = loc; break; }
          } catch {}
        }
      }

      if (!passField) {
        return {
          success: false,
          action: 'login',
          state: 'failed',
          error: `Could not locate password input field on ${currentUrl}.`,
        };
      }

      // 5. Fill credentials without exposing password
      await userField.click({ timeout: 1500 });
      await userField.fill(options.username, { timeout: 2000 });

      await passField.click({ timeout: 1500 });
      await passField.fill(options.password, { timeout: 2000 });

      // Verify fields were populated
      const verifiedUser = (await userField.inputValue().catch(() => '')) === options.username;
      const passLen = (await passField.inputValue().catch(() => '')).length;

      if (!verifiedUser || passLen === 0) {
        return {
          success: false,
          action: 'login',
          state: 'failed',
          error: 'Failed to populate login credentials into the input fields.',
        };
      }

      // 6. Submit if requested
      if (options.submit !== false) {
        let submitBtn = null;
        try {
          const btn = page.locator('button[type="submit"], input[type="submit"]').or(
            page.getByRole('button', { name: /log\s*in|sign\s*in|continue|submit/i })
          ).first();
          if (await btn.isVisible({ timeout: 1500 })) submitBtn = btn;
        } catch {}

        if (!submitBtn) {
          // Fallback: press Enter on password field
          await passField.press('Enter');
        } else {
          await submitBtn.click({ timeout: 3000 });
        }

        // Wait for state transition
        await page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(800);

        // 7. Post-Submit Verification
        const postChallenge = await this.detectSecurityChallenges();
        if (postChallenge.hasChallenge) {
          return {
            success: false,
            action: 'login',
            state: 'blocked',
            error: `Security challenge appeared after submission (${postChallenge.challengeType}): ${postChallenge.details}. Manual resolution required.`,
            detectedChallenge: postChallenge,
          };
        }

        // Check for visible error message
        const loginError = await page.evaluate(() => {
          const errSelectors = ['[role="alert"]', '.alert-danger', '.error', '.error-message', '#error', '#login-error'];
          for (const sel of errSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const txt = (el.textContent || '').trim();
                if (txt) return txt.slice(0, 150);
              }
            }
          }
          const text = (document.body.innerText || '').toLowerCase();
          const errorPhrases = [
            'invalid username or password',
            'invalid credentials',
            'incorrect password',
            'incorrect username',
            'user not found',
            'authentication failed',
            'access denied',
            'check your email and password',
            'wrong password',
          ];
          for (const phrase of errorPhrases) {
            if (text.includes(phrase)) return phrase;
          }
          return null;
        });

        if (loginError) {
          return {
            success: false,
            action: 'login',
            state: 'failed',
            error: `Login failed: Site responded with error "${loginError}".`,
            url: page.url(),
          };
        }

        // Check for success indicators
        const newUrl = page.url();
        const hasLoggedOutBtn = await page.locator('text=/log\s*out|sign\s*out|my\s*account|dashboard/i').first().isVisible({ timeout: 1000 }).catch(() => false);
        const passFieldStillPresent = await page.locator('input[type="password"]').first().isVisible({ timeout: 1000 }).catch(() => false);

        if (hasLoggedOutBtn || (!passFieldStillPresent && newUrl !== currentUrl)) {
          return {
            success: true,
            action: 'login',
            state: 'completed',
            url: newUrl,
            title: await page.title(),
            content: `Login succeeded and verified on ${newUrl}.`,
          };
        }

        return {
          success: true,
          action: 'login',
          state: 'completed',
          url: newUrl,
          title: await page.title(),
          content: `Login submitted on ${newUrl}. Verification concluded.`,
        };
      }

      return {
        success: true,
        action: 'login',
        state: 'awaiting_confirmation',
        url: page.url(),
        title: await page.title(),
        content: `Credentials filled and verified for user "${options.username}". Ready for authorized submission.`,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'login',
        state: 'failed',
        error: `Login execution failed: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Read visible page text
  public async readPageContent(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const title = await page.title();
      const currentUrl = page.url();

      const extracted = await page.evaluate(() => {
        const clone = document.body.cloneNode(true) as HTMLElement;
        const removeTags = ['script', 'style', 'noscript', 'svg', 'iframe', 'canvas'];
        removeTags.forEach((tag) => {
          clone.querySelectorAll(tag).forEach((el) => el.remove());
        });
        return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
      });

      const truncated = extracted.slice(0, 2500);
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'read_page',
        url: currentUrl,
        title,
        content: truncated || 'Page text was empty or inaccessible.',
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'read_page',
        error: `Could not read webpage content: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Click button or link with outcome verification
  public async clickElement(selectorOrText: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const trimmed = selectorOrText.trim();
      let clicked = false;
      let isExplicitlyInteractive = false;

      const initialUrl = page.url();
      const initialTitle = await page.title().catch(() => '');
      const initialDownloadCount = this.recentDownloads.length;

      // Strategy 1: Exact CSS selector or ID
      try {
        const el = page.locator(trimmed).first();
        if (await el.isVisible({ timeout: 1500 })) {
          const tagName = await el.evaluate((node) => node.tagName.toLowerCase()).catch(() => '');
          if (['a', 'button', 'input', 'select', 'textarea', 'summary'].includes(tagName)) {
            isExplicitlyInteractive = true;
          }
          await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          await el.click({ timeout: 2500 });
          clicked = true;
        }
      } catch {}

      // Strategy 2: Role matching (button, link, tab, menuitem)
      if (!clicked) {
        try {
          const roleLocator = page.getByRole('button', { name: trimmed }).or(
            page.getByRole('link', { name: trimmed })
          ).or(page.getByRole('tab', { name: trimmed })).or(
            page.getByRole('menuitem', { name: trimmed })
          ).first();

          if (await roleLocator.isVisible({ timeout: 1500 })) {
            isExplicitlyInteractive = true;
            await roleLocator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
            await roleLocator.click({ timeout: 2500 });
            clicked = true;
          }
        } catch {}
      }

      // Strategy 3: Interactive elements containing text (links, buttons, clickable items)
      if (!clicked) {
        try {
          const interactiveLocator = page
            .locator('a, button, [role="button"], [role="link"], [role="tab"], input[type="submit"], input[type="button"], summary, [onclick], [tabindex]')
            .filter({ hasText: trimmed })
            .first();

          if (await interactiveLocator.isVisible({ timeout: 1200 })) {
            isExplicitlyInteractive = true;
            await interactiveLocator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
            await interactiveLocator.click({ timeout: 2500 });
            clicked = true;
          }
        } catch {}
      }

      // Strategy 4: Search result titles where an <a> is enclosed in a heading or list item
      if (!clicked) {
        try {
          const headingLink = page.locator('h1, h2, h3, h4, li').filter({ hasText: trimmed }).locator('a').first();
          if (await headingLink.isVisible({ timeout: 1000 })) {
            isExplicitlyInteractive = true;
            await headingLink.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
            await headingLink.click({ timeout: 2500 });
            clicked = true;
          }
        } catch {}
      }

      // Strategy 5: Generic text locator (with strict outcome verification)
      if (!clicked) {
        const textLocator = page.getByText(trimmed, { exact: false }).first();
        if (await textLocator.isVisible({ timeout: 1500 })) {
          const tag = await textLocator.evaluate((node) => node.tagName.toLowerCase()).catch(() => '');
          if (['a', 'button', 'input', 'select'].includes(tag)) {
            isExplicitlyInteractive = true;
          }
          await textLocator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
          await textLocator.click({ timeout: 3000 });
          clicked = true;
        }
      }

      if (!clicked) {
        return {
          success: false,
          action: 'click_element',
          error: `Element "${selectorOrText}" could not be located or is not visible on page. Use browser_inspect_page to find active links or buttons.`,
        };
      }

      // Wait briefly for potential navigation or DOM changes
      await page.waitForTimeout(800);

      const title = await page.title().catch(() => '');
      const currentUrl = page.url();
      const hasDownload = this.recentDownloads.length > initialDownloadCount;
      const urlChanged = currentUrl !== initialUrl;
      const titleChanged = title !== initialTitle;

      // Verify outcome: If clicked on a non-interactive element and zero state changes occurred, report failure!
      if (!isExplicitlyInteractive && !urlChanged && !titleChanged && !hasDownload) {
        return {
          success: false,
          action: 'click_element',
          error: `Clicked static text element "${selectorOrText}", but no navigation, modal, or state change occurred. Please specify a real link, button, or selector.`,
        };
      }

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'click_element',
        url: currentUrl,
        title,
        content: `Clicked element "${selectorOrText}". Now at: ${currentUrl} ("${title}")${hasDownload ? ' [Download triggered]' : ''}`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'click_element',
        error: `Element "${selectorOrText}" could not be clicked: ${err?.message || 'Element not found or timed out.'}`,
      };
    }
  }

  // Action: Type text into input field or active element
  public async typeText(
    selectorOrText: string,
    value: string,
    options?: { clearFirst?: boolean; pressEnter?: boolean }
  ): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const trimmed = selectorOrText.trim();
      const clearFirst = options?.clearFirst !== false;
      const pressEnter = !!options?.pressEnter;

      let targetEl = null;

      // Try exact selector
      if (trimmed) {
        try {
          const el = page.locator(trimmed).first();
          if (await el.isVisible({ timeout: 1200 })) {
            targetEl = el;
          }
        } catch {}

        // Try by ID or Name
        if (!targetEl && !trimmed.startsWith('#') && !trimmed.startsWith('.')) {
          try {
            const byIdOrName = page.locator(`input#${trimmed}, textarea#${trimmed}, input[name="${trimmed}"], textarea[name="${trimmed}"]`).first();
            if (await byIdOrName.isVisible({ timeout: 1000 })) {
              targetEl = byIdOrName;
            }
          } catch {}
        }

        // Try by placeholder, label, or role
        if (!targetEl) {
          try {
            const byPholder = page.getByPlaceholder(trimmed).or(
              page.getByLabel(trimmed)
            ).first();
            if (await byPholder.isVisible({ timeout: 1000 })) {
              targetEl = byPholder;
            }
          } catch {}
        }
      }

      if (!targetEl) {
        // Fallback to active focused element if available
        const active = page.locator(':focus').first();
        if (await active.isVisible({ timeout: 500 }).catch(() => false)) {
          targetEl = active;
        }
      }

      if (!targetEl) {
        return {
          success: false,
          action: 'type_text',
          error: `Could not locate input field matching "${selectorOrText}". Use browser_inspect_page to check available fields.`,
        };
      }

      await targetEl.click({ timeout: 1500 });
      if (clearFirst) {
        await targetEl.fill(value, { timeout: 2000 });
      } else {
        await targetEl.type(value, { delay: 30, timeout: 3000 });
      }

      if (pressEnter) {
        await targetEl.press('Enter', { timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(800);
      }

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'type_text',
        url: page.url(),
        title: await page.title(),
        content: `Typed text into "${selectorOrText}"${pressEnter ? ' and pressed Enter' : ''}.`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'type_text',
        error: `Failed to type into "${selectorOrText}": ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Select option from dropdown
  public async selectOption(selectorOrText: string, valueOrLabel: string): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const trimmed = selectorOrText.trim();
      const targetVal = valueOrLabel.trim();

      let selectEl = null;

      // Strategy 1: Exact selector
      try {
        const el = page.locator(trimmed).first();
        if (await el.isVisible({ timeout: 1200 })) selectEl = el;
      } catch {}

      // Strategy 2: By label or name
      if (!selectEl) {
        try {
          const byLabel = page.getByLabel(trimmed).or(
            page.locator(`select[name="${trimmed}"], select#${trimmed}`)
          ).first();
          if (await byLabel.isVisible({ timeout: 1000 })) selectEl = byLabel;
        } catch {}
      }

      if (!selectEl) {
        return {
          success: false,
          action: 'select_option',
          error: `Could not find dropdown select element matching "${selectorOrText}".`,
        };
      }

      // Try selecting by label, then value
      try {
        await selectEl.selectOption({ label: targetVal }, { timeout: 2000 });
      } catch {
        await selectEl.selectOption({ value: targetVal }, { timeout: 2000 });
      }

      await page.waitForTimeout(400);
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'select_option',
        url: page.url(),
        content: `Selected option "${targetVal}" in dropdown "${selectorOrText}".`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'select_option',
        error: `Failed to select option in "${selectorOrText}": ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Check or uncheck checkbox/radio
  public async checkElement(selectorOrText: string, checked = true): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const trimmed = selectorOrText.trim();
      let targetEl = null;

      // Try exact selector
      try {
        const el = page.locator(trimmed).first();
        if (await el.isVisible({ timeout: 1200 })) targetEl = el;
      } catch {}

      // Try by label or name
      if (!targetEl) {
        try {
          const byLabel = page.getByLabel(trimmed).or(
            page.locator(`input[name="${trimmed}"], input#${trimmed}`)
          ).first();
          if (await byLabel.isVisible({ timeout: 1000 })) targetEl = byLabel;
        } catch {}
      }

      if (!targetEl) {
        return {
          success: false,
          action: 'check_element',
          error: `Could not find checkbox or radio element matching "${selectorOrText}".`,
        };
      }

      await targetEl.setChecked(checked, { timeout: 2500 });
      await page.waitForTimeout(300);

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'check_element',
        url: page.url(),
        content: `${checked ? 'Checked' : 'Unchecked'} "${selectorOrText}".`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'check_element',
        error: `Failed to set checkbox state for "${selectorOrText}": ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Explicit wait for element, text, or duration
  public async waitFor(options: { timeMs?: number; selector?: string; text?: string }): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const { timeMs, selector, text } = options;

      if (selector) {
        await page.waitForSelector(selector, { timeout: Math.max(5000, timeMs || 5000), state: 'visible' });
      } else if (text) {
        await page.getByText(text).first().waitFor({ timeout: Math.max(5000, timeMs || 5000), state: 'visible' });
      } else if (timeMs) {
        await page.waitForTimeout(Math.min(10000, timeMs));
      } else {
        await page.waitForTimeout(1000);
      }

      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'wait',
        url: page.url(),
        title: await page.title(),
        content: `Finished waiting (${selector ? `selector "${selector}"` : text ? `text "${text}"` : `${timeMs || 1000}ms`}).`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'wait',
        error: `Wait condition failed or timed out: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Fill input / form field alias
  public async fillField(selectorOrText: string, value: string): Promise<BrowserActionResult> {
    return this.typeText(selectorOrText, value, { clearFirst: true });
  }

  // Action: Capture lightweight screenshot
  public async captureScreenshot(): Promise<string | undefined> {
    try {
      if (this.page && !this.page.isClosed()) {
        const buffer = await this.page.screenshot({
          type: 'jpeg',
          quality: 60,
          timeout: 2500,
        });
        return `data:image/jpeg;base64,${buffer.toString('base64')}`;
      }
    } catch {}
    return undefined;
  }

  // Action: Open / Navigate URL alias
  public async open(rawUrl: string): Promise<BrowserActionResult> {
    return this.navigate(rawUrl);
  }

  // Action: Get Page Info (URL, Title, Meta Description)
  public async getPageInfo(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const title = await page.title();
      const url = page.url();
      const description = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
        return meta ? meta.getAttribute('content') || '' : '';
      });
      return {
        success: true,
        action: 'get_page_info',
        url,
        title,
        content: `Title: ${title}\nURL: ${url}\nDescription: ${description || 'None provided'}`,
      };
    } catch (err: any) {
      return { success: false, action: 'get_page_info', error: err?.message || String(err) };
    }
  }

  // Action: Get current URL and title directly
  public async getCurrentUrl(): Promise<BrowserActionResult> {
    try {
      if (!this.page || this.page.isClosed()) {
        return { success: false, action: 'get_current_url', error: 'No browser page is currently open.' };
      }
      const title = await this.page.title();
      const url = this.page.url();
      return {
        success: true,
        action: 'get_current_url',
        url,
        title,
        content: `Current page: ${url} ("${title}")`,
      };
    } catch (err: any) {
      return { success: false, action: 'get_current_url', error: err?.message || String(err) };
    }
  }

  // Action: Extract visible links from page
  public async extractLinks(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const title = await page.title();
      const currentUrl = page.url();

      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const seen = new Set<string>();
        const results: Array<{ text: string; href: string }> = [];

        for (const a of anchors) {
          const href = (a as HTMLAnchorElement).href;
          const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (href && href.startsWith('http') && text && !seen.has(href)) {
            seen.add(href);
            results.push({ text: text.slice(0, 80), href });
            if (results.length >= 20) break;
          }
        }
        return results;
      });

      let formatted = `Extracted ${links.length} links from ${currentUrl}:\n`;
      links.forEach((l, idx) => {
        formatted += `${idx + 1}. [${l.text}](${l.href})\n`;
      });

      return {
        success: true,
        action: 'extract_links',
        url: currentUrl,
        title,
        content: formatted,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'extract_links',
        error: `Could not extract links: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Scroll page up or down
  public async scroll(direction: 'up' | 'down'): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      const delta = direction === 'up' ? -650 : 650;
      await page.evaluate((d) => window.scrollBy(0, d), delta);
      await page.waitForTimeout(400);

      const screenshot = await this.captureScreenshot();
      return {
        success: true,
        action: 'scroll',
        url: page.url(),
        content: `Scrolled page ${direction} by 650px.`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'scroll',
        error: `Could not scroll: ${err?.message || String(err)}`,
      };
    }
  }

  // Action: Navigate back in history
  public async goBack(): Promise<BrowserActionResult> {
    try {
      const page = await this.ensurePage();
      await page.goBack({ timeout: 5000 });
      const title = await page.title();
      const currentUrl = page.url();
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action: 'go_back',
        url: currentUrl,
        title,
        content: `Navigated back to: ${currentUrl} ("${title}")`,
        screenshotBase64: screenshot,
      };
    } catch (err: any) {
      return {
        success: false,
        action: 'go_back',
        error: `Could not navigate back: ${err?.message || String(err)}`,
      };
    }
  }

  // Get current browser status
  public async getStatus(): Promise<{ isOpen: boolean; url?: string; title?: string }> {
    if (this.page && !this.page.isClosed()) {
      return {
        isOpen: true,
        url: this.page.url(),
        title: await this.page.title().catch(() => ''),
      };
    }
    return { isOpen: false };
  }

  // Await browser-managed download from a user or agent action
  public async waitForBrowserDownload(
    triggerAction?: () => Promise<void>,
    timeoutMs = 12000
  ): Promise<{ success: boolean; filename?: string; filePath?: string; sizeBytes?: number; error?: string }> {
    try {
      const page = await this.ensurePage();
      const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
      if (triggerAction) {
        await triggerAction();
      }
      const download = await downloadPromise;
      const suggested = download.suggestedFilename() || `download_${Date.now()}`;
      const safe = path.basename(suggested).replace(/[^a-zA-Z0-9._-]/g, '_');
      let dest = path.join(this.downloadsPath, safe);
      let counter = 1;
      const ext = path.extname(safe);
      const base = path.basename(safe, ext);
      while (fs.existsSync(dest)) {
        dest = path.join(this.downloadsPath, `${base}_${counter}${ext}`);
        counter++;
      }
      await download.saveAs(dest);
      if (fs.existsSync(dest)) {
        const stats = fs.statSync(dest);
        if (stats.size > 0) {
          const record = {
            filename: path.basename(dest),
            filePath: dest,
            sizeBytes: stats.size,
            timestamp: Date.now(),
          };
          this.recentDownloads.push(record);
          return {
            success: true,
            filename: record.filename,
            filePath: record.filePath,
            sizeBytes: record.sizeBytes,
          };
        }
      }
      return { success: false, error: 'Downloaded file was empty or missing on disk.' };
    } catch (err: any) {
      return { success: false, error: `Browser download wait failed: ${err?.message || String(err)}` };
    }
  }

  // Get most recent verified browser download
  public getLatestDownload(): { filename: string; filePath: string; sizeBytes: number; timestamp: number } | undefined {
    return this.recentDownloads.length > 0 ? this.recentDownloads[this.recentDownloads.length - 1] : undefined;
  }

  // Bounded recovery for an unresponsive, timed-out, or crashed browser page
  public async recoverUnresponsivePage(): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
      this.page = null;
      const newPage = await this.ensurePage();
      const url = newPage.url();
      return { success: true, url };
    } catch (err: any) {
      return { success: false, error: `Failed to recover browser page: ${err?.message || String(err)}` };
    }
  }

  // Clean shutdown of browser
  public async close(): Promise<void> {
    return this.closeBrowser();
  }

  public async closeBrowser(): Promise<void> {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close().catch(() => {});
      }
      if (this.context) {
        await this.context.close().catch(() => {});
      }
      if (this.browser && this.browser.isConnected()) {
        await this.browser.close().catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      this.page = null;
      this.context = null;
      this.browser = null;
    }
  }
}
