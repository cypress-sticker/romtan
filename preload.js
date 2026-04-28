const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // オーバーレイへポップアップ送信
  sendJoinDetected: (data) => ipcRenderer.send('join-detected', data),
  onShowPopup: (callback) => ipcRenderer.on('show-popup', (event, data) => callback(data)),

  // Twitch OAuth ログイン
  startLogin: () => ipcRenderer.invoke('start-login'),
  logout: () => ipcRenderer.send('logout'),
  resetSeenChatters: () => ipcRenderer.send('reset-seen-chatters'),

  // ログイン状態のコールバック
  onLoginSuccess: (cb) => ipcRenderer.on('login-success', (e, data) => cb(data)),
  onLoginStatus: (cb) => ipcRenderer.on('login-status', (e, data) => cb(data)),
  onLoginError: (cb) => ipcRenderer.on('login-error', (e, msg) => cb(msg)),

  // 新規チャター通知
  onNewChatter: (cb) => ipcRenderer.on('new-chatter', (e, username) => cb(username)),

  // ── ログウィンドウ（control.html → main.js） ──
  openLogWindow: () => ipcRenderer.send('open-log-window'),
  closeLogWindow: () => ipcRenderer.send('close-log-window'),
  onLogWindowClosed: (cb) => ipcRenderer.on('log-window-closed', (e) => cb()),
  syncTheme: (isDark) => ipcRenderer.send('sync-theme', isDark),
  forwardLogEntry: (username) => ipcRenderer.send('forward-log-entry', username),
  resizeControlWindow: (height) => ipcRenderer.send('resize-control-window', height),
  sendLogHistory: (entries) => ipcRenderer.send('log-history', entries),

  // ── log.html 専用追加 ──
  onLogHistory: (cb) => ipcRenderer.on('log-history', (e, entries) => cb(entries)),

  // ── log.html 専用（main.js → log.html） ──
  onLogEntry: (cb) => ipcRenderer.on('log-entry', (e, username) => cb(username)),
  onThemeSync: (cb) => ipcRenderer.on('theme-sync', (e, isDark) => cb(isDark)),
  onLogReset: (cb) => ipcRenderer.on('log-reset', (e) => cb()),
  resetLog: () => ipcRenderer.send('reset-log'),
});
