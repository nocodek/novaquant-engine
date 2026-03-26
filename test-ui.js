const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('LOG:', msg.text()));
  page.on('pageerror', error => console.log('ERROR:', error.message));
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  
  const hasRange = await page.$('#bt-range');
  console.log("Found bt-range:", !!hasRange);
  
  if (hasRange) {
     await page.click('#bt-range');
     const display = await page.evaluate(() => {
        const cal = document.querySelector('.flatpickr-calendar');
        if (!cal) return 'No calendar element inserted!';
        return 'Calendar is: ' + cal.className + ' | display: ' + getComputedStyle(cal).display + ' | top: ' + cal.style.top + ' | z-index: ' + getComputedStyle(cal).zIndex;
     });
     console.log(display);
  }
  
  await browser.close();
})();
