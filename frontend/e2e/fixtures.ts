import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

export const PASSWORD = 'demo-passwort-123';

type Role = 'admin' | 'techniker' | 'viewer';

/** Sign in through the API (the login screen has its own test) and skip
 *  the startup animation, which would otherwise cover the first second. */
export async function signIn(page: Page, role: Role = 'admin', theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('vulpexa-theme-pref', t);
      sessionStorage.setItem('vulpexa-boot-seen', '1');
    } catch {
      // Storage blocked: the app falls back to its defaults.
    }
  }, theme);
  const r = await page.request.post('/api/auth/login', { data: { username: role, password: PASSWORD } });
  expect(r.ok(), `login as ${role}`).toBeTruthy();
}

/** Console errors and uncaught exceptions of a page, for a final assertion. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** Serious and critical axe violations, as readable lines. */
export async function axeViolations(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
}

export async function noHorizontalScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll, 'page must not scroll sideways').toBeLessThanOrEqual(width);
}

export const test = base;
export { expect };
