const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const countBlackPixels = async () => page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'));
    let total = 0;
    for (const c of canvases) {
      try {
        const ctx = c.getContext('2d');
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < data.length; i += 4) {
          const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
          if (a>0 && r<20 && g<20 && b<20) total++;
        }
      } catch(e){}
    }
    return total;
  });

  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const c = await countBlackPixels();
    console.log(`t=${(i+1)}s black=${c}`);
  }
  await page.screenshot({ path: 'trace_final.png' });
  await browser.close();
})();
