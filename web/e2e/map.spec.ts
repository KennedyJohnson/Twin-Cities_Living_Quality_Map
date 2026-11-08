import { test, expect } from '@playwright/test';

test('homepage loads with map, search, and legend', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByPlaceholder(/search for an address/i)).toBeVisible();
  await expect(page.locator('.leaflet-container')).toBeVisible();
  await expect(page.getByText('Data Points')).toBeVisible();
  await expect(page.getByLabel('Color districts by')).toBeVisible();

  // District boundaries should render as SVG paths once GeoJSON loads.
  await expect(page.locator('.leaflet-container path').first()).toBeVisible({ timeout: 15000 });
});

test('clicking a district shows details in the sidebar', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Click a district on the map to view details')).toBeVisible();

  // District polygons are drawn on a canvas (no DOM paths), so click at a
  // district's name label - the labels are non-interactive DOM markers that
  // pass clicks through to the map underneath.
  const label = page.locator('.district-name-label').first();
  await expect(label).toBeVisible({ timeout: 15000 });
  const box = await label.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await expect(page.getByText('Component Scores', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Population:/)).toBeVisible();
});

test('changing the score selector updates the legend title', async ({ page }) => {
  await page.goto('/');

  const select = page.getByLabel('Color districts by');
  await expect(select).toBeVisible();

  const legendTitle = page.locator('.legend-title').first();
  await expect(legendTitle).toHaveText('Overall Living Quality Score');

  await select.selectOption('safety');
  await expect(legendTitle).toHaveText('Safety & Health');
});

test('personal weights in the URL hash apply on load', async ({ page }) => {
  await page.goto('/#weights=safety:10,opportunity:0,amenities:0,transportation:0,affordability:0');

  await page.getByText('Show personal weights').click();
  await expect(page.getByLabel('Safety & Health weight')).toHaveValue('10');
  await expect(page.getByLabel('Opportunity weight')).toHaveValue('0');
  await expect(page.getByText('Your Weighted Score').first()).toBeVisible({ timeout: 15000 });
});

test('moving a personal weight slider updates the hash, reset clears it', async ({ page }) => {
  await page.goto('/');

  await page.getByText('Show personal weights').click();
  const slider = page.getByLabel('Transportation weight');
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('2');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('transportation:2');

  await page.getByRole('button', { name: 'Reset to equal weights' }).click();
  await expect(slider).toHaveValue('5');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe('');
});

test('compare mode: pick a second district, then switching map view exits compare', async ({ page }) => {
  await page.goto('/');

  const labels = page.locator('.district-name-label');
  await expect(labels.nth(1)).toBeVisible({ timeout: 15000 });
  const clickLabel = async (i: number) => {
    const box = await labels.nth(i).boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  };

  await clickLabel(0);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('button', { name: /Click another district/ })).toBeVisible();
  await clickLabel(1);
  await expect(page.getByRole('button', { name: 'Exit compare' }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/^vs /).first()).toBeVisible();

  // Switching District -> ZIP clears the selection, so compare must end too.
  await page.getByRole('button', { name: 'ZIP Code' }).click();
  await expect(page.getByRole('button', { name: 'Exit compare' })).toHaveCount(0);
  await expect(page.getByText(/^vs /)).toHaveCount(0);
});

test('compare mode: switching map view while picking cancels the pick', async ({ page }) => {
  await page.goto('/');

  const label = page.locator('.district-name-label').first();
  await expect(label).toBeVisible({ timeout: 15000 });
  const box = await label.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();

  await page.getByRole('button', { name: 'ZIP Code' }).click();
  const zip = page.locator('.district-name-label').first();
  await expect(zip).toBeVisible({ timeout: 15000 });
  const zbox = await zip.boundingBox();
  await page.mouse.click(zbox!.x + zbox!.width / 2, zbox!.y + zbox!.height / 2);

  // A fresh selection starts out of compare mode, not still waiting for a second pick.
  await expect(page.getByRole('button', { name: 'Compare', exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /Click another/ })).toHaveCount(0);
});
