// Rasterize the reference source icons for Hentoid's HTTP-404 placeholder mode.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const root = path.resolve('artifacts', 'icon-render');
fs.mkdirSync(root, { recursive: true }); app.setPath('userData', root); app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  fs.mkdirSync(path.resolve('src/assets'), { recursive: true });
  for (const site of ['ehentai', 'exhentai', 'hitomi']) {
    const $ = load(fs.readFileSync(`Hentoid/app/src/main/res/drawable/ic_site_${site}.xml`, 'utf8'), { xml: true });
    const paths = $('path').map((_, el) => `<path fill="#e7a0a0" d="${$(el).attr('android:pathData')}"/>`).get().join('');
    const vector = $('vector');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 ${vector.attr('android:viewportWidth')} ${vector.attr('android:viewportHeight')}">${paths}</svg>`;
    const png = await win.webContents.executeJavaScript(`(async () => { const img = new Image(); img.src = ${JSON.stringify('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))}; await img.decode(); const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; canvas.getContext('2d').drawImage(img, 0, 0, 256, 256); return canvas.toDataURL('image/png').split(',')[1]; })()`);
    fs.writeFileSync(`src/assets/missing-${site}.png`, Buffer.from(png, 'base64'));
  }
  win.close(); app.quit(); console.log('Generated source-icon placeholders.');
}).catch(error => { console.error(error); app.exit(1); });
