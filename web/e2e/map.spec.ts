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

  const districtPath = page.locator('.leaflet-container path').first();
  await expect(districtPath).toBeVisible({ timeout: 15000 });
  await districtPath.click({ force: true });

  await expect(page.getByText('Component Scores', { exact: false })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/Population:/)).toBeVisible();
});

test('changing the score selector updates the legend title', async ({ page }) => {
  await page.goto('/');

  const select = page.getByLabel('Color districts by');
  await expect(select).toBeVisible();

  await expect(page.getByText('Overall Health Score')).toBeVisible();

  await select.selectOption('safety');
  await expect(page.getByText('Safety', { exact: true })).toBeVisible();
});
