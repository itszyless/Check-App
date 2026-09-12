// ---------- helpers ----------
function toast(msg) {
  const stack = document.getElementById('toast-stack');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function fmtBytes(n) {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${units[i]}`;
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ---------- window controls ----------
document.getElementById('min-btn').onclick = () => window.check.winMinimize();
document.getElementById('max-btn').onclick = () => window.check.winMaximize();
document.getElementById('close-btn').onclick = () => window.check.winClose();

// ---------- navigation ----------
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach(btn => {
  btn.addEventListener('click', () => {
    navItems.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + btn.dataset.page);
    page.classList.add('active');
    onPageShown(btn.dataset.page);
  });
});

function onPageShown(page) {
  if (page === 'dashboard') refreshStats();
  if (page === 'startup') refreshStartup();
  if (page === 'launcher') refreshPins();
  if (page === 'settings') refreshSettings();
}

// ---------- dashboard ----------
async function refreshStats() {
  const s = await window.check.getStats();
  const grid = document.getElementById('stats-grid');
  const memUsed = s.totalMem - s.freeMem;
  const memPct = Math.round((memUsed / s.totalMem) * 100);

  let disksHtml = '';
  s.disks.forEach((d, i) => {
    const used = d.size - d.free;
    const pct = Math.round((used / d.size) * 100);
    disksHtml += `
      <div class="card" style="animation-delay:${0.05 * (i + 3)}s">
        <div class="label">Drive ${d.caption}</div>
        <div class="value">${fmtBytes(used)} / ${fmtBytes(d.size)}</div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  });

  grid.innerHTML = `
    <div class="card" style="animation-delay:.02s">
      <div class="label">Memory</div>
      <div class="value">${memPct}%</div>
      <div class="bar"><div class="bar-fill" style="width:${memPct}%"></div></div>
    </div>
    <div class="card" style="animation-delay:.06s">
      <div class="label">CPU</div>
      <div class="value">${s.cpuCount} cores</div>
      <div class="meta" style="color:var(--text-dim);font-size:11.5px;margin-top:6px">${s.cpuModel}</div>
    </div>
    <div class="card" style="animation-delay:.10s">
      <div class="label">Uptime</div>
      <div class="value">${fmtUptime(s.uptimeSec)}</div>
    </div>
    <div class="card" style="animation-delay:.14s">
      <div class="label">System</div>
      <div class="value" style="font-size:15px">${s.platform}</div>
      <div class="meta" style="color:var(--text-dim);font-size:11.5px;margin-top:6px">${s.hostname}</div>
    </div>
    ${disksHtml}
  `;
}
setInterval(() => {
  if (document.getElementById('page-dashboard').classList.contains('active')) refreshStats();
}, 4000);

// ---------- clipboard ----------
function renderClipboard(history) {
  const list = document.getElementById('clip-list');
  if (!history.length) { list.innerHTML = `<div class="sub">No clipboard history yet — copy something!</div>`; return; }
  list.innerHTML = history.map((c, i) => `
    <div class="list-item" style="animation-delay:${i * 0.02}s">
      <span>${escapeHtml(c.text).slice(0, 90)}</span>
      <button data-idx="${i}" class="copy-again">Copy</button>
    </div>
  `).join('');
  list.querySelectorAll('.copy-again').forEach(btn => {
    btn.onclick = () => {
      const item = history[+btn.dataset.idx];
      window.check.copyToClipboard(item.text);
      toast('Copied to clipboard');
    };
  });
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

window.check.onClipboardHistory(renderClipboard);
window.check.getClipboardHistory().then(renderClipboard);
document.getElementById('clear-clip').onclick = async () => {
  await window.check.clearClipboardHistory();
  renderClipboard([]);
  toast('Clipboard history cleared');
};

// ---------- temp cleaner ----------
let tempEntries = [];
document.getElementById('scan-temp').onclick = async () => {
  const { dir, entries } = await window.check.scanTemp();
  tempEntries = entries;
  document.getElementById('temp-path').textContent = dir;
  const list = document.getElementById('temp-list');
  if (!entries.length) { list.innerHTML = `<div class="sub">Nothing found (or scan blocked by permissions).</div>`; return; }
  list.innerHTML = entries.map((e, i) => `
    <div class="list-item" style="animation-delay:${i * 0.01}s">
      <span><input type="checkbox" data-idx="${i}" class="temp-check" />${escapeHtml(e.name)}</span>
      <span class="meta">${e.isDir ? 'folder' : fmtBytes(e.size)}</span>
    </div>
  `).join('');
};
document.getElementById('clean-temp').onclick = async () => {
  const checked = [...document.querySelectorAll('.temp-check:checked')].map(c => tempEntries[+c.dataset.idx].path);
  if (!checked.length) { toast('Select items to clean first'); return; }
  const res = await window.check.cleanTemp(checked);
  toast(`Cleaned ${res.cleaned} items · freed ${fmtBytes(res.freed)}`);
  document.getElementById('scan-temp').click();
};

// ---------- startup manager ----------
async function refreshStartup() {
  const apps = await window.check.listStartup();
  const list = document.getElementById('startup-list');
  if (!apps.length) { list.innerHTML = `<div class="sub">No startup entries found (Windows only, or none registered).</div>`; return; }
  list.innerHTML = apps.map((a, i) => `
    <div class="list-item" style="animation-delay:${i * 0.02}s">
      <span>${escapeHtml(a.name)}<div class="meta">${escapeHtml(a.command).slice(0, 70)}</div></span>
      <button data-name="${escapeHtml(a.name)}" class="remove-startup">Remove</button>
    </div>
  `).join('');
  list.querySelectorAll('.remove-startup').forEach(btn => {
    btn.onclick = async () => {
      await window.check.removeStartup(btn.dataset.name);
      toast(`Removed "${btn.dataset.name}" from startup`);
      refreshStartup();
    };
  });
}

// ---------- screenshot ----------
document.getElementById('take-shot').onclick = async () => {
  const res = await window.check.takeScreenshot();
  if (res.ok) {
    toast('Screenshot saved');
    document.getElementById('shot-preview').innerHTML = `<div class="sub">Saved to: ${res.file}</div>`;
  } else {
    toast('Screenshot failed: ' + res.error);
  }
};
document.getElementById('open-shot-folder').onclick = () => window.check.openScreenshotFolder();

// ---------- quick launcher pins ----------
async function refreshPins() {
  const pins = await window.check.listPins();
  const list = document.getElementById('pins-list');
  if (!pins.length) { list.innerHTML = `<div class="sub">No pins yet. Add an app or file to launch it instantly.</div>`; return; }
  list.innerHTML = pins.map((p, i) => `
    <div class="list-item" style="animation-delay:${i * 0.02}s">
      <span>${escapeHtml(p.name)}<div class="meta">${escapeHtml(p.path)}</div></span>
      <button data-path="${escapeHtml(p.path)}" class="remove-pin">Remove</button>
    </div>
  `).join('');
  list.querySelectorAll('.remove-pin').forEach(btn => {
    btn.onclick = async () => { await window.check.removePin(btn.dataset.path); refreshPins(); };
  });
}
document.getElementById('add-pin').onclick = async () => { await window.check.addPin(); refreshPins(); };

// ---------- settings ----------
async function refreshSettings() {
  const s = await window.check.getSelfAtLogin();
  document.getElementById('login-toggle').checked = !!s.openAtLogin;
}
document.getElementById('login-toggle').onchange = async (e) => {
  await window.check.setSelfAtLogin(e.target.checked);
  toast(e.target.checked ? 'Check will launch at login' : 'Removed from login items');
};
document.getElementById('check-updates-btn').onclick = () => window.check.checkForUpdates();
document.getElementById('install-update-btn').onclick = () => window.check.installUpdate();

// ---------- update status (badge + settings) ----------
const pill = document.getElementById('update-pill');
const pillText = document.getElementById('update-pill-text');
const statusText = document.getElementById('update-status-text');
const installRow = document.getElementById('install-update-row');

window.check.onUpdateStatus(({ status, payload }) => {
  pill.hidden = false;
  if (status === 'checking') { pillText.textContent = 'Checking for updates…'; }
  if (status === 'available') { pillText.textContent = `Downloading v${payload.version}…`; statusText.textContent = `Update v${payload.version} found, downloading…`; }
  if (status === 'not-available') { pillText.textContent = 'Up to date'; statusText.textContent = 'Up to date.'; setTimeout(() => pill.hidden = true, 2500); }
  if (status === 'downloading') { pillText.textContent = `Downloading… ${Math.round(payload.percent)}%`; }
  if (status === 'downloaded') {
    pillText.textContent = 'Update ready — restart to install';
    statusText.textContent = `Version ${payload.version} downloaded.`;
    installRow.hidden = false;
    toast('Update downloaded — restart anytime to install');
  }
  if (status === 'error') {
    pillText.textContent = 'Update check unavailable';
    statusText.textContent = 'Automatic updates aren\'t available for this build — check back with whoever sent you the app for new versions.';
    setTimeout(() => pill.hidden = true, 2500);
  }
});

// ---------- init ----------
refreshStats();
