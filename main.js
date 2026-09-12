const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  clipboard,
  globalShortcut,
  desktopCapturer,
  shell,
  screen,
  nativeImage,
  dialog
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

const isWin = process.platform === 'win32';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.wmv', '.flv']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif']);

let mainWindow = null;
let launcherWindow = null;
let tray = null;
let clipboardHistory = [];
let lastClipboardSignature = '';
let clipboardTimer = null;
let updaterTimer = null;
let fileProbeRunning = false;
let lastFileProbeAt = 0;

app.setAppUserModelId('com.itszyless.check');

autoUpdater.logger = log;
log.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

function clipboardMediaDir() {
  return userDataFile('clipboard-media');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
  } catch (err) {
    log.warn('Failed writing JSON', file, err);
  }
}

function getAppIcon() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  if (fs.existsSync(iconPath)) return iconPath;
  return undefined;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1000,
    minHeight: 650,
    show: false,
    backgroundColor: '#0a111d',
    frame: false,
    titleBarStyle: 'hidden',
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createLauncherWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  launcherWindow = new BrowserWindow({
    width: 690,
    height: 390,
    x: Math.round(workArea.x + (workArea.width - 690) / 2),
    y: workArea.y + 110,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  launcherWindow.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));
  launcherWindow.on('blur', () => launcherWindow?.hide());
}

function toggleLauncher() {
  if (!launcherWindow) createLauncherWindow();
  if (launcherWindow.isVisible()) {
    launcherWindow.hide();
    return;
  }
  launcherWindow.webContents.send('launcher-reset');
  launcherWindow.show();
  launcherWindow.focus();
}

function createTray() {
  const iconPath = getAppIcon();
  const trayIcon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('Check');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Check', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Quick Launcher', accelerator: 'Ctrl+Shift+Space', click: toggleLauncher },
    { type: 'separator' },
    { label: 'Check for updates', click: () => autoUpdater.checkForUpdatesAndNotify() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
  ]));
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
}

function loadClipboardHistory() {
  const items = readJson(userDataFile('clipboard-history.json'), []);
  clipboardHistory = Array.isArray(items) ? items.filter(Boolean).slice(0, 120) : [];
}

function saveClipboardHistory() {
  writeJson(userDataFile('clipboard-history.json'), clipboardHistory.slice(0, 120));
}

function broadcastClipboard() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clipboard-history', clipboardHistory);
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function classifyPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image-file';
  return 'file';
}

function addClipboardItem(item, dedupeKey) {
  if (!item) return false;
  const key = dedupeKey || item.key || item.text || item.path || item.mediaPath;
  if (!key) return false;

  const normalized = { ...item, id: item.id || makeId(), time: item.time || Date.now(), key };
  if (clipboardHistory[0]?.key === key) return false;

  clipboardHistory = [normalized, ...clipboardHistory.filter((x) => x.key !== key)].slice(0, 120);
  saveClipboardHistory();
  broadcastClipboard();
  return true;
}

function addClipboardText(text) {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean) return false;
  const isLink = /^https?:\/\/\S+$/i.test(clean);
  return addClipboardItem({ type: isLink ? 'link' : 'text', text: clean }, `text:${clean}`);
}

function saveClipboardImage(image) {
  if (!image || image.isEmpty()) return false;
  const png = image.toPNG();
  if (!png.length) return false;
  const hash = crypto.createHash('sha1').update(png).digest('hex');
  fs.mkdirSync(clipboardMediaDir(), { recursive: true });
  const mediaPath = path.join(clipboardMediaDir(), `${hash}.png`);
  if (!fs.existsSync(mediaPath)) fs.writeFileSync(mediaPath, png);
  const size = image.getSize();
  return addClipboardItem({
    type: 'image',
    mediaPath,
    name: `Clipboard image ${size.width}×${size.height}`,
    width: size.width,
    height: size.height,
    size: png.length
  }, `image:${hash}`);
}

function addFilePaths(paths) {
  let changed = false;
  for (const raw of Array.isArray(paths) ? paths : []) {
    if (!raw || typeof raw !== 'string') continue;
    const filePath = path.resolve(raw);
    if (!fs.existsSync(filePath)) continue;
    let stat = null;
    try { stat = fs.statSync(filePath); } catch {}
    const type = stat?.isDirectory() ? 'file' : classifyPath(filePath);
    changed = addClipboardItem({
      type,
      path: filePath,
      name: path.basename(filePath),
      size: stat?.isFile() ? stat.size : 0,
      isDirectory: Boolean(stat?.isDirectory())
    }, `file:${filePath.toLowerCase()}`) || changed;
  }
  return changed;
}

function execFileText(command, args = [], options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 6, ...options }, (err, stdout) => {
      if (err) return resolve('');
      resolve(String(stdout || ''));
    });
  });
}

async function getWindowsClipboardFiles() {
  if (!isWin || fileProbeRunning) return [];
  fileProbeRunning = true;
  try {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$x=[Windows.Forms.Clipboard]::GetFileDropList();',
      'if($x.Count -gt 0){ $x | ConvertTo-Json -Compress }'
    ].join(' ');
    const out = await execFileText('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-Command', script
    ]);
    if (!out.trim()) return [];
    const parsed = JSON.parse(out.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  } finally {
    fileProbeRunning = false;
  }
}

function nativeClipboardSignature() {
  try {
    const formats = clipboard.availableFormats().sort();
    const text = clipboard.readText('clipboard') || '';
    const image = clipboard.readImage('clipboard');
    let imageHash = '';
    if (image && !image.isEmpty()) {
      const small = image.resize({ width: 48, quality: 'good' }).toPNG();
      imageHash = crypto.createHash('sha1').update(small).digest('hex');
    }
    return crypto.createHash('sha1').update(`${formats.join('|')}\n${text}\n${imageHash}`).digest('hex');
  } catch {
    return '';
  }
}

async function pollClipboard() {
  try {
    const sig = nativeClipboardSignature();
    const formats = clipboard.availableFormats();
    const text = clipboard.readText('clipboard') || '';
    const image = clipboard.readImage('clipboard');

    if (sig && sig !== lastClipboardSignature) {
      lastClipboardSignature = sig;
      let captured = false;
      if (image && !image.isEmpty()) captured = saveClipboardImage(image) || captured;
      if (text.trim()) captured = addClipboardText(text) || captured;

      const hasFileishFormat = formats.some((f) => /FileName|FileDrop|Shell IDList|Preferred DropEffect|filename/i.test(f));
      if (hasFileishFormat && isWin) {
        const files = await getWindowsClipboardFiles();
        captured = addFilePaths(files) || captured;
      }
      return captured;
    }

    // Explorer often keeps identical format names between different copied files,
    // so do a throttled file-drop probe while the clipboard looks file-like.
    const hasFileishFormat = formats.some((f) => /FileName|FileDrop|Shell IDList|Preferred DropEffect|filename/i.test(f));
    if (hasFileishFormat && isWin && Date.now() - lastFileProbeAt > 1200) {
      lastFileProbeAt = Date.now();
      const files = await getWindowsClipboardFiles();
      addFilePaths(files);
    }
  } catch (err) {
    log.warn('Clipboard poll failed', err);
  }
}

function startClipboardWatcher() {
  loadClipboardHistory();
  lastClipboardSignature = nativeClipboardSignature();
  clearInterval(clipboardTimer);
  clipboardTimer = setInterval(() => { void pollClipboard(); }, 500);
}

function safeDeleteMedia(item) {
  if (!item?.mediaPath) return;
  try {
    const root = path.resolve(clipboardMediaDir());
    const target = path.resolve(item.mediaPath);
    if (target.startsWith(`${root}${path.sep}`) && fs.existsSync(target)) fs.rmSync(target, { force: true });
  } catch {}
}

async function readWindowsDisks() {
  if (!isWin) return [];
  const script = [
    '$d = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" |',
    'Select-Object DeviceID,FreeSpace,Size;',
    '$d | ConvertTo-Json -Compress'
  ].join(' ');
  const out = await execFileText('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ]);
  try {
    if (!out.trim()) return [];
    const parsed = JSON.parse(out.trim());
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((d) => ({ caption: d.DeviceID, free: Number(d.FreeSpace || 0), size: Number(d.Size || 0) })).filter((d) => d.size > 0);
  } catch {
    return [];
  }
}

function cpuSnapshot() {
  return os.cpus().map((cpu) => ({ ...cpu.times }));
}

function calculateCpuUsage(before, after) {
  if (!before?.length || before.length !== after?.length) return 0;
  let idle = 0;
  let total = 0;
  for (let i = 0; i < after.length; i++) {
    const b = before[i];
    const a = after[i];
    const bTotal = b.user + b.nice + b.sys + b.idle + b.irq;
    const aTotal = a.user + a.nice + a.sys + a.idle + a.irq;
    idle += a.idle - b.idle;
    total += aTotal - bTotal;
  }
  return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : 0;
}

async function getSystemStats() {
  const before = cpuSnapshot();
  await new Promise((r) => setTimeout(r, 180));
  const after = cpuSnapshot();
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disks = await readWindowsDisks();
  return {
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    username: os.userInfo().username,
    uptimeSec: os.uptime(),
    cpuModel: cpus[0]?.model || 'Unknown CPU',
    cpuCount: cpus.length,
    cpuUsage: calculateCpuUsage(before, after),
    totalMem,
    freeMem,
    disks
  };
}

function sendUpdateStatus(status, payload = null) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', { status, payload });
}

app.whenReady().then(async () => {
  createMainWindow();
  createTray();
  createLauncherWindow();
  startClipboardWatcher();
  globalShortcut.register('CommandOrControl+Shift+Space', toggleLauncher);

  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 7000);
    updaterTimer = setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 30 * 60 * 1000);
  }
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
  mainWindow.show();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && app.isQuiting) app.quit();
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(clipboardTimer);
  clearInterval(updaterTimer);
});

autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) => sendUpdateStatus('available', info));
autoUpdater.on('update-not-available', (info) => sendUpdateStatus('not-available', info));
autoUpdater.on('download-progress', (progress) => sendUpdateStatus('downloading', progress));
autoUpdater.on('update-downloaded', (info) => sendUpdateStatus('downloaded', info));
autoUpdater.on('error', (err) => { log.error('Updater error', err); sendUpdateStatus('error', String(err?.message || err)); });

ipcMain.handle('app:info', () => ({ version: app.getVersion(), name: app.getName(), packaged: app.isPackaged }));
ipcMain.handle('updates:check', async () => app.isPackaged ? autoUpdater.checkForUpdatesAndNotify() : { dev: true });
ipcMain.handle('updates:install', () => { app.isQuiting = true; autoUpdater.quitAndInstall(false, true); });

ipcMain.on('win:minimize', () => mainWindow?.minimize());
ipcMain.on('win:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('win:close', () => mainWindow?.hide());
ipcMain.on('launcher:hide', () => launcherWindow?.hide());

ipcMain.handle('sys:stats', getSystemStats);

ipcMain.handle('temp:scan', async () => {
  const dir = path.resolve(os.tmpdir());
  const entries = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        const stat = fs.statSync(full);
        entries.push({ name, path: full, size: stat.isDirectory() ? 0 : stat.size, isDir: stat.isDirectory(), modified: stat.mtimeMs });
      } catch {}
    }
  } catch {}
  return { dir, entries };
});

ipcMain.handle('temp:clean', async (_event, paths) => {
  const tempRoot = path.resolve(os.tmpdir());
  let cleaned = 0;
  let failed = 0;
  let freed = 0;
  for (const rawPath of Array.isArray(paths) ? paths : []) {
    try {
      const target = path.resolve(rawPath);
      if (target === tempRoot || !target.startsWith(`${tempRoot}${path.sep}`)) { failed++; continue; }
      const stat = fs.statSync(target);
      if (!stat.isDirectory()) freed += stat.size;
      fs.rmSync(target, { recursive: true, force: true });
      cleaned++;
    } catch { failed++; }
  }
  return { cleaned, failed, freed };
});

ipcMain.handle('startup:list', async () => {
  if (!isWin) return [];
  const stdout = await execFileText('reg.exe', ['query', RUN_KEY]);
  const rows = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(.+?)\s+(REG_SZ|REG_EXPAND_SZ)\s+(.+)$/);
    if (match) rows.push({ name: match[1], command: match[3] });
  }
  return rows;
});

ipcMain.handle('startup:remove', async (_event, name) => {
  if (!isWin || typeof name !== 'string' || !name.trim()) return { ok: false };
  return new Promise((resolve) => {
    execFile('reg.exe', ['delete', RUN_KEY, '/v', name, '/f'], { windowsHide: true }, (err) => resolve({ ok: !err }));
  });
});

ipcMain.handle('startup:setSelfAtLogin', async (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: app.getPath('exe') });
  return app.getLoginItemSettings();
});
ipcMain.handle('startup:getSelfAtLogin', async () => app.getLoginItemSettings());

ipcMain.handle('shot:capture', async () => {
  try {
    const primary = screen.getPrimaryDisplay();
    const scale = primary.scaleFactor || 1;
    const thumbnailSize = { width: Math.round(primary.size.width * scale), height: Math.round(primary.size.height * scale) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    if (!sources.length) return { ok: false, error: 'No screen source found' };
    const dir = path.join(app.getPath('pictures'), 'Check Screenshots');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `check-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    fs.writeFileSync(file, sources[0].thumbnail.toPNG());
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle('shot:openFolder', async () => {
  const dir = path.join(app.getPath('pictures'), 'Check Screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return { ok: true };
});

ipcMain.handle('clip:getHistory', () => clipboardHistory);
ipcMain.handle('clip:refresh', async () => { await pollClipboard(); return clipboardHistory; });
ipcMain.handle('clip:preview', (_event, id) => {
  const item = clipboardHistory.find((x) => x.id === id);
  if (!item) return null;
  const sourcePath = item.mediaPath || ((item.type === 'image-file' && item.path) ? item.path : null);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  try {
    const image = nativeImage.createFromPath(sourcePath);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    const width = Math.min(760, size.width || 760);
    return image.resize({ width, quality: 'good' }).toDataURL();
  } catch {
    return null;
  }
});

ipcMain.handle('clip:copyItem', async (_event, id) => {
  const item = clipboardHistory.find((x) => x.id === id);
  if (!item) return { ok: false };
  try {
    if (item.type === 'text' || item.type === 'link') {
      clipboard.writeText(item.text || '');
    } else if (item.type === 'image' && item.mediaPath && fs.existsSync(item.mediaPath)) {
      const image = nativeImage.createFromPath(item.mediaPath);
      if (image.isEmpty()) return { ok: false };
      clipboard.writeImage(image);
    } else if (item.path && fs.existsSync(item.path) && isWin) {
      const escaped = item.path.replace(/'/g, "''");
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms;',
        '$c=New-Object System.Collections.Specialized.StringCollection;',
        `$null=$c.Add('${escaped}');`,
        '[Windows.Forms.Clipboard]::SetFileDropList($c);'
      ].join(' ');
      await execFileText('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-Command', script]);
    } else if (item.path) {
      clipboard.writeText(item.path);
    } else {
      return { ok: false };
    }
    lastClipboardSignature = nativeClipboardSignature();
    return { ok: true };
  } catch {
    return { ok: false };
  }
});

ipcMain.handle('clip:openItem', async (_event, id) => {
  const item = clipboardHistory.find((x) => x.id === id);
  if (!item) return { ok: false };
  if (item.type === 'link' && item.text) {
    await shell.openExternal(item.text);
    return { ok: true };
  }
  const target = item.path || item.mediaPath;
  if (!target) return { ok: false };
  const error = await shell.openPath(target);
  return { ok: !error, error };
});

ipcMain.handle('clip:showItem', async (_event, id) => {
  const item = clipboardHistory.find((x) => x.id === id);
  const target = item?.path || item?.mediaPath;
  if (!target || !fs.existsSync(target)) return { ok: false };
  shell.showItemInFolder(target);
  return { ok: true };
});

ipcMain.handle('clip:remove', (_event, id) => {
  const item = clipboardHistory.find((x) => x.id === id);
  safeDeleteMedia(item);
  clipboardHistory = clipboardHistory.filter((x) => x.id !== id);
  saveClipboardHistory();
  broadcastClipboard();
  return clipboardHistory;
});
ipcMain.handle('clip:clear', () => {
  for (const item of clipboardHistory) safeDeleteMedia(item);
  clipboardHistory = [];
  saveClipboardHistory();
  broadcastClipboard();
  return [];
});

function pinsFile() { return userDataFile('pins.json'); }
function loadPins() { const pins = readJson(pinsFile(), []); return Array.isArray(pins) ? pins : []; }
function savePins(pins) { writeJson(pinsFile(), pins); }

ipcMain.handle('pins:list', () => loadPins());
ipcMain.handle('pins:add', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Pin an app or file', properties: ['openFile'] });
  if (result.canceled || !result.filePaths.length) return loadPins();
  const filePath = result.filePaths[0];
  const pins = loadPins();
  if (!pins.some((pin) => pin.path === filePath)) {
    pins.push({ name: path.basename(filePath), path: filePath });
    savePins(pins);
  }
  return pins;
});
ipcMain.handle('pins:remove', (_event, filePath) => {
  const pins = loadPins().filter((pin) => pin.path !== filePath);
  savePins(pins);
  return pins;
});
ipcMain.handle('pins:launch', async (_event, filePath) => {
  if (typeof filePath !== 'string') return { ok: false };
  const error = await shell.openPath(filePath);
  launcherWindow?.hide();
  return { ok: !error, error };
});
