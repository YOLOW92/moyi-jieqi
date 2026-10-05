// Electron 主进程：创建窗口并加载打包后的页面。
const { app, BrowserWindow, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

app.setName('墨弈全混揭棋');

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#ebe2cf',
    title: '墨弈·全混揭棋',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // 外部链接不在应用内打开
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // 自动化截图（开发用）：INK_SHOT_SCRIPT 指向一个步骤 JSON
  const script = process.env.INK_SHOT_SCRIPT;
  if (script) {
    win.webContents.once('did-finish-load', async () => {
      const steps = JSON.parse(fs.readFileSync(script, 'utf8'));
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (const step of steps) {
        try {
          if (step.wait) await sleep(step.wait);
          if (step.js) {
            const result = await win.webContents.executeJavaScript(step.js, true);
            if (result !== undefined) console.log('[js]', JSON.stringify(result));
          }
          if (step.shot) {
            const image = await win.webContents.capturePage();
            fs.writeFileSync(step.shot, image.toPNG());
            console.log('[shot]', step.shot);
          }
        } catch (error) {
          console.log('[error]', String(error));
        }
      }
      app.quit();
    });
    win.webContents.on('console-message', (event) => {
      const { level, message } = event;
      if (level === 'error' || level === 'warning' || level === 3 || level === 2) console.log('[console]', message);
    });
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
