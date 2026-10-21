import { expect, noHorizontalScroll, signIn, test } from './fixtures';

/** Window widths the layout must hold at: tablet, laptop, desktop, wide. */
const WIDTHS = [820, 1280, 1920, 2560];

test.describe('charts stay inside their frame', () => {
  for (const width of WIDTHS) {
    test(`at ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name === 'phone', 'sets its own window widths');
      await page.setViewportSize({ width, height: 1000 });
      await signIn(page);
      for (const path of ['/devices/2?tab=history', '/']) {
        await page.goto(path);
        const frames = page.locator('.lc-frame');
        await expect(frames.first()).toBeVisible();
        for (const frame of await frames.all()) {
          const box = await frame.boundingBox();
          const svg = await frame.locator('svg.lc-svg').boundingBox();
          expect(box, path).not.toBeNull();
          expect(svg, path).not.toBeNull();
          // The drawing is exactly the frame the axis labels are laid out in —
          // not taller because the SVG fell back to its viewBox's aspect ratio
          // and pushed the plot past the frame.
          expect(Math.abs(svg!.height - box!.height), `${path}: svg height`).toBeLessThan(1);
          expect(Math.abs(svg!.y - box!.y), `${path}: svg top`).toBeLessThan(1);
        }
      }
    });
  }
});

/** Every page, between phone and wide screen: the tablet range used to keep
 *  the full rail and push the top bar and the automation page sideways. */
const PATHS = ['/', '/devices', '/devices/2', '/devices/11', '/alarme', '/patches', '/skripte', '/automatisierung', '/personen', '/audit', '/administration', '/doku'];

for (const width of [768, 1024, 2560]) {
  test(`no page scrolls sideways at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'sets its own window widths');
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noHorizontalScroll(page);
    }
  });
}

test('the content uses the whole width of a wide screen', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'sets its own window width');
  await page.setViewportSize({ width: 2560, height: 1000 });
  await signIn(page);
  await page.goto('/patches');
  const content = await page.locator('.shell-content').boundingBox();
  expect(content).not.toBeNull();
  // Everything beside the rail, no dead band on the right.
  expect(content!.x + content!.width).toBeGreaterThan(2560 - 2);
});

test('the rail keeps its link names when it shrinks to icons', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'sets its own window width');
  await page.setViewportSize({ width: 900, height: 900 });
  await signIn(page);
  await page.goto('/');
  const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
  const patches = rail.getByRole('link', { name: /Patches/ });
  await expect(patches).toBeVisible();
  // Icons only: the link is about as wide as the compact rail, not 200 px.
  expect((await patches.boundingBox())!.width).toBeLessThan(80);
});
