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
  // district's name label — the labels are non-interactive DOM markers that
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
