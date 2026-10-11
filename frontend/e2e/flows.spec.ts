import { collectErrors, expect, signIn, test } from './fixtures';

test('the device list sorts, selects and opens a bulk action', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'the bulk menu is covered on desktop; phones use cards');
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto('/devices');
  // The header button, not the topbar's "Gerät hinzufügen".
  await page.getByRole('columnheader', { name: /Gerät/ }).getByRole('button').click();
  await expect(page).toHaveURL(/sort=name/);
  await page.getByRole('checkbox', { name: 'nas-keller auswählen' }).check();
  const bar = page.getByRole('region', { name: 'Auswahl' });
  await expect(bar).toContainText('1 ausgewählt');
  await bar.getByRole('button', { name: 'Tags' }).click();
  await expect(page.getByRole('dialog', { name: 'Tags bearbeiten' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('CSV export downloads the filtered list', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'same code path as desktop');
  await signIn(page);
  // The whole fleet: a filter that happens to be empty disables the export.
  await page.goto('/devices');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV exportieren' }).click();
  expect((await download).suggestedFilename()).toMatch(/^vulpexa-devices-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('the command palette finds a device by keyboard', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'phones open the palette from the search button');
  await signIn(page);
  await page.goto('/');
  // The shortcut is registered once the shell has rendered.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox');
  await box.fill('nas');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/devices\/2/);
});

test('viewers see their own devices and no hands-on controls', async ({ page }) => {
  await signIn(page, 'viewer');
  await page.goto('/devices');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Geräte');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Administration/ })).toHaveCount(0);
});

test('signing in through the login screen lands on the overview', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('vulpexa-boot-seen', '1'));
  await page.goto('/');
  await page.getByLabel(/Benutzername/).fill('admin');
  await page.getByLabel(/Passwort/).fill('demo-passwort-123');
  await page.getByRole('button', { name: /Anmelden/ }).click();
  // The overview greets by name instead of repeating its own title.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Guten (Morgen|Tag|Abend), admin$/);
});

test('the enrollment dialog stays inside the screen', async ({ page }, info) => {
  // A fixed dialog never widens the page, so the page-level scroll check in
  // pages.spec cannot see one that runs off a phone. Measure the dialog.
  await signIn(page);
  await page.goto('/');
  if (info.project.name === 'phone') {
    await page.getByRole('button', { name: /Mehr/ }).click();
  }
  await page.getByRole('button', { name: 'Gerät hinzufügen' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Gerät hinzufügen' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await expect(dialog.getByRole('button', { name: 'Schließen' })).toBeInViewport();
});
