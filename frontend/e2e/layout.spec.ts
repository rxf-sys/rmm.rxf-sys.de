import { expect, signIn, test } from './fixtures';

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
