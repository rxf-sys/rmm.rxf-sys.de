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

test('a click beside a device checkbox selects instead of opening the device', async ({ page }) => {
  await signIn(page);
  await page.goto('/devices');
  const box = page.getByRole('checkbox', { name: 'nas-keller auswählen' });
  // The label around the box: the table cell on desktop, the strip down the
  // card's left edge on a phone, above the card's stretched link.
  const label = box.locator('xpath=..');
  const area = await label.boundingBox();
  const own = await box.boundingBox();
  expect(area && own).toBeTruthy();
  expect(area!.height).toBeGreaterThan(own!.height + 16);
  // A near miss, well below the box. Playwright clicks only once the label
  // itself receives the pointer there, not the stretched link or the boot
  // overlay on top of it.
  await label.click({ position: { x: 4, y: area!.height - 4 } });
  await expect(box).toBeChecked();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByRole('region', { name: 'Auswahl' })).toContainText('1 ausgewählt');
});

for (const [path, label] of [
  ['/devices?sort=name', 'device list'],
  ['/patches', 'patches page'],
] as const) {
  test(`Shift-click beside a checkbox selects the range on the ${label}`, async ({ page }) => {
    await signIn(page);
    await page.goto(path);
    const boxes = page.getByRole('checkbox', { name: /^(?!Alle ).+ auswählen$/ });
    // A caret somewhere in the page text, as any earlier click leaves one:
    // with it, Chromium keeps a Shift-click on a label for text selection
    // instead of handing it to the checkbox.
    await page.getByRole('heading', { level: 1 }).click();
    for (const [i, modifiers] of [[0, []], [2, ['Shift']]] as const) {
      const label = boxes.nth(i).locator('xpath=..');
      const area = await label.boundingBox();
      await label.click({ position: { x: 4, y: area!.height - 4 }, modifiers: [...modifiers] });
    }
    await expect(page.getByRole('region', { name: 'Auswahl' })).toContainText('3 ausgewählt');
    await expect(boxes.nth(1)).toBeChecked();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  });
}

test('saving a view by keyboard keeps focus in the views panel', async ({ page }) => {
  // "Speichern" empties the name and so disables itself while focused; the
  // browser drops focus to <body>, and the next Tab would start over at the
  // top of the page with the panel still open.
  await signIn(page);
  await page.goto('/devices');
  await page.getByRole('button', { name: /Ansichten/ }).click();
  const panel = page.getByRole('dialog', { name: 'Ansichten' });
  await panel.getByLabel('Aktuelle Ansicht speichern').fill('Server');
  await panel.getByRole('button', { name: 'Speichern' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await page.keyboard.press('Tab');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
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
  // By name: the overview has comboboxes of its own (the Lagebild's person filter).
  const box = page.getByRole('combobox', { name: 'Gerät, Seite oder Aktion' });
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

test('updates queued for an offline device wait for it and show up on the patches page', async ({ page }) => {
  await signIn(page);
  await page.goto('/devices/2?tab=patches');
  const panel = page.getByRole('region', { name: 'Beim nächsten Online-Gehen' });
  await panel.getByRole('checkbox', { name: 'nur Sicherheitsupdates' }).check();
  await panel.getByRole('button', { name: 'Vormerken' }).click();
  const queued = panel.getByRole('list', { name: 'Vorgemerkte Aktionen' });
  await expect(queued.getByText('Sicherheitsupdates installieren')).toBeVisible();
  await expect(queued.getByText('Wartet auf das Gerät')).toBeVisible();

  await page.goto('/patches');
  await expect(page.getByText('vorgemerkt').first()).toBeVisible();

  // Withdrawn again, so the seeded fleet stays as other tests expect it.
  await page.goto('/devices/2?tab=patches');
  await page.getByRole('button', { name: 'Zurückziehen' }).click();
  await expect(page.getByRole('list', { name: 'Vorgemerkte Aktionen' }).getByText('Zurückgezogen')).toBeVisible();
});

test('a reachable iPad under MDM is OK, reports on its overview and is set up in its MDM tab', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'same data on every size');
  await signIn(page);
  await page.goto('/devices/12');
  await expect(page.getByRole('region', { name: 'Sicherheit' }).getByText('Gerätecode gesetzt')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Apps' }).getByText('Kochbuch')).toBeVisible();
  // Commands sit in the header menu.
  await page.getByRole('button', { name: 'Weitere Aktionen' }).click();
  await expect(page.getByRole('menuitem', { name: /Sperren/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/devices/12?tab=mdm');
  await expect(page.getByRole('switch', { name: 'Löschen erlauben' })).toBeChecked();
  await expect(page.getByRole('region', { name: 'Profile' })).toBeVisible();

  await page.goto('/devices');
  await expect(page.getByRole('row', { name: /iPad Küche/ }).getByText('OK', { exact: true })).toBeVisible();

  await page.goto('/patches');
  await expect(page.getByText('iPhone und iPad')).toBeVisible();
});
