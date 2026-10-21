import { axeViolations, collectErrors, expect, noHorizontalScroll, signIn, test } from './fixtures';

/** Every page an admin can open, with the heading it must show. */
const PAGES: [string, RegExp][] = [
  ['/', /^Guten (Morgen|Tag|Abend), admin$/],
  ['/devices', /Geräte/],
  ['/devices/2', /nas-keller/],
  ['/devices/2?tab=history', /nas-keller/],
  ['/devices/2?tab=jobs', /nas-keller/],
  ['/devices/11', /iPhone von Anna/],
  ['/devices/12?tab=mdm', /iPad Küche/],
  ['/alarme', /Alarm/],
  ['/patches', /Updates|Patches/],
  ['/skripte', /Skripte/],
  ['/automatisierung', /Automatisierung/],
  ['/personen', /Personen/],
  ['/audit', /Audit/],
  ['/administration', /Administration/],
  ['/doku', /Dokumentation|Doku/],
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`pages (${theme})`, () => {
    for (const [path, heading] of PAGES) {
      test(`${path} renders, is accessible and fits the screen`, async ({ page }) => {
        const errors = collectErrors(page);
        await signIn(page, 'admin', theme);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
        await page.waitForLoadState('networkidle');
        await noHorizontalScroll(page);
        expect(await axeViolations(page)).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}
