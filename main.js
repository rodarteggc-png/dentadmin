const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'caredent-config.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadURL('http://localhost:3000');
}

function createSetupWindow() {
  const setupWin = new BrowserWindow({
    width: 500,
    height: 400,
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  setupWin.setMenuBarVisibility(false);
  setupWin.loadFile('setup.html');

  ipcMain.handle('dialog:selectFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(setupWin, {
      properties: ['openDirectory']
    });
    if (canceled) return null;
    return filePaths[0];
  });

  ipcMain.on('setup:finish', (event, dataPath) => {
    fs.writeFileSync(configPath, JSON.stringify({ dataPath }));
    process.env.CAREDENT_DATA_PATH = dataPath;
    require('./server.js');
    setupWin.close();
    createWindow();
  });
}

app.whenReady().then(() => {
  let config = null;
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch(e){}
  }

  if (config && config.dataPath) {
    process.env.CAREDENT_DATA_PATH = config.dataPath;
    require('./server.js');
    createWindow();
  } else {
    createSetupWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});