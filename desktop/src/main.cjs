// MuziQuiz for Windows: runs the quiz server inside the app and opens the host space.
// Players still join from their phone browser using the QR code or PIN.
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const server = require('./server.cjs');

const CREATOR_URL = 'https://www.linkedin.com/in/m-muzammal-muzi5622/';
const STAGE = '#1a1226';
// Added by the page's "Open in browser" button (client/src/desktop.tsx).
const OPEN_IN_BROWSER = '#open-in-browser';

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.muzi.muziquiz');

let running = null;
let quitting = false;

const userFolder = () => app.getPath('userData');
const dataDir = () => path.join(userFolder(), 'data');
const appOrigin = () => `http://localhost:${running.port}`;

// Optional settings (PORT, MAX_PLAYERS_PER_DEVICE, RESERVED_JOIN_CODE_HASH) live in %APPDATA%\MuziQuiz\.env.
function loadSettings() {
  const file = path.join(userFolder(), '.env');
  try { if (fs.existsSync(file)) process.loadEnvFile(file); }
  catch (error) { dialog.showErrorBox('Settings file ignored', `${file}\n\n${error.message}`); }
}
function candidatePorts() {
  const preferred = Number(process.env.PORT ?? 3000);
  const base = Number.isInteger(preferred) && preferred > 0 && preferred < 65526 ? preferred : 3000;
  return Array.from({ length: 10 }, (_, index) => base + index);
}

// Only this app's own pages open inside MuziQuiz; everything else goes to the default browser.
function isOwnPage(url) {
  try {
    const target = new URL(url);
    if (target.port !== String(running.port)) return false;
    return ['localhost', '127.0.0.1'].includes(target.hostname) || server.lanUrls(running.port).some(lan => new URL(lan).hostname === target.hostname);
  } catch { return false; }
}
function openOutside(url) { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); }
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.endsWith(OPEN_IN_BROWSER)) {
      const page = url.slice(0, -OPEN_IN_BROWSER.length);
      if (isOwnPage(page)) void shell.openExternal(page);
      return { action: 'deny' };
    }
    if (isOwnPage(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 800, backgroundColor: STAGE, autoHideMenuBar: true, icon: path.join(__dirname, 'icon.png') } };
    openOutside(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!isOwnPage(url)) { event.preventDefault(); openOutside(url); } });
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, title: 'MuziQuiz', backgroundColor: STAGE,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  void window.loadURL(`${appOrigin()}/host`);
  return window;
}
function mainWindow() { return BrowserWindow.getAllWindows()[0] ?? createWindow(); }

async function resetPassword() {
  const { response } = await dialog.showMessageBox(mainWindow(), {
    type: 'warning', buttons: ['Cancel', 'Reset password'], defaultId: 0, cancelId: 0, title: 'Reset host password',
    message: 'Reset the host password?', detail: 'Your quizzes and saved results stay. MuziQuiz will ask you to create a new password on this laptop.'
  });
  if (response !== 1) return;
  try { server.resetHostPassword(dataDir()); }
  catch (error) { dialog.showErrorBox('Reset failed', error.message); return; }
  void mainWindow().loadURL(`${appOrigin()}/host`);
}
function showAddresses() {
  const urls = server.lanUrls(running.port);
  void dialog.showMessageBox(mainWindow(), {
    type: 'info', title: 'Player join addresses', message: 'Players open one of these on the same Wi-Fi, or scan the QR code in the lobby:',
    detail: `${urls.length ? urls.join('\n') : 'No Wi-Fi or network adapter found. Connect this laptop to the network players use.'}\n\nIf phones cannot connect, allow MuziQuiz through Windows Firewall for private networks.`
  });
}
async function about() {
  const { response } = await dialog.showMessageBox(mainWindow(), {
    type: 'info', buttons: ['OK', 'MUZI on LinkedIn'], defaultId: 0, title: 'About MuziQuiz',
    message: `MuziQuiz ${app.getVersion()}`, detail: `Live quizzes on your local Wi-Fi. Players join from any phone browser.\n\nMade by MUZI.\nData folder: ${userFolder()}`
  });
  if (response === 1) void shell.openExternal(CREATOR_URL);
}
// The page currently shown in the focused MuziQuiz window, or the host space.
function openCurrentPageInBrowser() {
  const current = (BrowserWindow.getFocusedWindow() ?? mainWindow()).webContents.getURL();
  void shell.openExternal(isOwnPage(current) ? current : `${appOrigin()}/host`);
}
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MuziQuiz', submenu: [
      { label: 'Host space', accelerator: 'CmdOrCtrl+H', click: () => { const window = mainWindow(); void window.loadURL(`${appOrigin()}/host`); window.focus(); } },
      { label: 'Open this page in web browser', accelerator: 'CmdOrCtrl+Shift+B', click: () => openCurrentPageInBrowser() },
      { type: 'separator' },
      { label: 'Open data folder', click: () => void shell.openPath(userFolder()) },
      { label: 'Reset host password…', click: () => void resetPassword() },
      { type: 'separator' },
      { role: 'quit', label: 'Quit MuziQuiz' }
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'togglefullscreen', label: 'Full screen (projector)' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }
    ] },
    { label: 'Help', submenu: [
      { label: 'Player join addresses…', click: showAddresses },
      { label: 'About MuziQuiz', click: () => void about() }
    ] }
  ]));
}

// Ask before quitting while a quiz is open, because players would be disconnected.
app.on('before-quit', event => {
  if (quitting || !running) return;
  event.preventDefault();
  let live = false;
  try { live = server.hasLiveSession(dataDir()); } catch { /* Quit anyway if the check fails. */ }
  const proceed = !live || dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow() ?? undefined, {
    type: 'warning', buttons: ['Keep running', 'Quit and disconnect players'], defaultId: 0, cancelId: 0, title: 'A quiz is still live',
    message: 'A quiz session is still open.', detail: 'Quitting stops the quiz server and every player is disconnected. Finished results are already saved.'
  }) === 1;
  if (!proceed) { if (BrowserWindow.getAllWindows().length === 0) createWindow(); return; }
  quitting = true;
  running.close().catch(() => {}).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
app.on('second-instance', () => { const window = mainWindow(); if (window.isMinimized()) window.restore(); window.focus(); });

app.whenReady().then(async () => {
  loadSettings();
  try { running = await server.startServer({ dataDir: dataDir(), clientPath: path.join(__dirname, 'client'), ports: candidatePorts() }); }
  catch (error) { dialog.showErrorBox('MuziQuiz could not start', error.message); quitting = true; app.exit(1); return; }
  buildMenu();
  createWindow();
});
