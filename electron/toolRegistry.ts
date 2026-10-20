import { BrowserService, BrowserActionResult } from './browserService';
import { DesktopService, WindowInfo } from './desktopService';
import { DownloadManager } from './downloadManager';
import { TaskManager, TaskRecord } from './taskManager';
import { CredentialManager } from './credentialStore';

export type RiskLevel = 'LOW' | 'MODERATE' | 'HIGHER';

export interface ToolExecutionContext {
  browserService: BrowserService;
  desktopService: DesktopService;
  downloadManager: DownloadManager;
  taskManager: TaskManager;
  onRequestApproval: (approval: {
    id: string;
    action: string;
    details: string;
    targetUrl: string;
    isConsequential: boolean;
  }) => Promise<boolean>;
  onEmitEvent: (type: any, message: string, details?: string, url?: string, screenshotUrl?: string) => void;
  taskPlan?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  riskLevel: RiskLevel;
  parameters: {
    type: 'OBJECT';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: Record<string, any>, context: ToolExecutionContext) => Promise<any>;
}

// Consequential action detection patterns
const CONSEQUENTIAL_PATTERNS = [
  /\b(submit|place order|checkout|pay|payment|purchase|buy now)\b/i,
  /\b(delete account|erase data|confirm payment|book appointment|transfer)\b/i,
  /\b(password|passwd|otp|one-time pin|cvv|credit card|secret key)\b/i,
];

export function isConsequentialAction(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/[-_.]+/g, ' ');
  return (
    CONSEQUENTIAL_PATTERNS.some((p) => p.test(text)) ||
    CONSEQUENTIAL_PATTERNS.some((p) => p.test(normalized))
  );
}

export function isSensitiveField(fieldName: string): boolean {
  if (!fieldName) return false;
  return /password|passwd|pass|otp|pin|cvv|secret|token|credit[-_]?card|ssn|auth/i.test(fieldName);
}

export function isToolActionConsequential(toolName: string, args: Record<string, any> = {}): boolean {
  const normalizedName = (toolName || '').toLowerCase().replace(/[-_.]+/g, '_');
  
  if (normalizedName === 'task_delete') return true;
  if (normalizedName === 'browser_login') return true;

  if (normalizedName === 'click_control' || normalizedName === 'browser_click') {
    const target = String(args.target || args.selector || args.element || args.selector_or_text || '');
    if (isConsequentialAction(target)) return true;
  }

  if (normalizedName === 'smart_fill_form') {
    if (args.submit === true) return true;
    if (args.fields && typeof args.fields === 'object') {
      for (const [k, v] of Object.entries(args.fields)) {
        if (isSensitiveField(k) || isConsequentialAction(String(v))) return true;
      }
    }
  }

  if (normalizedName === 'fill_form' || normalizedName === 'browser_fill' || normalizedName === 'browser_type') {
    if (args.fields && typeof args.fields === 'object') {
      for (const [k, v] of Object.entries(args.fields)) {
        if (isSensitiveField(k) || isConsequentialAction(String(v))) return true;
      }
    }
    const singleField = String(args.field || args.target || args.field_name_or_selector || '');
    const singleVal = String(args.value || args.text || '');
    if (isSensitiveField(singleField) || isConsequentialAction(singleVal)) return true;
  }

  return false;
}

// Master Tool Definitions
const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // 1. Browser Navigation by Intent
  open_website: {
    name: 'open_website',
    description: 'Navigate directly to the requested website destination (HTTP/HTTPS). Reuses active browser tab without duplicate tabs or redundant reload if already on the target site.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'The absolute URL to navigate to (e.g. https://en.wikipedia.org)' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      const url = String(args.url || args.link || '').trim();
      if (!url) return { success: false, error: 'URL parameter is required.' };
      ctx.onEmitEvent('NAVIGATE', `Navigating to: ${url}`, undefined, url);
      const res = await ctx.browserService.navigate(url);
      ctx.onEmitEvent(
        res.success ? 'NAVIGATE' : 'ERROR',
        res.success ? `Arrived at: ${res.title || res.url}` : (res.error || 'Navigation failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  browser_open: {
    name: 'browser_open',
    description: 'Navigate to a verified HTTP or HTTPS webpage in the desktop Chromium browser (alias for open_website).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'The absolute URL to navigate to' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.open_website.handler(args, ctx);
    },
  },

  browser_navigate: {
    name: 'browser_navigate',
    description: 'Navigate the Chromium browser to a new URL (alias for open_website).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Destination web URL' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.open_website.handler(args, ctx);
    },
  },

  browser_bring_to_front: {
    name: 'browser_bring_to_front',
    description: 'Bring the visible Playwright browser window to the foreground so the user can visibly observe automation in real time.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      ctx.onEmitEvent('INFO', 'Bringing browser window to foreground');
      const res = await ctx.browserService.bringToForeground();
      return res;
    },
  },

  list_browser_tabs: {
    name: 'list_browser_tabs',
    description: 'List all currently open browser tabs in the active automation session, including stable identifiers (e.g. "tab-1"), current URLs, titles, and which tab is active.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      ctx.onEmitEvent('INFO', 'Listing browser tabs');
      const res = await ctx.browserService.listBrowserTabs();
      return res;
    },
  },

  create_browser_tab: {
    name: 'create_browser_tab',
    description: 'Create a new distinct browser tab without modifying or replacing existing tabs. Optionally navigates the new tab to a destination URL.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Optional URL to open in the new tab' },
      },
    },
    handler: async (args, ctx) => {
      const url = args.url ? String(args.url).trim() : undefined;
      ctx.onEmitEvent('INFO', `Creating new browser tab${url ? ` at ${url}` : ''}`);
      const res = await ctx.browserService.createBrowserTab(url);
      ctx.onEmitEvent('NAVIGATE', res.content || 'Created new browser tab', undefined, res.url);
      return res;
    },
  },

  activate_browser_tab: {
    name: 'activate_browser_tab',
    description: 'Switch to and activate an open browser tab by tab identifier (e.g. "tab-1", "tab-2"), index, or URL/title substring.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        tabIdOrQuery: { type: 'STRING', description: 'Tab ID (e.g. "tab-1"), 0-based index, or URL/title substring to activate' },
      },
      required: ['tabIdOrQuery'],
    },
    handler: async (args, ctx) => {
      const query = String(args.tabIdOrQuery || args.tabId || args.query || args.target || '').trim();
      ctx.onEmitEvent('INFO', `Activating browser tab matching: "${query}"`);
      const res = await ctx.browserService.activateBrowserTab(query);
      ctx.onEmitEvent(res.success ? 'INFO' : 'ERROR', res.content || res.error || 'Activated tab', undefined, res.url);
      return res;
    },
  },

  navigate_current_tab: {
    name: 'navigate_current_tab',
    description: 'Strictly navigate only the currently active browser tab to the requested URL without creating any new tabs.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Destination web URL to navigate the current tab to' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      const url = String(args.url || args.link || '').trim();
      ctx.onEmitEvent('NAVIGATE', `Navigating current tab to: ${url}`, undefined, url);
      const res = await ctx.browserService.navigateCurrentTab(url);
      ctx.onEmitEvent(res.success ? 'NAVIGATE' : 'ERROR', res.content || res.error || 'Navigated current tab', undefined, res.url);
      return res;
    },
  },

  navigate_new_tab: {
    name: 'navigate_new_tab',
    description: 'Create a new browser tab and navigate it to the destination URL, keeping existing tabs intact.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Destination web URL to open in a new tab' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      const url = String(args.url || args.link || '').trim();
      ctx.onEmitEvent('NAVIGATE', `Opening in new tab: ${url}`, undefined, url);
      const res = await ctx.browserService.navigateNewTab(url);
      ctx.onEmitEvent(res.success ? 'NAVIGATE' : 'ERROR', res.content || res.error || 'Opened new tab', undefined, res.url);
      return res;
    },
  },

  open_multiple_urls_in_tabs: {
    name: 'open_multiple_urls_in_tabs',
    description: 'Open multiple URLs into distinct separate browser tabs and verify each one.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        urls: {
          type: 'ARRAY',
          description: 'Array of absolute URLs to open in separate tabs (e.g. ["https://en.wikipedia.org", "https://www.amazon.com"])',
          items: { type: 'STRING' },
        },
      },
      required: ['urls'],
    },
    handler: async (args, ctx) => {
      const rawUrls = Array.isArray(args.urls) ? args.urls : [];
      ctx.onEmitEvent('NAVIGATE', `Opening ${rawUrls.length} URLs in separate tabs`);
      const res = await ctx.browserService.openMultipleUrlsInTabs(rawUrls);
      ctx.onEmitEvent(res.success ? 'NAVIGATE' : 'ERROR', res.content || res.error || 'Tabs opened', undefined, res.url);
      return res;
    },
  },

  desktop_write_notepad: {
    name: 'desktop_write_notepad',
    description: 'Manage Notepad documents deterministically: preserves existing user text, creates new document/window when needed, confirms focus before typing, and verifies text insertion.',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The text or poem to write into Notepad' },
        mode: { type: 'STRING', description: 'Operation mode: "new_document" (preserve existing by opening new), "continue_current" (append to existing), or "auto"' },
        titleFilter: { type: 'STRING', description: 'Optional title substring to match specific Notepad document' },
      },
      required: ['text'],
    },
    handler: async (args, ctx) => {
      const text = String(args.text || args.content || args.poem || '').trim();
      const mode = args.mode as any;
      const titleFilter = args.titleFilter ? String(args.titleFilter) : undefined;
      ctx.onEmitEvent('INFO', `Writing to Notepad (${mode || 'auto'})...`);
      const res = await ctx.desktopService.manageNotepadDocument({ text, mode, titleFilter });
      ctx.onEmitEvent(
        res.success ? 'SUCCESS' : 'ERROR',
        res.success ? `Successfully typed into Notepad document (${res.isNewDocument ? 'new document created to preserve original text' : 'continued in active document'})` : (res.error || 'Notepad typing failed')
      );
      return res;
    },
  },

  // 2. Site-Internal Search by Intent
  search_current_site: {
    name: 'search_current_site',
    description: 'Search INSIDE the currently loaded website using that site\'s own internal search interface (e.g. searching inside Wikipedia, GitHub, YouTube, or docs). NEVER switches to an external search engine.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search query or keyword to find on this website' },
        submit: { type: 'BOOLEAN', description: 'Whether to submit the search (press Enter / click search button). Defaults to true.' },
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      const query = String(args.query || args.text || args.search || '').trim();
      const submit = args.submit !== false;
      ctx.onEmitEvent('SEARCH', `Searching in-page for: "${query}"`);
      const res = await ctx.browserService.inPageSearch(query, submit);
      ctx.onEmitEvent(
        res.success ? 'SEARCH' : 'ERROR',
        res.success ? `Searched for "${query}" on active page` : (res.error || 'In-page search failed'),
        res.content?.slice(0, 200),
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  browser_in_page_search: {
    name: 'browser_in_page_search',
    description: 'Search INSIDE the currently loaded website using that site\'s own internal search interface (alias for search_current_site).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'The search query or keyword to find on this website' },
        submit: { type: 'BOOLEAN', description: 'Whether to submit the search. Defaults to true.' },
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.search_current_site.handler(args, ctx);
    },
  },

  // 3. External Web Search by Intent
  web_search: {
    name: 'web_search',
    description: 'EXTERNAL general web search using DuckDuckGo search engine. Use ONLY when looking up unknown public information across the broader internet. NEVER use this when searching inside an open website or when a specific target website was requested (use search_current_site instead).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search keywords or query topic' },
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      let query = String(args.query || '').trim();
      if (ctx.taskPlan && ctx.taskPlan.searchQuery && !args.query) {
        query = ctx.taskPlan.searchQuery;
      }
      if (!query) return { success: false, error: 'Search query is required.' };

      // Guard: If browser is currently open on an active website, NEVER hijack with DuckDuckGo.
      // Route to search_current_site instead!
      const status = await ctx.browserService.getStatus();
      if (status.isOpen && status.url && !status.url.includes('duckduckgo.com') && status.url !== 'about:blank') {
        ctx.onEmitEvent('INFO', `Preserving target website (${status.url}): routing to search_current_site to prevent external search hijacking.`);
        return await TOOL_DEFINITIONS.search_current_site.handler({ query, submit: true }, ctx);
      }

      ctx.onEmitEvent('SEARCH', `Searching web for: "${query}"`);
      const res = await ctx.browserService.searchWeb(query);
      ctx.onEmitEvent(
        res.success ? 'SEARCH' : 'ERROR',
        res.success ? `Found search results for: "${query}"` : (res.error || 'Search failed'),
        res.content?.slice(0, 300),
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  browser_search: {
    name: 'browser_search',
    description: 'EXTERNAL general web search using DuckDuckGo (alias for web_search). Routes to in-page search if website is already open.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search keywords or query topic' },
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.web_search.handler(args, ctx);
    },
  },

  // 3. Read Page Content
  browser_read_visible_text: {
    name: 'browser_read_visible_text',
    description: 'Extract and read the visible text and structure of the currently loaded webpage.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      ctx.onEmitEvent('READ', 'Extracting visible text from active webpage...');
      const res = await ctx.browserService.readPageContent();
      ctx.onEmitEvent(
        res.success ? 'READ' : 'ERROR',
        res.success ? `Read ${res.content?.length || 0} characters from page` : (res.error || 'Read failed'),
        res.content?.slice(0, 200),
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  // 4. Page Metadata Info
  browser_get_page_info: {
    name: 'browser_get_page_info',
    description: 'Inspect the active webpage to get the title, canonical URL, and description meta-tags.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      const res = await ctx.browserService.getPageInfo();
      return res;
    },
  },

  // 5. Extract Page Links
  browser_extract_links: {
    name: 'browser_extract_links',
    description: 'Extract a clean list of visible hyperlinked titles and URLs from the current page.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      const res = await ctx.browserService.extractLinks();
      ctx.onEmitEvent('INFO', res.success ? `Extracted links from page` : 'Failed to extract links');
      return res;
    },
  },

  // 4. Click Control by Intent
  click_control: {
    name: 'click_control',
    description: 'Click the intended interactive control (button, link, tab, checkbox) identified by visible text or CSS selector, and verify the resulting outcome (navigation, state change, or modal). Rejects clicks on static non-interactive text.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: { type: 'STRING', description: 'Visible text or CSS selector of the control to click' },
      },
      required: ['target'],
    },
    handler: async (args, ctx) => {
      const target = String(args.target || args.selector || args.element || '').trim();
      if (!target) return { success: false, error: 'Target control is required.' };

      // Consequential action check (submit, pay, purchase, checkout, delete)
      if (isConsequentialAction(target)) {
        ctx.onEmitEvent('APPROVAL', `Approval requested before action: Click "${target}"`);
        const status = await ctx.browserService.getStatus();
        const approved = await ctx.onRequestApproval({
          id: `appr-${Date.now()}`,
          action: `Click "${target}"`,
          details: `The agent requested to click a potentially consequential element on: ${status.url || 'webpage'}`,
          targetUrl: status.url || '',
          isConsequential: true,
        });

        if (!approved) {
          ctx.onEmitEvent('INFO', `User declined approval for clicking "${target}".`);
          return { success: false, error: 'Action cancelled: user declined approval for this consequential action.' };
        }
      }

      ctx.onEmitEvent('CLICK', `Clicking control: "${target}"`);
      const res = await ctx.browserService.clickElement(target);
      ctx.onEmitEvent(
        res.success ? 'CLICK' : 'ERROR',
        res.success ? `Clicked "${target}" successfully` : (res.error || 'Click failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  browser_click: {
    name: 'browser_click',
    description: 'Click a button, link, or clickable element identified by visible text or CSS selector (alias for click_control).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: { type: 'STRING', description: 'Visible text or CSS selector of the element to click' },
      },
      required: ['target'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.click_control.handler(args, ctx);
    },
  },

  // 7. Get Current Browser URL
  browser_get_current_url: {
    name: 'browser_get_current_url',
    description: 'Inspect the current browser session to retrieve active URL and title without re-navigating.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      return ctx.browserService.getCurrentUrl();
    },
  },

  // 8. Inspect Page Structure & Controls
  browser_inspect_page: {
    name: 'browser_inspect_page',
    description: 'Inspect the active webpage to extract structured layout: headings (H1/H2), visible interactive inputs, buttons, key links, and text excerpt.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      ctx.onEmitEvent('READ', 'Inspecting page structure and interactive controls...');
      const res = await ctx.browserService.inspectPage();
      ctx.onEmitEvent(
        res.success ? 'READ' : 'ERROR',
        res.success ? `Inspected controls on active page` : (res.error || 'Inspection failed'),
        res.content?.slice(0, 200),
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  // 5. Form Handling by Intent with Field Verification
  fill_form: {
    name: 'fill_form',
    description: 'Fill requested form fields accurately and verify their values. Accepts either a map of fields (e.g. { "username": "user", "email": "test@example.com" }) or a single field and value. Verifies each field after filling. Never invents missing data.',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        fields: { type: 'OBJECT', description: 'Key-value map of form field names/labels/placeholders to target values' },
        field: { type: 'STRING', description: 'Single field name, label, placeholder, or selector' },
        value: { type: 'STRING', description: 'Value to enter into the single field' },
      },
    },
    handler: async (args, ctx) => {
      const fieldsMap: Record<string, string> = {};
      if (args.fields && typeof args.fields === 'object') {
        Object.assign(fieldsMap, args.fields);
      }
      const singleField = String(args.field || args.target || args.selector || '').trim();
      const singleVal = args.value !== undefined ? String(args.value) : args.text !== undefined ? String(args.text) : undefined;
      if (singleField && singleVal !== undefined) {
        fieldsMap[singleField] = singleVal;
      }

      if (Object.keys(fieldsMap).length === 0) {
        return { success: false, error: 'No form fields provided to fill. Provide "fields" map or "field" and "value".' };
      }

      // Consequential / sensitive field check
      for (const [k, v] of Object.entries(fieldsMap)) {
        if (isSensitiveField(k) || isConsequentialAction(v)) {
          ctx.onEmitEvent('APPROVAL', `Approval requested before filling sensitive form field: "${k}"`);
          const status = await ctx.browserService.getStatus();
          const approved = await ctx.onRequestApproval({
            id: `appr-form-${Date.now()}`,
            action: `Fill sensitive form field "${k}"`,
            details: `The agent requested to enter information into a potentially sensitive field: ${k}`,
            targetUrl: status.url || '',
            isConsequential: true,
          });
          if (!approved) {
            return { success: false, error: `User declined form filling for sensitive field: "${k}".` };
          }
        }
      }

      ctx.onEmitEvent('FILL', `Filling form fields: ${Object.keys(fieldsMap).join(', ')}`);
      const res = await ctx.browserService.fillForm(fieldsMap);
      ctx.onEmitEvent(
        res.success ? 'FILL' : 'ERROR',
        res.success ? `Filled and verified ${Object.keys(fieldsMap).length} field(s)` : (res.error || 'Form filling failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  browser_fill: {
    name: 'browser_fill',
    description: 'Type text into an input field, search box, or textarea identified by label, placeholder, or selector (alias for fill_form).',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: { type: 'STRING', description: 'Placeholder, name, label, or selector of the target input' },
        value: { type: 'STRING', description: 'The text value to enter' },
      },
      required: ['field', 'value'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.fill_form.handler(args, ctx);
    },
  },

  browser_type: {
    name: 'browser_type',
    description: 'Type text into an input field or active element (alias for fill_form).',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: { type: 'STRING', description: 'Selector, name, id, placeholder, or label of the target input' },
        value: { type: 'STRING', description: 'The text value to enter' },
        clearFirst: { type: 'BOOLEAN', description: 'Whether to clear existing text before typing (default: true)' },
        pressEnter: { type: 'BOOLEAN', description: 'Whether to press Enter after typing (default: false)' },
      },
      required: ['value'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.fill_form.handler(args, ctx);
    },
  },

  // Intelligent Form Inspection
  browser_inspect_forms: {
    name: 'browser_inspect_forms',
    description: 'Inspect forms and interactive elements on the active page. Detects input labels, placeholders, types (email, password, text, select, checkbox, radio), submit buttons, and security challenges (CAPTCHA, MFA/2FA).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (args, ctx) => {
      ctx.onEmitEvent('INFO', 'Inspecting page forms and interactive elements...');
      const res = await ctx.browserService.inspectForms();
      if (res.detectedChallenge?.hasChallenge) {
        ctx.onEmitEvent('APPROVAL', `Security challenge detected: ${res.detectedChallenge.details}`);
      }
      return res;
    },
  },

  // Intelligent Multi-type Form Filling
  smart_fill_form: {
    name: 'smart_fill_form',
    description: 'Fill form fields with intelligent accessible locator detection. Handles text inputs, select dropdowns, checkboxes, and radio buttons. Verifies field values and safely masks secrets. Requests authorization before final submission of consequential forms.',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        fields: { type: 'OBJECT', description: 'Map of field labels/names/placeholders to target values' },
        submit: { type: 'BOOLEAN', description: 'Whether to submit the form after filling (defaults to false)' },
        submitButtonTextOrSelector: { type: 'STRING', description: 'Optional text or selector for submit button' },
      },
      required: ['fields'],
    },
    handler: async (args, ctx) => {
      const fields = (args.fields && typeof args.fields === 'object') ? args.fields : {};
      const submit = Boolean(args.submit);
      const submitButtonTextOrSelector = args.submitButtonTextOrSelector ? String(args.submitButtonTextOrSelector) : undefined;

      // Build masked summary for approval and logs
      const maskedSummary: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) {
        maskedSummary[k] = isSensitiveField(k) ? '••••••••' : String(v);
      }

      // Check if submission or sensitive field requires approval
      const requiresApproval = submit || Object.keys(fields).some((k) => isSensitiveField(k));
      if (requiresApproval) {
        const status = await ctx.browserService.getStatus();
        ctx.onEmitEvent('APPROVAL', `Approval requested before ${submit ? 'submitting' : 'filling'} form on ${status.url}`);
        const approved = await ctx.onRequestApproval({
          id: `appr-form-${Date.now()}`,
          action: `${submit ? 'Submit' : 'Fill'} form with fields: ${Object.keys(fields).join(', ')}`,
          details: `Target fields: ${JSON.stringify(maskedSummary)}`,
          targetUrl: status.url || '',
          isConsequential: true,
        });
        if (!approved) {
          return { success: false, error: 'User declined form submission.' };
        }
      }

      ctx.onEmitEvent('FILL', `Filling form fields: ${Object.keys(fields).join(', ')}`);
      const res = await ctx.browserService.smartFillForm({
        fields,
        submit,
        submitButtonTextOrSelector,
      });

      ctx.onEmitEvent(
        res.success ? 'FILL' : 'ERROR',
        res.success ? (res.content || 'Form fields filled successfully') : (res.error || 'Form filling failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  // Authorized Secure Login
  browser_login: {
    name: 'browser_login',
    description: 'Perform authorized, secure login on the current website. Safely acquires credentials, fills username and password, pauses for user approval before submission, and strictly verifies authentication outcome. Never passes passwords to the model or logs.',
    riskLevel: 'HIGHER',
    parameters: {
      type: 'OBJECT',
      properties: {
        username: { type: 'STRING', description: 'Username or email address for login' },
        password: { type: 'STRING', description: 'Password for login (will be masked and shielded)' },
        domain: { type: 'STRING', description: 'Optional domain to verify (e.g. example.com)' },
        submit: { type: 'BOOLEAN', description: 'Whether to submit the login form (defaults to true)' },
      },
    },
    handler: async (args, ctx) => {
      const status = await ctx.browserService.getStatus();
      const currentUrl = status.url || '';
      let username = String(args.username || '').trim();
      let password = String(args.password || '').trim();

      // Check CredentialManager if credentials not explicitly supplied in args
      if (!username || !password) {
        const cred = CredentialManager.getInstance().getCredentialForDomain(currentUrl);
        if (cred) {
          if (!username) username = cred.username;
          if (!password) password = cred.password;
        }
      }

      if (!username || !password) {
        return {
          success: false,
          state: 'awaiting_credentials',
          error: `Credentials required to log in to ${currentUrl}. Please provide username and password.`,
        };
      }

      // Pre-flight challenge inspection
      const challenge = await ctx.browserService.detectSecurityChallenges();
      if (challenge.hasChallenge) {
        ctx.onEmitEvent('APPROVAL', `Security challenge detected: ${challenge.details}`);
        return {
          success: false,
          state: 'blocked',
          error: `Security challenge detected (${challenge.challengeType}): ${challenge.details}. Manual resolution required.`,
        };
      }

      // Consequential Action Approval Check: User must approve login action before submission
      ctx.onEmitEvent('APPROVAL', `Approval requested to log in as "${username}" on ${currentUrl}`);
      const approved = await ctx.onRequestApproval({
        id: `appr-login-${Date.now()}`,
        action: `Log in as user "${username}"`,
        details: `The agent requests permission to authenticate with user "${username}" on "${currentUrl}". Password is secure and masked.`,
        targetUrl: currentUrl,
        isConsequential: true,
      });

      if (!approved) {
        return { success: false, state: 'failed', error: `User declined login authorization for "${username}" on ${currentUrl}.` };
      }

      ctx.onEmitEvent('FILL', `Authenticating as "${username}" on ${currentUrl} (password masked)`);
      const res = await ctx.browserService.executeLogin({
        username,
        password,
        domain: args.domain,
        submit: args.submit !== false,
      });

      ctx.onEmitEvent(
        res.success ? 'SUCCESS' : 'ERROR',
        res.success ? `Login succeeded for "${username}" on ${res.url}` : (res.error || 'Login failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );

      return res;
    },
  },

  // 12. Select Dropdown Option
  browser_select: {
    name: 'browser_select',
    description: 'Select an option from a <select> dropdown by visible label or value.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: { type: 'STRING', description: 'Selector, name, id, or label of the dropdown element' },
        value: { type: 'STRING', description: 'Option visible text or value to select' },
      },
      required: ['field', 'value'],
    },
    handler: async (args, ctx) => {
      const field = String(args.field || args.target || args.selector || '').trim();
      const value = String(args.value || args.option || args.label || '').trim();
      ctx.onEmitEvent('FILL', `Selecting "${value}" in dropdown "${field}"`);
      const res = await ctx.browserService.selectOption(field, value);
      ctx.onEmitEvent(
        res.success ? 'FILL' : 'ERROR',
        res.success ? `Selected "${value}" in "${field}"` : (res.error || 'Select failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  // 13. Check or Uncheck Checkbox / Radio
  browser_check: {
    name: 'browser_check',
    description: 'Check or uncheck a checkbox or radio button.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        field: { type: 'STRING', description: 'Selector, name, id, or label of the checkbox/radio' },
        checked: { type: 'BOOLEAN', description: 'True to check, false to uncheck. Defaults to true.' },
      },
      required: ['field'],
    },
    handler: async (args, ctx) => {
      const field = String(args.field || args.target || args.selector || '').trim();
      const checked = args.checked !== false;
      ctx.onEmitEvent('CLICK', `${checked ? 'Checking' : 'Unchecking'} "${field}"`);
      const res = await ctx.browserService.checkElement(field, checked);
      ctx.onEmitEvent(
        res.success ? 'CLICK' : 'ERROR',
        res.success ? `${checked ? 'Checked' : 'Unchecked'} "${field}"` : (res.error || 'Checkbox action failed'),
        undefined,
        res.url,
        res.screenshotBase64
      );
      return res;
    },
  },

  // 14. Browser Wait
  browser_wait: {
    name: 'browser_wait',
    description: 'Wait for a specified element selector, visible text, or time duration in milliseconds on the active page.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        timeMs: { type: 'NUMBER', description: 'Duration in milliseconds to wait (max 10000)' },
        selector: { type: 'STRING', description: 'Optional CSS selector to wait for' },
        text: { type: 'STRING', description: 'Optional text string to wait for' },
      },
    },
    handler: async (args, ctx) => {
      const timeMs = typeof args.timeMs === 'number' ? args.timeMs : typeof args.seconds === 'number' ? args.seconds * 1000 : 1000;
      const selector = args.selector ? String(args.selector).trim() : undefined;
      const text = args.text ? String(args.text).trim() : undefined;
      return ctx.browserService.waitFor({ timeMs, selector, text });
    },
  },

  // 8. Scroll Browser
  browser_scroll: {
    name: 'browser_scroll',
    description: 'Scroll the active webpage viewport up or down.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', description: 'Direction to scroll: "up" or "down"', enum: ['up', 'down'] },
      },
      required: ['direction'],
    },
    handler: async (args, ctx) => {
      const dir = (args.direction === 'up' ? 'up' : 'down') as 'up' | 'down';
      return await ctx.browserService.scroll(dir);
    },
  },

  // 9. Browser Screenshot
  browser_screenshot: {
    name: 'browser_screenshot',
    description: 'Capture a fresh screenshot of the current browser viewport as visual proof.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      const screenshot = await ctx.browserService.captureScreenshot();
      const status = await ctx.browserService.getStatus();
      ctx.onEmitEvent('SCREENSHOT', 'Captured browser screenshot evidence', undefined, status.url, screenshot);
      return { success: !!screenshot, screenshotBase64: screenshot, url: status.url, title: status.title };
    },
  },

  // 10. Browser Go Back
  browser_go_back: {
    name: 'browser_go_back',
    description: 'Navigate back to the previous webpage in browser history.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      return await ctx.browserService.goBack();
    },
  },

  // 11. Browser Close
  browser_close: {
    name: 'browser_close',
    description: 'Close the automated Chromium browser window. CAUTION: ONLY call this when explicitly requested by user or when the entire task is finished. NEVER close the browser between steps or while downloads or subsequent actions are pending.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        force: { type: 'BOOLEAN', description: 'Force close even if steps are pending. Defaults to false.' },
      },
    },
    handler: async (args, ctx) => {
      if (ctx.taskPlan && !args.force) {
        const pendingSteps = ctx.taskPlan.steps.filter((s: any) => s.status === 'PENDING' || s.status === 'IN_PROGRESS');
        if (pendingSteps.length > 1) {
          return {
            success: false,
            error: 'Browser cannot be closed mid-task while dependent steps (search, download, verification) are pending. Keep browser session active.',
          };
        }
      }
      await ctx.browserService.closeBrowser();
      ctx.onEmitEvent('INFO', 'Browser closed cleanly.');
      return { success: true, message: 'Browser session closed.' };
    },
  },

  // 12. Task Management Tools
  task_create: {
    name: 'task_create',
    description: 'Create a new task in the local task manager with a clear title and optional category or description.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Actionable, clear title of the task' },
        category: { type: 'STRING', description: 'Category tag such as Work, Coding, Research, Personal, or Follow-up' },
        description: { type: 'STRING', description: 'Optional detailed description or steps for the task' },
      },
      required: ['title'],
    },
    handler: async (args, ctx) => {
      const title = String(args.title || '').trim();
      if (!title) return { success: false, error: 'Task title is required.' };
      const category = String(args.category || 'General').trim();
      const description = args.description ? String(args.description).trim() : undefined;
      const created = ctx.taskManager.createTask(title, category, description);
      ctx.onEmitEvent('INFO', `Created task: "${created.title}" [${created.category}]`);
      return { success: true, task: created };
    },
  },

  task_list: {
    name: 'task_list',
    description: 'Retrieve the current list of tasks stored in the local task manager.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        filter: { type: 'STRING', description: 'Filter tasks by status: "all", "pending", or "completed"', enum: ['all', 'pending', 'completed'] },
      },
    },
    handler: async (args, ctx) => {
      const filter = (args.filter || 'all') as 'all' | 'pending' | 'completed';
      const tasks = ctx.taskManager.listTasks(filter);
      return { success: true, count: tasks.length, summary: ctx.taskManager.getSummary(), tasks };
    },
  },

  task_complete: {
    name: 'task_complete',
    description: 'Mark a task as completed using its task ID or title.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_id_or_title: { type: 'STRING', description: 'The task ID or keyword matching the title of the task' },
      },
      required: ['task_id_or_title'],
    },
    handler: async (args, ctx) => {
      const idOrTitle = String(args.task_id_or_title || '').trim();
      if (!idOrTitle) return { success: false, error: 'Task identifier is required.' };
      const res = ctx.taskManager.completeTask(idOrTitle);
      if (res.success && res.task) {
        ctx.onEmitEvent('INFO', `Marked task completed: "${res.task.title}"`);
      }
      return res;
    },
  },

  task_update: {
    name: 'task_update',
    description: 'Update the title, category, or description of an existing task.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_id_or_title: { type: 'STRING', description: 'The task ID or matching title of the task to update' },
        new_title: { type: 'STRING', description: 'Updated title' },
        new_category: { type: 'STRING', description: 'Updated category' },
        new_description: { type: 'STRING', description: 'Updated description' },
      },
      required: ['task_id_or_title'],
    },
    handler: async (args, ctx) => {
      const idOrTitle = String(args.task_id_or_title || '').trim();
      return ctx.taskManager.updateTask(idOrTitle, {
        title: args.new_title ? String(args.new_title) : undefined,
        category: args.new_category ? String(args.new_category) : undefined,
        description: args.new_description ? String(args.new_description) : undefined,
      });
    },
  },

  task_delete: {
    name: 'task_delete',
    description: 'Delete a task permanently from the local task manager. Consequential operation requiring confirmation.',
    riskLevel: 'HIGHER',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_id_or_title: { type: 'STRING', description: 'The task ID or title to delete' },
      },
      required: ['task_id_or_title'],
    },
    handler: async (args, ctx) => {
      const idOrTitle = String(args.task_id_or_title || '').trim();
      if (!idOrTitle) return { success: false, error: 'Task identifier is required.' };

      // Request approval for destructive action
      const approved = await ctx.onRequestApproval({
        id: `appr-del-${Date.now()}`,
        action: `Delete task "${idOrTitle}"`,
        details: 'This will permanently remove the task from your local task storage.',
        targetUrl: 'local://tasks',
        isConsequential: true,
      });

      if (!approved) {
        return { success: false, error: 'User declined deletion of task.' };
      }

      const res = ctx.taskManager.deleteTask(idOrTitle);
      if (res.success && res.deletedTask) {
        ctx.onEmitEvent('INFO', `Deleted task: "${res.deletedTask.title}"`);
      }
      return res;
    },
  },

  // 6. Download Handling by Intent
  download_result: {
    name: 'download_result',
    description: 'Download the selected result or file to the approved NEXUS Downloads directory and verify that it was saved with non-zero bytes.',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Direct URL to download' },
        filename: { type: 'STRING', description: 'Optional desired filename' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      const url = String(args.url || '').trim();
      const filename = args.filename ? String(args.filename).trim() : undefined;
      ctx.onEmitEvent('DOWNLOAD', `Downloading result from: ${url}`);
      const res = await ctx.downloadManager.downloadFile(url, filename);

      let finalRes = res;
      if (res.needsApproval) {
        ctx.onEmitEvent('APPROVAL', `Approval requested before saving risky file: ${res.filename}`);
        const approved = await ctx.onRequestApproval({
          id: `appr-dl-${Date.now()}`,
          action: `Download executable/script: ${res.filename}`,
          details: `The downloaded file is an executable or script. Proceeding will save it to NEXUS Downloads.`,
          targetUrl: url,
          isConsequential: true,
        });

        if (!approved) {
          ctx.onEmitEvent('INFO', `Download of "${res.filename}" cancelled by user.`);
          return { success: false, error: 'User declined downloading potentially risky file.' };
        }

        // Resume approved download
        ctx.onEmitEvent('DOWNLOAD', `Resuming approved download for: ${res.filename}`);
        finalRes = await ctx.downloadManager.downloadFile(url, filename, true);
      }

      ctx.onEmitEvent(
        finalRes.success ? 'DOWNLOAD' : 'ERROR',
        finalRes.success ? `File saved successfully: ${finalRes.filename} (${(finalRes.sizeBytes / 1024).toFixed(1)} KB)` : (finalRes.error || 'Download failed'),
        finalRes.filePath
      );
      return finalRes;
    },
  },

  download_file: {
    name: 'download_file',
    description: 'Safely download a file from a direct URL into the user Downloads/NEXUS Downloads folder (alias for download_result).',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Direct URL to download' },
        filename: { type: 'STRING', description: 'Optional desired filename' },
      },
      required: ['url'],
    },
    handler: async (args, ctx) => {
      return TOOL_DEFINITIONS.download_result.handler(args, ctx);
    },
  },

  list_downloads: {
    name: 'list_downloads',
    description: 'List all files currently saved in the designated NEXUS Downloads directory.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      const files = ctx.downloadManager.listDownloadedFiles();
      return { success: true, count: files.length, files };
    },
  },

  read_file: {
    name: 'read_file',
    description: 'Safely inspect and read text content from a specified file inside user downloads or project directories.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_path: { type: 'STRING', description: 'Full or relative path of the file to inspect' },
      },
      required: ['file_path'],
    },
    handler: async (args, ctx) => {
      const filePath = String(args.file_path || '').trim();
      return ctx.downloadManager.readSafeTextFile(filePath);
    },
  },

  // ==========================================
  // PHASE 3: WINDOWS COMPUTER-USE TOOLS
  // ==========================================

  computer_launch_app: {
    name: 'computer_launch_app',
    description: 'Launch an approved Windows desktop application (e.g. "notepad", "calc", "paint", "explorer", "chrome", "edge", "settings") and verify its window appears on the desktop.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        appName: { type: 'STRING', description: 'Application name (e.g. "notepad", "calc", "paint", "explorer", "chrome", "edge", "settings")' },
        arguments: { type: 'STRING', description: 'Optional command-line arguments or path' },
      },
      required: ['appName'],
    },
    handler: async (args, ctx) => {
      const appName = String(args.appName || '').trim();
      const extraArgs = String(args.arguments || '').trim();

      // Guard: If the model mistakenly passed a web destination (e.g. "https://...", "wikipedia.org", "github.com")
      const lower = appName.toLowerCase();
      if (
        lower.startsWith('http://') ||
        lower.startsWith('https://') ||
        lower.includes('.com') ||
        lower.includes('.org') ||
        lower.includes('.net') ||
        lower.includes('.io') ||
        lower.includes('.gov') ||
        lower.includes('.edu')
      ) {
        ctx.onEmitEvent('INFO', `Redirecting web destination "${appName}" to browser navigation.`);
        return TOOL_DEFINITIONS.browser_open.handler({ url: appName }, ctx);
      }

      ctx.onEmitEvent('NAVIGATE', `Launching desktop application: "${appName}"`);
      const res = await ctx.desktopService.launchApp(appName, extraArgs);
      ctx.onEmitEvent(
        res.success ? 'SUCCESS' : 'ERROR',
        res.success ? `Application "${appName}" launched (PID: ${res.data?.processId || 'N/A'})` : (res.error || 'Launch failed')
      );
      return res;
    },
  },

  computer_list_windows: {
    name: 'computer_list_windows',
    description: 'List all open top-level application windows on the Windows desktop with their titles, process names, coordinates, and foreground states.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      const res = await ctx.desktopService.listWindows();
      return res;
    },
  },

  computer_get_active_window: {
    name: 'computer_get_active_window',
    description: 'Get details of the currently focused foreground application window on the Windows desktop.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      return ctx.desktopService.getActiveWindow();
    },
  },

  computer_activate_window: {
    name: 'computer_activate_window',
    description: 'Bring an open application window to the foreground by window title substring, process name, or HWND (e.g. "Notepad", "Calculator", "Chrome").',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: { type: 'STRING', description: 'Target window title substring, process name, or HWND' },
      },
      required: ['target'],
    },
    handler: async (args, ctx) => {
      const target = String(args.target || '').trim();
      ctx.onEmitEvent('INFO', `Switching to window: "${target}"`);
      const res = await ctx.desktopService.activateWindow(target);
      ctx.onEmitEvent(
        res.success ? 'INFO' : 'ERROR',
        res.success ? `Activated window: "${res.data?.title || target}"` : (res.error || 'Failed to activate window')
      );
      return res;
    },
  },

  computer_type_text: {
    name: 'computer_type_text',
    description: 'Type text into the active foreground application window or a specified target window on Windows.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'The text characters to type' },
        targetWindow: { type: 'STRING', description: 'Optional target window title to focus before typing (e.g. "Notepad")' },
      },
      required: ['text'],
    },
    handler: async (args, ctx) => {
      const text = String(args.text || '');
      const targetWindow = args.targetWindow ? String(args.targetWindow).trim() : undefined;
      ctx.onEmitEvent('FILL', `Typing into window${targetWindow ? ` "${targetWindow}"` : ''}: "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`);
      const res = await ctx.desktopService.typeText(text, targetWindow);
      ctx.onEmitEvent(res.success ? 'INFO' : 'ERROR', res.success ? `Typed ${text.length} characters successfully` : (res.error || 'Typing failed'));
      return res;
    },
  },

  computer_press_key: {
    name: 'computer_press_key',
    description: 'Press a special key or keyboard shortcut in the active or specified window (e.g. "ENTER", "ESCAPE", "TAB", "BACKSPACE", "UP", "DOWN", "LEFT", "RIGHT", "CTRL+C", "CTRL+V", "CTRL+A", "CTRL+S", "ALT+F4").',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        key: { type: 'STRING', description: 'Key name (e.g. "ENTER", "ESCAPE", "TAB", "CTRL+C", "CTRL+V", "CTRL+S", "ALT+F4")' },
        targetWindow: { type: 'STRING', description: 'Optional target window title to focus first' },
      },
      required: ['key'],
    },
    handler: async (args, ctx) => {
      const key = String(args.key || '').trim();
      const targetWindow = args.targetWindow ? String(args.targetWindow).trim() : undefined;
      ctx.onEmitEvent('INFO', `Pressing key "${key}"`);
      return ctx.desktopService.pressKey(key, targetWindow);
    },
  },

  computer_click: {
    name: 'computer_click',
    description: 'Move the mouse cursor and left-click at desktop screen coordinates (X, Y).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Screen X coordinate in pixels' },
        y: { type: 'NUMBER', description: 'Screen Y coordinate in pixels' },
      },
      required: ['x', 'y'],
    },
    handler: async (args, ctx) => {
      const x = Number(args.x);
      const y = Number(args.y);
      ctx.onEmitEvent('CLICK', `Clicking at coordinates (${x}, ${y})`);
      return ctx.desktopService.click(x, y);
    },
  },

  computer_double_click: {
    name: 'computer_double_click',
    description: 'Move the mouse cursor and double-click at desktop screen coordinates (X, Y).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'Screen X coordinate in pixels' },
        y: { type: 'NUMBER', description: 'Screen Y coordinate in pixels' },
      },
      required: ['x', 'y'],
    },
    handler: async (args, ctx) => {
      const x = Number(args.x);
      const y = Number(args.y);
      ctx.onEmitEvent('CLICK', `Double clicking at coordinates (${x}, ${y})`);
      return ctx.desktopService.doubleClick(x, y);
    },
  },

  computer_scroll: {
    name: 'computer_scroll',
    description: 'Scroll the mouse wheel on the desktop (-120 for scroll down, 120 for scroll up).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        delta: { type: 'NUMBER', description: 'Wheel delta amount (negative for down, positive for up)' },
      },
    },
    handler: async (args, ctx) => {
      const delta = typeof args.delta === 'number' ? args.delta : -120;
      return ctx.desktopService.scroll(delta);
    },
  },

  computer_capture_screen: {
    name: 'computer_capture_screen',
    description: 'Capture a full screenshot of the interactive Windows desktop as visual observation and task evidence.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
    handler: async (_args, ctx) => {
      ctx.onEmitEvent('INFO', 'Capturing desktop screenshot...');
      const res = await ctx.desktopService.captureScreen();
      if (res.success && res.data) {
        ctx.onEmitEvent(
          'SCREENSHOT',
          `Desktop screenshot captured (${res.data.width}x${res.data.height})`,
          res.data.path,
          undefined,
          res.screenshotBase64
        );
      }
      return res;
    },
  },

  computer_wait_for_window: {
    name: 'computer_wait_for_window',
    description: 'Wait until an application window matching title substring or process name appears on desktop.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Window title substring or process name to wait for' },
        timeoutSeconds: { type: 'NUMBER', description: 'Maximum seconds to wait (default: 6)' },
      },
      required: ['title'],
    },
    handler: async (args, ctx) => {
      const title = String(args.title || '').trim();
      const timeoutSeconds = typeof args.timeoutSeconds === 'number' ? args.timeoutSeconds : 6;
      return ctx.desktopService.waitForWindow(title, timeoutSeconds);
    },
  },

  computer_close_window: {
    name: 'computer_close_window',
    description: 'Gracefully close an application window by title substring or HWND.',
    riskLevel: 'MODERATE',
    parameters: {
      type: 'OBJECT',
      properties: {
        target: { type: 'STRING', description: 'Window title substring or HWND to close' },
      },
      required: ['target'],
    },
    handler: async (args, ctx) => {
      const target = String(args.target || '').trim();
      // Check consequential confirmation if requested action touches critical system components
      if (isConsequentialAction(target)) {
        const approved = await ctx.onRequestApproval({
          id: `appr-${Date.now()}`,
          action: 'Close Application Window',
          details: `The agent is requesting to close window "${target}".`,
          targetUrl: '',
          isConsequential: true,
        });
        if (!approved) {
          ctx.onEmitEvent('INFO', `Closing window "${target}" was rejected by user.`);
          return { success: false, error: 'Window close action was denied by user.' };
        }
      }

      ctx.onEmitEvent('INFO', `Closing window: "${target}"`);
      return ctx.desktopService.closeWindow(target);
    },
  },

  system_open_settings: {
    name: 'system_open_settings',
    description: 'Open Windows Settings directly to a specified page (e.g. "apps", "network", "display", "sound", "windowsupdate").',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        page: { type: 'STRING', description: 'Optional settings page (e.g. "apps", "network", "display", "sound")' },
      },
    },
    handler: async (args, ctx) => {
      const page = String(args.page || '').trim();
      ctx.onEmitEvent('NAVIGATE', `Opening Windows Settings${page ? `: ${page}` : ''}`);
      const res = await ctx.desktopService.launchApp('settings', page);
      ctx.onEmitEvent(res.success ? 'SUCCESS' : 'ERROR', res.success ? 'Windows Settings opened' : (res.error || 'Failed to open settings'));
      return res;
    },
  },

  explorer_open_folder: {
    name: 'explorer_open_folder',
    description: 'Open Windows File Explorer to a folder (defaults to Downloads or specified folder path).',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        folder: { type: 'STRING', description: 'Folder name or path (e.g. "Downloads", "Documents", or absolute directory path)' },
      },
    },
    handler: async (args, ctx) => {
      const folder = String(args.folder || 'Downloads').trim();
      ctx.onEmitEvent('NAVIGATE', `Opening File Explorer: "${folder}"`);
      const res = await ctx.desktopService.launchApp('explorer', folder.toLowerCase() === 'downloads' ? 'shell:Downloads' : folder);
      ctx.onEmitEvent(res.success ? 'SUCCESS' : 'ERROR', res.success ? `File Explorer opened at ${folder}` : (res.error || 'Failed to open folder'));
      return res;
    },
  },

  // 14. Task Completion Tool
  finish_task: {
    name: 'finish_task',
    description: 'Complete the agent task and present a truthful final summary of findings, actions, and source links to the user.',
    riskLevel: 'LOW',
    parameters: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING', description: 'Clear, concise final summary of findings and actions' },
        sources: { 
          type: 'ARRAY', 
          description: 'List of source URLs consulted during the task',
          items: { type: 'STRING' },
        },
      },
      required: ['summary'],
    },
    handler: async (args, ctx) => {
      const summary = String(args.summary || 'Task completed.').trim();
      ctx.onEmitEvent('SUCCESS', summary);
      return { success: true, summary, sources: args.sources };
    },
  },
};

// Aliases for compatibility
const TOOL_ALIASES: Record<string, string> = {
  // Intent canonical aliases
  open_website: 'open_website',
  browser_open: 'open_website',
  browser_navigate: 'open_website',
  open_url: 'open_website',
  navigate: 'open_website',
  navigate_to: 'open_website',

  search_current_site: 'search_current_site',
  browser_in_page_search: 'search_current_site',
  in_page_search: 'search_current_site',
  search_in_page: 'search_current_site',

  web_search: 'web_search',
  browser_search: 'web_search',
  search_web: 'web_search',

  fill_form: 'fill_form',
  browser_fill: 'fill_form',
  browser_type: 'fill_form',
  type_field: 'fill_form',

  click_control: 'click_control',
  browser_click: 'click_control',
  click_element: 'click_control',

  download_result: 'download_result',
  download_file: 'download_result',

  read_page: 'browser_read_visible_text',
  inspect_page: 'browser_inspect_page',
  select_dropdown: 'browser_select',
  check_box: 'browser_check',
  wait: 'browser_wait',
  get_current_url: 'browser_get_current_url',
  create_task: 'task_create',
  launch_app: 'computer_launch_app',
  type_text: 'computer_type_text',
  press_key: 'computer_press_key',
  activate_window: 'computer_activate_window',
  list_windows: 'computer_list_windows',
  open_settings: 'system_open_settings',
  open_folder: 'explorer_open_folder',
  focus_browser: 'browser_bring_to_front',
  show_browser: 'browser_bring_to_front',
  bring_to_front: 'browser_bring_to_front',
  bring_browser_to_front: 'browser_bring_to_front',

  browser_inspect_forms: 'browser_inspect_forms',
  inspect_forms: 'browser_inspect_forms',
  forms_inspect: 'browser_inspect_forms',

  smart_fill_form: 'smart_fill_form',
  smart_fill: 'smart_fill_form',

  browser_login: 'browser_login',
  login: 'browser_login',
  auth_login: 'browser_login',

  // Tab & Document Management aliases (Phase 4)
  list_browser_tabs: 'list_browser_tabs',
  list_tabs: 'list_browser_tabs',
  get_tabs: 'list_browser_tabs',
  create_browser_tab: 'create_browser_tab',
  new_tab: 'create_browser_tab',
  browser_new_tab: 'create_browser_tab',
  open_new_tab: 'create_browser_tab',
  activate_browser_tab: 'activate_browser_tab',
  switch_tab: 'activate_browser_tab',
  select_tab: 'activate_browser_tab',
  focus_tab: 'activate_browser_tab',
  navigate_current_tab: 'navigate_current_tab',
  navigate_new_tab: 'navigate_new_tab',
  open_multiple_urls_in_tabs: 'open_multiple_urls_in_tabs',
  open_tabs: 'open_multiple_urls_in_tabs',
  desktop_write_notepad: 'desktop_write_notepad',
  write_notepad: 'desktop_write_notepad',
  notepad_write: 'desktop_write_notepad',
};

export class ToolDispatcher {
  public static getDeclarations(): any[] {
    // Return primary canonical tools to keep prompt compact and crystal clear
    const primaryNames = [
      'open_website',
      'search_current_site',
      'web_search',
      'fill_form',
      'smart_fill_form',
      'browser_login',
      'list_browser_tabs',
      'create_browser_tab',
      'activate_browser_tab',
      'navigate_current_tab',
      'navigate_new_tab',
      'open_multiple_urls_in_tabs',
      'click_control',
      'download_result',
      'browser_bring_to_front',
      'browser_read_visible_text',
      'browser_get_page_info',
      'browser_inspect_page',
      'browser_inspect_forms',
      'browser_select',
      'browser_check',
      'browser_wait',
      'browser_scroll',
      'browser_screenshot',
      'browser_go_back',
      'browser_close',
      'task_create',
      'task_list',
      'task_complete',
      'task_update',
      'task_delete',
      'list_downloads',
      'read_file',
      'computer_launch_app',
      'computer_activate_window',
      'computer_type_text',
      'computer_press_key',
      'desktop_write_notepad',
      'system_open_settings',
      'explorer_open_folder',
      'finish_task',
    ];

    const declarations = primaryNames
      .map((name) => TOOL_DEFINITIONS[name])
      .filter(Boolean)
      .map((def) => ({
        name: def.name,
        description: def.description,
        parameters: def.parameters,
      }));

    return [{ functionDeclarations: declarations }];
  }

  public static getToolDefinitionsMap(): Record<string, ToolDefinition> {
    const primaryNames = [
      'open_website',
      'search_current_site',
      'web_search',
      'fill_form',
      'smart_fill_form',
      'browser_login',
      'list_browser_tabs',
      'create_browser_tab',
      'activate_browser_tab',
      'navigate_current_tab',
      'navigate_new_tab',
      'open_multiple_urls_in_tabs',
      'click_control',
      'download_result',
      'browser_read_visible_text',
      'browser_get_page_info',
      'browser_inspect_page',
      'browser_inspect_forms',
      'browser_select',
      'browser_check',
      'browser_wait',
      'browser_scroll',
      'browser_screenshot',
      'browser_go_back',
      'browser_close',
      'task_create',
      'task_list',
      'task_complete',
      'task_update',
      'task_delete',
      'list_downloads',
      'read_file',
      'computer_launch_app',
      'computer_activate_window',
      'computer_type_text',
      'computer_press_key',
      'desktop_write_notepad',
      'system_open_settings',
      'explorer_open_folder',
      'finish_task',
    ];

    const map: Record<string, ToolDefinition> = {};
    for (const name of primaryNames) {
      if (TOOL_DEFINITIONS[name]) {
        map[name] = TOOL_DEFINITIONS[name];
      }
    }
    return map;
  }

  public static isToolRegistered(name: string): boolean {
    const resolvedName = TOOL_ALIASES[name] || name;
    return !!TOOL_DEFINITIONS[resolvedName];
  }

  public static isConsequentialAction(name: string, args: Record<string, any> = {}): boolean {
    return isToolActionConsequential(name, args);
  }

  public static validateArgs(name: string, rawArgs: any): {
    valid: boolean;
    error?: string;
    normalizedArgs: Record<string, any>;
  } {
    const resolvedName = TOOL_ALIASES[name] || name;
    const def = TOOL_DEFINITIONS[resolvedName];

    if (!def) {
      return {
        valid: false,
        error: `Tool "${name}" is not registered in the trusted tool registry.`,
        normalizedArgs: {},
      };
    }

    if (rawArgs === null || rawArgs === undefined || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      return {
        valid: false,
        error: `Malformed arguments for tool "${name}": expected a JSON object of key-value parameters.`,
        normalizedArgs: {},
      };
    }

    const args = { ...rawArgs };

    // Normalize common parameter aliases
    if (resolvedName === 'click_control' || resolvedName === 'browser_click') {
      if (!args.target && (args.selector || args.element || args.selector_or_text)) {
        args.target = args.selector || args.element || args.selector_or_text;
      }
    } else if (resolvedName === 'fill_form' || resolvedName === 'browser_fill' || resolvedName === 'browser_type') {
      if (!args.field && (args.selector || args.target || args.input || args.field_name_or_selector)) {
        args.field = args.selector || args.target || args.input || args.field_name_or_selector;
      }
      if (args.value === undefined && args.text !== undefined) {
        args.value = args.text;
      }
    } else if (resolvedName === 'download_result' || resolvedName === 'download_file') {
      if (!args.url && args.link) {
        args.url = args.link;
      }
    } else if (resolvedName === 'browser_select') {
      if (!args.field && (args.selector || args.target)) {
        args.field = args.selector || args.target;
      }
      if (!args.value && (args.option || args.label)) {
        args.value = args.option || args.label;
      }
    } else if (resolvedName === 'browser_check') {
      if (!args.field && (args.selector || args.target)) {
        args.field = args.selector || args.target;
      }
    } else if (resolvedName === 'search_current_site' || resolvedName === 'browser_in_page_search') {
      if (!args.query && (args.text || args.search || args.q)) {
        args.query = args.text || args.search || args.q;
      }
    } else if (resolvedName === 'open_website' || resolvedName === 'browser_open' || resolvedName === 'browser_navigate') {
      if (!args.url && args.link) {
        args.url = args.link;
      }
    } else if (resolvedName === 'computer_activate_window') {
      if (!args.query && (args.title || args.name || args.target)) {
        args.query = args.title || args.name || args.target;
      }
    } else if (resolvedName === 'computer_type_text') {
      if (args.text === undefined && args.value !== undefined) {
        args.text = args.value;
      }
    } else if (resolvedName === 'activate_browser_tab') {
      if (!args.tabIdOrQuery && (args.tabId || args.tab_id || args.query || args.target)) {
        args.tabIdOrQuery = args.tabId || args.tab_id || args.query || args.target;
      }
    } else if (resolvedName === 'navigate_current_tab' || resolvedName === 'navigate_new_tab') {
      if (!args.url && args.link) {
        args.url = args.link;
      }
    } else if (resolvedName === 'desktop_write_notepad') {
      if (!args.text && (args.content || args.body || args.poem || args.message)) {
        args.text = args.content || args.body || args.poem || args.message;
      }
    }

    // Validate required arguments
    if (def.parameters.required) {
      for (const req of def.parameters.required) {
        if (args[req] === undefined || args[req] === null || String(args[req]).trim() === '') {
          return {
            valid: false,
            error: `Missing required parameter "${req}" for tool "${name}".`,
            normalizedArgs: args,
          };
        }
      }
    }

    return { valid: true, normalizedArgs: args };
  }

  public static async dispatch(
    name: string,
    rawArgs: any,
    context: ToolExecutionContext
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    const resolvedName = TOOL_ALIASES[name] || name;
    const def = TOOL_DEFINITIONS[resolvedName];

    if (!def) {
      return {
        success: false,
        error: `Tool "${name}" is not registered in the trusted tool registry.`,
      };
    }

    const validation = ToolDispatcher.validateArgs(name, rawArgs);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    try {
      const result = await def.handler(validation.normalizedArgs, context);
      return { success: true, result };
    } catch (err: any) {
      return {
        success: false,
        error: `Tool execution error in "${name}": ${err?.message || String(err)}`,
      };
    }
  }
}


