require('dotenv').config();
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, shell } = require('electron');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'qcwtri71a1vzt8dndxmy1sebrz7p5u';
const REDIRECT_URI = 'http://localhost:3000';
const POLL_INTERVAL_MS = 5000;

let controlWindow = null;
let overlayWindow = null;
let logWindow = null;
let currentThemeIsDark = true;
let accessToken = null;
let refreshTokenValue = null;
let broadcasterId = null;
let broadcasterName = null;
let seenChatters = new Set();
let pollTimer = null;
let isFirstPoll = true;
let sessionLog = [];
let viewerLog = [];
let hasUnsavedData = false;
let viewerPollTimer = null;
let viewerHistory = { version: 1, viewers: {} };

// ─── 来場者履歴 ───────────────────────────────────────────
function getViewerHistoryPath() {
  return path.join(app.getPath('userData'), 'viewer-history.json');
}

function loadViewerHistory() {
  try {
    const data = JSON.parse(fs.readFileSync(getViewerHistoryPath(), 'utf8'));
    if (data.version === 1 && data.viewers) viewerHistory = data;
  } catch {}
}

function saveViewerHistory() {
  try { fs.writeFileSync(getViewerHistoryPath(), JSON.stringify(viewerHistory), 'utf8'); } catch {}
}

function addViewerRecord(login) {
  const entry = viewerHistory.viewers[login];
  if (entry) {
    entry.count += 1;
  } else {
    viewerHistory.viewers[login] = { firstSeen: new Date().toISOString(), count: 1 };
  }
  saveViewerHistory();
}

// ─── HTTPS ヘルパー ───────────────────────────────────────────
function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── 時刻ヘルパー ───────────────────────────────────────────
function nowTimeStr() {
  const d = new Date();
  return d.getHours().toString().padStart(2,'0') + ':' +
         d.getMinutes().toString().padStart(2,'0') + ':' +
         d.getSeconds().toString().padStart(2,'0');
}

// ─── トークン保存 ───────────────────────────────────────────
function getTokenPath() {
  return path.join(app.getPath('userData'), 'twitch-token.json');
}
function saveToken(data) {
  try { fs.writeFileSync(getTokenPath(), JSON.stringify(data), 'utf8'); } catch {}
}
function loadToken() {
  try { return JSON.parse(fs.readFileSync(getTokenPath(), 'utf8')); } catch { return null; }
}
function clearToken() {
  try { fs.unlinkSync(getTokenPath()); } catch {}
}

// ─── Twitch API ───────────────────────────────────────────
async function validateToken(token) {
  const r = await httpsRequest({
    hostname: 'id.twitch.tv',
    path: '/oauth2/validate',
    headers: { 'Authorization': `OAuth ${token}` },
  });
  return r.status === 200 ? r.data : null;
}

async function doRefreshToken(refreshTkn) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshTkn,
    client_id: CLIENT_ID,
  }).toString();
  const r = await httpsRequest({
    hostname: 'id.twitch.tv',
    path: '/oauth2/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  return r.data;
}

async function getUserInfo(token) {
  const r = await httpsRequest({
    hostname: 'api.twitch.tv',
    path: '/helix/users',
    headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${token}` },
  });
  return r.data?.data?.[0] || null;
}

async function getChatters(token, bId) {
  const params = new URLSearchParams({ broadcaster_id: bId, moderator_id: bId, first: '1000' });
  const r = await httpsRequest({
    hostname: 'api.twitch.tv',
    path: `/helix/chat/chatters?${params}`,
    headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${token}` },
  });
  return { status: r.status, data: r.data?.data || [] };
}

async function getViewerCount(token, bId) {
  const params = new URLSearchParams({ user_id: bId });
  const r = await httpsRequest({
    hostname: 'api.twitch.tv',
    path: `/helix/streams?${params}`,
    headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${token}` },
  });
  return r.data?.data?.[0]?.viewer_count ?? null;
}

async function fetchAllFollowers(token, bId) {
  const results = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ broadcaster_id: bId, first: '100' });
    if (cursor) params.set('after', cursor);
    const r = await httpsRequest({
      hostname: 'api.twitch.tv',
      path: `/helix/channels/followers?${params}`,
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${token}` },
    });
    if (r.status === 401 || r.status === 403) throw new Error(`scope_error:${r.status}`);
    if (r.status !== 200) break;
    results.push(...(r.data.data || []));
    cursor = r.data.pagination?.cursor || null;
  } while (cursor);
  return results;
}

async function fetchAllFollowing(token, userId) {
  const results = [];
  let cursor = null;
  do {
    const params = new URLSearchParams({ user_id: userId, first: '100' });
    if (cursor) params.set('after', cursor);
    const r = await httpsRequest({
      hostname: 'api.twitch.tv',
      path: `/helix/channels/followed?${params}`,
      headers: { 'Client-Id': CLIENT_ID, 'Authorization': `Bearer ${token}` },
    });
    if (r.status === 401 || r.status === 403) throw new Error(`scope_error:${r.status}`);
    if (r.status !== 200) break;
    results.push(...(r.data.data || []));
    cursor = r.data.pagination?.cursor || null;
  } while (cursor);
  return results;
}

// ─── OAuth Implicit Flow ───────────────────────────────────────────
function startOAuthFlow() {
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', 'moderator:read:chatters moderator:read:followers user:read:follows');
  authUrl.searchParams.set('state', state);

  return new Promise((resolve, reject) => {
    let completed = false;

    const authWindow = new BrowserWindow({
      width: 520,
      height: 720,
      title: 'Twitchでログイン',
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    authWindow.loadURL(authUrl.toString());

    const handleNavigate = (event, url) => {
      if (!url.startsWith(REDIRECT_URI)) return;
      completed = true;
      authWindow.destroy();

      const hash = new URL(url).hash.slice(1);
      const params = new URLSearchParams(hash);
      const token = params.get('access_token');
      const retState = params.get('state');
      const error = params.get('error');

      if (error) return reject(new Error('ログインがキャンセルされました'));
      if (retState !== state) return reject(new Error('不正なリクエスト'));
      if (!token) return reject(new Error('トークンが取得できませんでした'));

      resolve({ access_token: token, refresh_token: null });
    };

    authWindow.webContents.on('will-redirect', handleNavigate);
    authWindow.webContents.on('will-navigate', handleNavigate);

    authWindow.on('closed', () => {
      if (!completed) reject(new Error('ログインウィンドウが閉じられました'));
    });
  });
}

// ─── チャタポーリング ───────────────────────────────────────────
async function doPoll() {
  try {
    const { status, data } = await getChatters(accessToken, broadcasterId);
    if (status === 401) {
      stopPolling();
      if (controlWindow) controlWindow.webContents.send('token-expired');
      return;
    }
    const current = new Set(data.map(c => c.user_login));

    if (isFirstPoll) {
      isFirstPoll = false;
      seenChatters = current;
    } else {
      for (const name of current) {
        if (!seenChatters.has(name)) {
          seenChatters.add(name);
          addViewerRecord(name);
          const timeStr = nowTimeStr();
          sessionLog.push({ username: name, time: timeStr });
          hasUnsavedData = true;
          if (controlWindow) controlWindow.webContents.send('new-chatter', name);
        }
      }
    }
  } catch (e) {
    console.error('Poll error:', e.message);
  }
}

async function doViewerPoll() {
  try {
    const count = await getViewerCount(accessToken, broadcasterId);
    if (count !== null) {
      viewerLog.push({ time: nowTimeStr(), count });
    }
  } catch (e) {
    console.error('Viewer poll error:', e.message);
  }
}

function startPolling() {
  stopPolling();
  seenChatters = new Set();
  isFirstPoll = true;
  sessionLog = [];
  viewerLog = [];
  hasUnsavedData = false;
  doPoll();
  pollTimer = setInterval(doPoll, POLL_INTERVAL_MS);
  doViewerPoll();
  viewerPollTimer = setInterval(doViewerPoll, 30000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (viewerPollTimer) { clearInterval(viewerPollTimer); viewerPollTimer = null; }
}

// ─── 起動時の自動ログイン ───────────────────────────────────────────
async function tryAutoLogin() {
  const saved = loadToken();
  if (!saved) return null;

  try {
    let valid = await validateToken(saved.access_token);
    if (!valid && saved.refresh_token) {
      const newToken = await doRefreshToken(saved.refresh_token);
      if (!newToken.access_token) { clearToken(); return null; }
      accessToken = newToken.access_token;
      refreshTokenValue = newToken.refresh_token;
      saveToken(newToken);
      valid = await validateToken(accessToken);
    } else {
      accessToken = saved.access_token;
      refreshTokenValue = saved.refresh_token;
    }
    if (!valid) { clearToken(); return null; }

    const user = await getUserInfo(accessToken);
    if (!user) { clearToken(); return null; }
    broadcasterId = user.id;
    broadcasterName = user.login;
    return user;
  } catch (e) {
    console.error('Auto-login error:', e.message);
    clearToken();
    return null;
  }
}

// ─── メニュー ───────────────────────────────────────────
function createMenu() {
  const template = [
    {
      label: 'ファイル',
      submenu: [{ label: '終了', accelerator: 'Alt+F4', click: () => app.quit() }],
    },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+R', click: () => controlWindow?.reload() },
        { type: 'separator' },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: () => { if (controlWindow) { const f = controlWindow.webContents.getZoomFactor(); controlWindow.webContents.setZoomFactor(Math.min(f + 0.1, 3)); } } },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: () => { if (controlWindow) { const f = controlWindow.webContents.getZoomFactor(); controlWindow.webContents.setZoomFactor(Math.max(f - 0.1, 0.5)); } } },
        { label: '標準サイズに戻す', accelerator: 'CmdOrCtrl+0', click: () => controlWindow?.webContents.setZoomFactor(1) },
      ],
    },
    {
      label: 'ウィンドウ',
      submenu: [{ label: '最小化', accelerator: 'CmdOrCtrl+M', click: () => controlWindow?.minimize() }],
    },
    {
      label: 'ヘルプ',
      submenu: [
        {
          label: '使い方を見る', accelerator: 'F1',
          click: () => {
            const w = new BrowserWindow({ width: 700, height: 800, title: 'ROMたん 使い方', autoHideMenuBar: true });
            w.loadFile(path.join(__dirname, 'renderer', 'manual.html'));
          },
        },
        {
          label: '不具合・お問い合わせ',
          click: () => shell.openExternal('https://x.com/cypress_sticker'),
        },
        { type: 'separator' },
        {
          label: 'バージョン情報',
          click: () => dialog.showMessageBox(controlWindow, { type: 'info', title: 'バージョン情報', message: 'ROMたん', detail: `バージョン: ${app.getVersion()}\n\nTwitchチャットの入室をリアルタイムで通知するデスクトップアプリです。\n\nhttps://hinoki-nobo.booth.pm/items/8240124`, buttons: ['閉じる'] }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── ウィンドウ生成 ───────────────────────────────────────────
function createWindows() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  controlWindow = new BrowserWindow({
    width: 480, height: 700, frame: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  controlWindow.loadFile(path.join(__dirname, 'renderer', 'control.html'));

  controlWindow.on('close', async (e) => {
    if (!hasUnsavedData) return;
    e.preventDefault();
    const { response } = await dialog.showMessageBox(controlWindow, {
      type: 'question',
      title: '保存されていないデータがあります',
      message: `保存されていないログがあります（${sessionLog.length}人）`,
      buttons: ['CSVで保存して終了', '保存せずに終了', 'キャンセル'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 0) {
      const { canceled, filePath } = await dialog.showSaveDialog(controlWindow, {
        title: 'ログCSVを保存',
        defaultPath: `romtan_log_${nowTimeStr().replace(/:/g,'')}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!canceled && filePath) {
        const romCsv = 'username,confirmed_time\n' +
          sessionLog.map(e => `${e.username},${e.time}`).join('\n');
        fs.writeFileSync(filePath, '﻿' + romCsv, 'utf8');
        const viewerPath = filePath.replace(/\.csv$/, '_viewers.csv');
        const viewerCsv = 'time,viewer_count\n' +
          viewerLog.map(e => `${e.time},${e.count}`).join('\n');
        fs.writeFileSync(viewerPath, '﻿' + viewerCsv, 'utf8');
      }
      hasUnsavedData = false;
      controlWindow.destroy();
    } else if (response === 1) {
      hasUnsavedData = false;
      controlWindow.destroy();
    }
  });

  controlWindow.webContents.on('did-finish-load', async () => {
    const user = await tryAutoLogin();
    if (user) {
      controlWindow.webContents.send('login-success', { username: user.login });
      startPolling();
    }
  });

  overlayWindow = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  // コントロールパネルが別モニターに移動したらオーバーレイを自動追従させる
  let lastDisplayId = screen.getDisplayNearestPoint(controlWindow.getBounds()).id;
  controlWindow.on('move', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(controlWindow.getBounds());
    if (display.id === lastDisplayId) return;
    lastDisplayId = display.id;
    const { x, y, width, height } = display.bounds;
    overlayWindow.setBounds({ x, y, width, height });
  });
}

// ─── シングルインスタンス強制 ───────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
      if (controlWindow.isMinimized()) controlWindow.restore();
      controlWindow.focus();
    }
  });
}

// ─── アプリ起動 ───────────────────────────────────────────
app.whenReady().then(() => {
  loadViewerHistory();
  createMenu();
  createWindows();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ─── IPC ───────────────────────────────────────────
ipcMain.on('join-detected', (event, data) => {
  if (overlayWindow) overlayWindow.webContents.send('show-popup', data);
});

ipcMain.handle('start-login', async () => {
  try {
    if (controlWindow) controlWindow.webContents.send('login-status', { status: 'connecting' });

    const tokenData = await startOAuthFlow();
    accessToken = tokenData.access_token;
    refreshTokenValue = tokenData.refresh_token;
    saveToken(tokenData);

    const user = await getUserInfo(accessToken);
    if (!user) throw new Error('ユーザー情報の取得に失敗しました');
    broadcasterId = user.id;
    broadcasterName = user.login;

    if (controlWindow) controlWindow.webContents.send('login-success', { username: user.login });
    startPolling();
    return { ok: true };
  } catch (e) {
    if (controlWindow) controlWindow.webContents.send('login-error', e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.on('logout', () => {
  stopPolling();
  accessToken = null;
  refreshTokenValue = null;
  broadcasterId = null;
  broadcasterName = null;
  seenChatters = new Set();
  clearToken();
});

ipcMain.on('reset-seen-chatters', () => {
  seenChatters = new Set();
  isFirstPoll = true;
});

let pendingLogHistory = [];
let savedLogWindowBounds = null;

ipcMain.on('log-history', (event, entries) => {
  pendingLogHistory = entries;
});

ipcMain.on('open-log-window', () => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }
  const bounds = savedLogWindowBounds || { width: 400, height: 600 };
  logWindow = new BrowserWindow({
    ...bounds,
    minWidth: 320, minHeight: 400,
    title: '入室ログ',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  logWindow.loadFile(path.join(__dirname, 'renderer', 'log.html'));

  logWindow.webContents.once('did-finish-load', () => {
    logWindow.webContents.send('theme-sync', currentThemeIsDark);
    if (pendingLogHistory.length > 0) {
      logWindow.webContents.send('log-history', pendingLogHistory);
      pendingLogHistory = [];
    }
  });

  logWindow.on('close', () => {
    if (!logWindow.isDestroyed()) {
      savedLogWindowBounds = logWindow.getBounds();
    }
  });

  logWindow.on('closed', () => {
    logWindow = null;
    if (controlWindow && !controlWindow.isDestroyed()) {
      controlWindow.webContents.send('log-window-closed');
    }
  });
});

ipcMain.on('sync-theme', (event, isDark) => {
  currentThemeIsDark = isDark;
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('theme-sync', isDark);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('theme-sync', isDark);
  }
});

ipcMain.on('forward-log-entry', (event, username) => {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('log-entry', username);
  }
});

ipcMain.on('close-log-window', () => {
  if (logWindow && !logWindow.isDestroyed()) logWindow.close();
});

ipcMain.on('resize-control-window', (event, height) => {
  if (controlWindow && !controlWindow.isDestroyed()) {
    const [w] = controlWindow.getSize();
    controlWindow.setSize(w, Math.max(height, 300));
  }
});

ipcMain.on('reset-log', () => {
  sessionLog = [];
  hasUnsavedData = false;
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('log-reset');
  }
});

// ─── CSVエクスポート ───────────────────────────────────────────
ipcMain.handle('export-csv', async () => {
  const now = new Date();
  const dateStr = now.getFullYear() +
    ('0'+(now.getMonth()+1)).slice(-2) +
    ('0'+now.getDate()).slice(-2) + '_' +
    ('0'+now.getHours()).slice(-2) +
    ('0'+now.getMinutes()).slice(-2);

  const romPath = await dialog.showSaveDialog(controlWindow, {
    title: 'ログCSVを保存',
    defaultPath: `romtan_log_${dateStr}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (romPath.canceled) return { ok: false };

  const romCsv = 'username,confirmed_time\n' +
    sessionLog.map(e => `${e.username},${e.time}`).join('\n');
  fs.writeFileSync(romPath.filePath, '﻿' + romCsv, 'utf8');

  const viewerPath = romPath.filePath.replace(/\.csv$/, '_viewers.csv');
  const viewerCsv = 'time,viewer_count\n' +
    viewerLog.map(e => `${e.time},${e.count}`).join('\n');
  fs.writeFileSync(viewerPath, '﻿' + viewerCsv, 'utf8');

  hasUnsavedData = false;
  return { ok: true, path: romPath.filePath };
});

