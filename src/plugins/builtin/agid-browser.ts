/**
 * AGiD Browser Plugin
 *
 * Tool for controlling a headless Chromium browser via Playwright.
 * Playwright is an optional dependency — loaded dynamically on first use.
 */

import { definePluginEntry } from '../define-plugin-entry.js';

function json(data: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

let browserInstance: any = null;
let currentPage: any = null;

async function ensureBrowser() {
  if (!browserInstance) {
    // Dynamic import — playwright is an optional peer dependency
    const pw: any = await (Function('return import("playwright")')());
    const chromium = pw.chromium ?? pw.default?.chromium;
    browserInstance = await chromium.launch({ headless: true });
  }
  if (!currentPage) {
    currentPage = await browserInstance.newPage();
  }
  return currentPage;
}

export const agidBrowserPlugin = definePluginEntry({
  id: 'agid-browser',
  name: 'AGiD Browser',
  register(api) {
    api.registerTool(
      {
        name: 'browser',
        description: 'Control a headless Chromium browser',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              description: 'Browser action to perform',
              enum: ['navigate', 'click', 'type', 'screenshot', 'evaluate', 'scroll', 'close'],
            },
            url: { type: 'string', description: 'URL to navigate to' },
            selector: { type: 'string', description: 'CSS selector for click/type' },
            text: { type: 'string', description: 'Text to type' },
            expression: { type: 'string', description: 'JavaScript expression to evaluate' },
            direction: { type: 'string', description: 'Scroll direction' },
            amount: { type: 'number', description: 'Scroll amount in pixels' },
          },
          required: ['action'],
        },
        requiresWallet: false,
        async execute(_id, params) {
          const action = params.action as string;

          switch (action) {
            case 'navigate': {
              const page = await ensureBrowser();
              const url = params.url as string;
              await page.goto(url);
              const title = await page.title();
              return json({ url, title });
            }
            case 'click': {
              const page = await ensureBrowser();
              const selector = params.selector as string;
              await page.click(selector);
              return json({ clicked: selector });
            }
            case 'type': {
              const page = await ensureBrowser();
              const selector = params.selector as string;
              const text = params.text as string;
              await page.fill(selector, text);
              return json({ typed: true, selector });
            }
            case 'screenshot': {
              const page = await ensureBrowser();
              const buffer = await page.screenshot({ encoding: 'base64' });
              return json({ screenshot: buffer });
            }
            case 'evaluate': {
              const page = await ensureBrowser();
              const expression = params.expression as string;
              const result = await page.evaluate(expression);
              return json({ result });
            }
            case 'scroll': {
              const page = await ensureBrowser();
              const amount = (params.amount as number) || 300;
              // eslint-disable-next-line @typescript-eslint/no-implied-eval
              await page.evaluate(`window.scrollBy(0, ${Number(amount)})`);
              return json({ scrolled: amount });
            }
            case 'close': {
              if (currentPage) {
                await currentPage.close();
                currentPage = null;
              }
              return json({ closed: true });
            }
            default:
              return json({ error: `Unknown action: ${action}` });
          }
        },
      },
      { group: 'browser' },
    );
  },
  async destroy() {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
      currentPage = null;
    }
  },
});
