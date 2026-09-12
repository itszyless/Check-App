const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, globalShortcut,
        desktopCapturer, shell, screen, nativeImage, dialog } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

autoUpdater.logger = log;
log.transports.file.level = 'info';

let mainWindow = null;
let launcherWindow = null;
let tray = null;
let clipboardHistory = [];
let lastClip = '';

const isWin = process.platform === 'win32';

// ---------- Main Window ----------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: '#0b0d12',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of quitting, unless we're actually quitting the app
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

// ---------- Quick Launcher (global hotkey palette) ----------
function createLauncherWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  launcherWindow = new BrowserWindow({
    width: 560,
    height: 60,
    x: Math.round((width - 560) / 2),
    y: 140,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  launcherWindow.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));

  launcherWindow.on('blur', () => {
    if (launcherWindow && !launcherWindow.webContents.isDevToolsFocused()) {
      launcherWindow.hide();
    }
  });
}

function toggleLauncher() {
  if (!launcherWindow) createLauncherWindow();
  if (launcherWindow.isVisible()) {
    launcherWindow.hide();
  } else {
    launcherWindow.webContents.send('launcher-reset');
    launcherWindow.show();
    launcherWindow.focus();
  }
}

// ---------- Tray ----------
function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.isEmpty() ? path.join(__dirname, 'build', 'icon.ico') : icon);
  const menu = Menu.buildFromTemplate([
    { label: 'Open Check', click: () => { mainWindow.show(); } },
    { label: 'Quick Launcher (Ctrl+Shift+Space)', click: toggleLauncher },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => autoUpdater.checkForUpdatesAndNotify() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setToolTip('Check');
  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); });
}

// ---------- App lifecycle ----------
app.whenReady().then(() => {
  createMainWindow();
  createTray();
  createLauncherWindow();

  globalShortcut.register('CommandOrControl+Shift+Space', toggleLauncher);

  // Poll clipboard for changes (simple, dependency-free clipboard history)
  setInterval(() => {
    const current = clipboard.readText();
    if (current && current !== lastClip) {
      lastClip = current;
      clipboardHistory.unshift({ text: current, time: Date.now() });
      clipboardHistory = clipboardHistory.slice(0, 50);
      if (mainWindow) mainWindow.webContents.send('clipboard-history', clipboardHistory);
    }
  }, 800);

  // Check for updates 5s after launch, then every 30 minutes
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 5000);
  setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 30 * 60 * 1000);
});

app.on('window-all-closed', () => {
  // App lives in the tray; don't quit on window close except on explicit quit
  if (process.platform !== 'darwin' && app.isQuiting) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ---------- Auto-update events -> renderer ----------
function sendUpdateStatus(status, payload) {
  if (mainWindow) mainWindow.webContents.send('update-status', { status, payload });
}
autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info));
autoUpdater.on('update-not-available', () => sendUpdateStatus('not-available'));
autoUpdater.on('download-progress', (p) => sendUpdateStatus('downloading', p));
autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', info));
autoUpdater.on('error', (err) => sendUpdateStatus('error', String(err)));

ipcMain.handle('updates:check', () => autoUpdater.checkForUpdatesAndNotify());
ipcMain.handle('updates:install', () => { app.isQuiting = true; autoUpdater.quitAndInstall(); });

// ---------- Window controls ----------
ipcMain.on('win:minimize', () => mainWindow.minimize());
ipcMain.on('win:maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow.hide());
ipcMain.on('launcher:hide', () => launcherWindow && launcherWindow.hide());

// ---------- System Dashboard ----------
function readWindowsDisks() {
  return new Promise((resolve) => {
    if (!isWin) return resolve([]);
    execFile('wmic', ['logicaldisk', 'get', 'Caption,FreeSpace,Size'], (err, stdout) => {
      if (err) return resolve([]);
      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const disks = [];
      for (const line of lines.slice(1)) {
        const parts = line.split(/\s+/);
        if (parts.length === 3) {
          const [caption, free, size] = parts;
          if (+size > 0) {
            disks.push({ caption, free: +free, size: +size });
          }
        }
      }
      resolve(disks);
    });
  });
}

ipcMain.handle('sys:stats', async () => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disks = await readWindowsDisks();
  return {
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    uptimeSec: os.uptime(),
    cpuModel: cpus[0] ? cpus[0].model : 'Unknown CPU',
    cpuCount: cpus.length,
    loadAvg: os.loadavg(),
    totalMem, freeMem,
    disks
  };
});

// ---------- Temp Cleaner ----------
ipcMain.handle('temp:scan', async () => {
  const dir = os.tmpdir();
  let entries = [];
  try {
    const items = fs.readdirSync(dir);
    for (const name of items) {
      try {
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        entries.push({ name, path: full, size: stat.isDirectory() ? 0 : stat.size, isDir: stat.isDirectory() });
      } catch (_) { /* locked/inaccessible file, skip */ }
    }
  } catch (_) {}
  return { dir, entries };
});

ipcMain.handle('temp:clean', async (_evt, paths) => {
  let cleaned = 0, failed = 0, freed = 0;
  for (const p of paths) {
    try {
      const stat = fs.statSync(p);
      freed += stat.isDirectory() ? 0 : stat.size;
      fs.rmSync(p, { recursive: true, force: true });
      cleaned++;
    } catch (_) { failed++; }
  }
  return { cleaned, failed, freed };
});

// ---------- Startup Manager (Windows Run key) ----------
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

ipcMain.handle('startup:list', async () => {
  if (!isWin) return [];
  return new Promise((resolve) => {
    execFile('reg', ['query', RUN_KEY], (err, stdout) => {
      if (err) return resolve([]);
      const lines = stdout.split(/\r?\n/).filter(l => l.trim().startsWith('') && /REG_SZ|REG_EXPAND_SZ/.test(l));
      const apps = lines.map(l => {
        const match = l.trim().match(/^(.+?)\s+(REG_SZ|REG_EXPAND_SZ)\s+(.+)$/);
        return match ? { name: match[1], command: match[3] } : null;
      }).filter(Boolean);
      resolve(apps);
    });
  });
});

ipcMain.handle('startup:remove', async (_evt, name) => {
  if (!isWin) return { ok: false };
  return new Promise((resolve) => {
    execFile('reg', ['delete', RUN_KEY, '/v', name, '/f'], (err) => {
      resolve({ ok: !err });
    });
  });
});

ipcMain.handle('startup:setSelfAtLogin', async (_evt, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled, path: app.getPath('exe') });
  return app.getLoginItemSettings();
});

ipcMain.handle('startup:getSelfAtLogin', async () => app.getLoginItemSettings());

// ---------- Screenshot ----------
ipcMain.handle('shot:capture', async () => {
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: primary.size
  });
  if (!sources.length) return { ok: false, error: 'No screen source found' };
  const img = sources[0].thumbnail;
  const dir = path.join(app.getPath('pictures'), 'Check Screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `check-${Date.now()}.png`);
  fs.writeFileSync(file, img.toPNG());
  return { ok: true, file };
});

ipcMain.handle('shot:openFolder', async () => {
  const dir = path.join(app.getPath('pictures'), 'Check Screenshots');
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

// ---------- Clipboard ----------
ipcMain.handle('clip:getHistory', () => clipboardHistory);
ipcMain.handle('clip:copy', (_evt, text) => { clipboard.writeText(text); });
ipcMain.handle('clip:clear', () => { clipboardHistory = []; });

// ---------- Quick Launcher pins (persisted in userData) ----------
function pinsFile() { return path.join(app.getPath('userData'), 'pins.json'); }
function loadPins() {
  try { return JSON.parse(fs.readFileSync(pinsFile(), 'utf-8')); } catch (_) { return []; }
}
function savePins(pins) { fs.writeFileSync(pinsFile(), JSON.stringify(pins, null, 2)); }

ipcMain.handle('pins:list', () => loadPins());
ipcMain.handle('pins:add', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  if (res.canceled || !res.filePaths.length) return loadPins();
  const pins = loadPins();
  const filePath = res.filePaths[0];
  pins.push({ name: path.basename(filePath), path: filePath });
  savePins(pins);
  return pins;
});
ipcMain.handle('pins:remove', (_evt, filePath) => {
  const pins = loadPins().filter(p => p.path !== filePath);
  savePins(pins);
  return pins;
});
ipcMain.handle('pins:launch', (_evt, filePath) => {
  shell.openPath(filePath);
  if (launcherWindow) launcherWindow.hide();
});
