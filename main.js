const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const crypto = require('crypto');
const storage = require('./storage');
const textExtractor = require('./textExtractor');

// Only one app instance = one tray icon
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let isShuttingDown = false;
let userExplicitQuit = false;
let tray = null;
let popoverWindow = null;
let toastWindow = null;
let ignorePopoverBlurUntil = 0;
let watchers = {}; // folderPath -> watcherInstance
let renameQueue = Promise.resolve();
const processingPaths = new Set();
const clerqRenamedPaths = new Map(); // path -> expiry timestamp (ignore watcher echo)

//  Track fingerprints of files seen in watched folders so we can detect
// manual renames (unlink old name + add new name, same content fingerprint).
const fileFingerprints = new Map(); // normalizedPath -> fingerprint
const recentUnlinks = new Map();    // fingerprint -> timestamp of unlink event

// App State
let trayState = 'green'; // green, amber, red

function normalizePathKey(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function registerRenamedOutput(fromPath, toPath) {
  const until = Date.now() + 60000;
  clerqRenamedPaths.set(normalizePathKey(fromPath), until);
  clerqRenamedPaths.set(normalizePathKey(toPath), until);
}

function isClerqRenamedPath(filePath) {
  const key = normalizePathKey(filePath);
  const until = clerqRenamedPaths.get(key);
  if (!until) return false;
  if (Date.now() > until) {
    clerqRenamedPaths.delete(key);
    return false;
  }
  return true;
}

function getRenameDecision(fingerprint, config) {
  const priorRenameCount = storage.getPriorRenameCount(fingerprint);

  // When "Skip re-renaming" is ON: block any file already renamed once
  if (config.skipReRenamingOnMove && priorRenameCount > 0) {
    return {
      action: 'skip',
      reason: 'Already renamed — turn off "Skip re-renaming" in Settings to rename once more',
      priorRenameCount
    };
  }

  // When "Skip re-renaming" is OFF: allow re-renaming freely
 

  return { action: 'proceed', priorRenameCount };
}

function getPidFilePath() {
  return path.join(app.getPath('userData'), 'clerq.pid');
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function terminateStaleInstance() {
  const pidPath = getPidFilePath();
  if (!fs.existsSync(pidPath)) return;

  const oldPid = parseInt(fs.readFileSync(pidPath, 'utf8'), 10);
  if (!oldPid || oldPid === process.pid) return;

  if (isProcessRunning(oldPid)) {
    try {
      process.kill(oldPid);
    } catch (e) {
      console.error('Could not terminate previous Clerq instance:', e);
    }
  }

  try {
    fs.unlinkSync(pidPath);
  } catch (e) {
   
  }
}

function writePidFile() {
  fs.writeFileSync(getPidFilePath(), String(process.pid), 'utf8');
}

function removePidFile() {
  try {
    if (fs.existsSync(getPidFilePath())) {
      fs.unlinkSync(getPidFilePath());
    }
  } catch (e) {
    // ignore
  }
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function destroyAppWindows() {
  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.destroy();
    popoverWindow = null;
  }
  if (toastWindow && !toastWindow.isDestroyed()) {
    toastWindow.destroy();
    toastWindow = null;
  }
}

function shutdownApp() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  
  // if user wantedly quits-do not restart the app after a reboot or a login into the system
  if (userExplicitQuit) {
    try {
      app.setLoginItemSettings({ openAtLogin: false, path: app.getPath('exe') });
    } catch (e) {
      
    }
  }

  stopAllWatchers();
  destroyAppWindows();
  destroyTray();
  removePidFile();

  if (!app.isQuitting) {
    app.quit();
  }
}

function enqueueFileRename(filePath, watchedFolderPath, options = {}) {
  const parentFolder = watchedFolderPath || path.dirname(filePath);
  renameQueue = renameQueue
    .then(() => processNewFile(filePath, parentFolder, options))
    .catch(err => console.error('Queued rename failed:', err));
  return renameQueue;
}

async function generateTrayIcons() {
  const assetsDir = path.join(app.getAppPath(), 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const iconsToGenerate = [
    { name: 'icon-green.png', color: '#3fb950', size: 16 },
    { name: 'icon-amber.png', color: '#d29922', size: 16 },
    { name: 'icon-red.png', color: '#f85149', size: 16 },
    { name: 'icon.png', color: '#2dd4bf', size: 32, isAppIcon: true }
  ];

  let needsGeneration = false;
  for (const icon of iconsToGenerate) {
    if (!fs.existsSync(path.join(assetsDir, icon.name))) {
      needsGeneration = true;
      break;
    }
  }

  if (!needsGeneration) return;

  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      offscreen: true
    }
  });

  const htmlContent = `
    <html>
      <body>
        <canvas id="canvas"></canvas>
        <script>
          const canvas = document.getElementById('canvas');
          const ctx = canvas.getContext('2d');
          
          window.drawCircle = (color, size) => {
            canvas.width = size;
            canvas.height = size;
            ctx.clearRect(0, 0, size, size);
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            return canvas.toDataURL('image/png');
          };

          window.drawAppIcon = () => {
            canvas.width = 32;
            canvas.height = 32;
            ctx.clearRect(0, 0, 32, 32);
            ctx.fillStyle = '#2dd4bf';
            ctx.beginPath();
            ctx.roundRect(0, 0, 32, 32, 6);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(9, 16);
            ctx.lineTo(14, 21);
            ctx.lineTo(23, 11);
            ctx.stroke();
            return canvas.toDataURL('image/png');
          };
        </script>
      </body>
    </html>
  `;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));

  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));

  for (const icon of iconsToGenerate) {
    const filePath = path.join(assetsDir, icon.name);
    if (!fs.existsSync(filePath)) {
      let dataUrl;
      if (icon.isAppIcon) {
        dataUrl = await win.webContents.executeJavaScript('window.drawAppIcon()');
      } else {
        dataUrl = await win.webContents.executeJavaScript(`window.drawCircle("${icon.color}", ${icon.size})`);
      }
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(filePath, base64Data, 'base64');
    }
  }

  win.close();
}

function updateTrayIcon(state) {
  trayState = state;
  if (!tray) return;

  const assetsDir = path.join(app.getAppPath(), 'assets');
  let iconPath = path.join(assetsDir, 'icon-green.png');
  let tooltip = 'Clerq - Watching folders';

  if (state === 'amber') {
    iconPath = path.join(assetsDir, 'icon-amber.png');
    tooltip = 'Clerq - Renaming in progress...';
  } else if (state === 'red') {
    iconPath = path.join(assetsDir, 'icon-red.png');
    tooltip = 'Clerq - Watching paused';
  }

  if (fs.existsSync(iconPath)) {
    tray.setImage(iconPath);
  }
  tray.setToolTip(tooltip);

  // Notify popover renderer if open
  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.webContents.send('state-changed', state);
  }
}

function createPopoverWindow() {
  popoverWindow = new BrowserWindow({
    width: 380,
    height: 550,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    alwaysOnTop: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  popoverWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  

  popoverWindow.on('blur', () => {
    if (Date.now() < ignorePopoverBlurUntil) return;
    void hidePopover();
  });
}

async function resetPopoverDashboard() {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  try {
    await popoverWindow.webContents.executeJavaScript(
      `(function () {
        if (typeof showDashboardTab === 'function') showDashboardTab();
      })();`,
      true
    );
  } catch (e) {
    
  }
}

async function flushPopoverPaint() {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  try {
    await popoverWindow.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true
    );
  } catch (e) {
    
  }
}

async function hidePopover() {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  if (popoverWindow.isVisible()) {
    await resetPopoverDashboard();
  }
  popoverWindow.hide();
  popoverWindow.setOpacity(1);
}

async function openPopover() {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;

  ignorePopoverBlurUntil = Date.now() + 400;

  const { x, y } = getPopoverPosition();
  popoverWindow.setPosition(x, y);

  
  popoverWindow.setOpacity(0);
  popoverWindow.show();
  await resetPopoverDashboard();
  await flushPopoverPaint();
  popoverWindow.webContents.invalidate();
  popoverWindow.setOpacity(1);
  popoverWindow.focus();
  popoverWindow.webContents.send('state-changed', trayState);
}

function getPopoverPosition() {
  const trayBounds = tray.getBounds();
  const popoverBounds = popoverWindow.getBounds();
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  // Center horizontally relative to tray icon
  let x = trayBounds.x + (trayBounds.width / 2) - (popoverBounds.width / 2);
  let y = trayBounds.y - popoverBounds.height;

  // Ensure it fits on screen
  if (x < workArea.x) x = workArea.x;
  if (x + popoverBounds.width > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - popoverBounds.width;
  }

  // Handle taskbar at the top
  if (trayBounds.y < workArea.y + 100) {
    y = trayBounds.y + trayBounds.height + 5;
  } else {
    y = trayBounds.y - popoverBounds.height - 5;
  }

  return { x: Math.round(x), y: Math.round(y) };
}

async function togglePopover() {
  if (!popoverWindow) return;

  if (popoverWindow.isVisible()) {
    await hidePopover();
  } else {
    await openPopover();
  }
}

function createToastWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  toastWindow = new BrowserWindow({
    width: 380,
    height: 350, 
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  toastWindow.loadFile(path.join(__dirname, 'renderer', 'toast.html'));

  toastWindow.webContents.once('did-finish-load', () => {
    updateToastWindowPosition();
  });
}

function updateToastWindowPosition() {
  if (!toastWindow || toastWindow.isDestroyed()) return;

  const config = storage.getConfig();
  const position = config.notifications?.position || 'bottom-right';
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;
  const bounds = toastWindow.getBounds();
  const margin = 10;

  let x;
  let y;
  switch (position) {
    case 'top-right':
      x = workArea.x + workArea.width - bounds.width - margin;
      y = workArea.y + margin;
      break;
    case 'top-left':
      x = workArea.x + margin;
      y = workArea.y + margin;
      break;
    case 'bottom-left':
      x = workArea.x + margin;
      y = workArea.y + workArea.height - bounds.height - margin;
      break;
    case 'bottom-right':
    default:
      x = workArea.x + workArea.width - bounds.width - margin;
      y = workArea.y + workArea.height - bounds.height - margin;
      break;
  }

  toastWindow.setPosition(Math.round(x), Math.round(y));
}

function applyRuntimePreferences(config) {
  app.setLoginItemSettings({
    openAtLogin: config.autoStartOnBoot || false,
    path: app.getPath('exe'),
    args: ['--hidden']
  });
  updateToastWindowPosition();
}

function sendToastMessage(message) {
  if (!toastWindow) return;

  const config = storage.getConfig();
  if (!config.notifications.showToast) return;

  const payload = {
    ...message,
    duration: config.notifications.duration,
    showUndo: config.notifications.showUndo
  };

  if (!toastWindow.isVisible()) {
    toastWindow.showInactive();
  }
  toastWindow.webContents.send('toast-message', payload);
}

// Global Watching Logic
function startWatching() {
  const config = storage.getConfig();
  if (!config.masterEnabled) {
    updateTrayIcon('red');
    stopAllWatchers();
    return;
  }

  let watchingAny = false;
  config.watchedFolders.forEach(folder => {
    if (folder.enabled) {
      watchingAny = true;
      setupWatcher(folder.path, folder.watchSubfolders);
    } else {
      removeWatcher(folder.path);
    }
  });

  updateTrayIcon(watchingAny ? 'green' : 'red');
}

function stopAllWatchers() {
  Object.keys(watchers).forEach(folderPath => {
    removeWatcher(folderPath);
  });
}

function setupWatcher(folderPath, recursive) {
  if (watchers[folderPath]) {
    removeWatcher(folderPath);
  }

  if (!fs.existsSync(folderPath)) return;

  // ignoreInitial is false so we can fingerprint existing files during the
  // initial scan.  The watcherReady flag prevents them from being processed
  // as new files — only fingerprints are cached until chokidar emits 'ready'.
  let watcherReady = false;

  const watcher = chokidar.watch(folderPath, {
    persistent: true,
    depth: recursive ? undefined : 0,
    ignoreInitial: false,
    awaitWriteFinish: false // We handle stability manually for better control
  });

  watcher.on('ready', () => {
    watcherReady = true;
  });

  // When a file is removed (or renamed away), record its fingerprint so we can
  // detect manual renames (unlink + add with the same content hash).
  watcher.on('unlink', (filePath) => {
    const key = normalizePathKey(filePath);
    const fp = fileFingerprints.get(key);
    if (fp) {
      recentUnlinks.set(fp, Date.now());
      fileFingerprints.delete(key);
      // Auto-expire after 5 seconds
      setTimeout(() => {
        if (recentUnlinks.get(fp) && Date.now() - recentUnlinks.get(fp) >= 5000) {
          recentUnlinks.delete(fp);
        }
      }, 6000);
    }
  });

  watcher.on('add', (filePath) => {
    if (!watcherReady) {
      // Initial scan — just cache the fingerprint, don't rename
      const fp = getFileFingerprint(filePath);
      if (fp) {
        fileFingerprints.set(normalizePathKey(filePath), fp);
      }
      return;
    }
    // Delay slightly so that unlink events for manual renames can fire first on Windows
    setTimeout(() => {
      enqueueFileRename(filePath, folderPath);
    }, 150);
  });

  watchers[folderPath] = watcher;
}

function removeWatcher(folderPath) {
  if (watchers[folderPath]) {
    watchers[folderPath].close();
    delete watchers[folderPath];
  }
}

// File Stability Helper
async function waitForFileStable(filePath, timeoutMs = 20000) {
  const start = Date.now();
  let prevSize = -1;

  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('File did not stabilize in time'));
      }

      try {
        if (!fs.existsSync(filePath)) {
          setTimeout(check, 500);
          return;
        }

        const stats = fs.statSync(filePath);
        const ext = path.extname(filePath).toLowerCase();

        // Skip browser temporary download extensions
        if (['.crdownload', '.tmp', '.part', '.download', '.xlsx.tmp'].includes(ext)) {
          setTimeout(check, 500);
          return;
        }

        // If size is stable and greater than 0
        if (stats.size === prevSize && stats.size > 0) {
          resolve(true);
        } else {
          prevSize = stats.size;
          setTimeout(check, 500);
        }
      } catch (e) {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

function getFileFingerprint(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const size = stats.size;
    const readSize = Math.min(size, 1024 * 1024); // Hash up to 1MB
    const buffer = Buffer.alloc(readSize);

    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, readSize, 0);
    fs.closeSync(fd);

    return crypto.createHash('sha256').update(buffer).update(size.toString()).digest('hex');
  } catch (e) {
    console.error('Fingerprinting error:', e);
    return null;
  }
}

function getEffectiveModel(config) {
  if (config.provider === 'ollama' && config.model === 'custom') {
    const custom = (config.ollamaCustomModel || '').trim();
    if (!custom) {
      throw new Error('Enter a custom Ollama model name in Settings');
    }
    return custom;
  }
  return config.model;
}

// LLM API Client
async function callLLM(provider, apiKey, model, ollamaUrl, prompt) {
  try {
    if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 120 }
        })
      });
      const data = await res.json();
      if (data.candidates && data.candidates[0].content.parts[0].text) {
        return data.candidates[0].content.parts[0].text.trim();
      }
      throw new Error(data.error?.message || 'Invalid API response structure');
    }

    if (provider === 'openai') {
      const url = 'https://api.openai.com/v1/chat/completions';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 120
        })
      });
      const data = await res.json();
      if (data.choices && data.choices[0].message.content) {
        return data.choices[0].message.content.trim();
      }
      throw new Error(data.error?.message || 'Invalid API response structure');
    }

    if (provider === 'claude') {
      const url = 'https://api.anthropic.com/v1/messages';
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 120,
          temperature: 0.1
        })
      });
      const data = await res.json();
      if (data.content && data.content[0].text) {
        return data.content[0].text.trim();
      }
      throw new Error(data.error?.message || 'Invalid API response structure');
    }

    if (provider === 'ollama') {
      const url = `${ollamaUrl}/api/generate`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: false,
          options: { temperature: 0.1 }
        })
      });
      const data = await res.json();
      if (data.response) {
        return data.response.trim();
      }
      throw new Error('Invalid Ollama response');
    }

    throw new Error('Unsupported provider: ' + provider);
  } catch (e) {
    console.error('LLM API call failed:', e);
    throw e;
  }
}

function stripVersionSuffix(baseName) {
  return baseName.replace(/\s+\(\d+\)$/, '').trim();
}

// Core File Renaming Logic
async function processNewFile(filePath, watchedFolderPath, options = {}) {
  const { manual = false } = options;
  const config = storage.getConfig();
  if (!manual && !config.masterEnabled) return;

  if (!fs.existsSync(filePath)) return;

  const pathKey = normalizePathKey(filePath);
  if (processingPaths.has(pathKey)) return;
  if (!manual && isClerqRenamedPath(filePath)) return;

  // Detect manual renames: only use the time-gated unlink tracking.
  // When a file is renamed manually, chokidar fires unlink(old) then add(new).
  // The unlink handler records the fingerprint. If the new file's fingerprint
  // matches a recent unlink (within 5s), it's a manual rename — skip it.
  if (!manual) {
    const earlyFp = getFileFingerprint(filePath);
    if (earlyFp) {
      const unlinkTime = recentUnlinks.get(earlyFp);
      if (unlinkTime && Date.now() - unlinkTime < 5000) {
        recentUnlinks.delete(earlyFp);
        fileFingerprints.set(pathKey, earlyFp);
        return; // This is a manual rename, not a new file
      }

      fileFingerprints.set(pathKey, earlyFp);
    }
  }

  processingPaths.add(pathKey);

  try {
    const originalName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const fileTypeKey = ext.slice(1).toUpperCase();

    const reportIgnored = (reason) => {
      if (!manual) return;
      const toastId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
      sendToastMessage({ id: toastId, state: 'ignored', originalName, reason });
    };

    // 1. File Type Check
    if (!ext || !config.enabledFileTypes[fileTypeKey]) {
      if (manual) {
        reportIgnored(ext ? `File type ${fileTypeKey} is disabled in settings` : 'File has no extension');
      }
      return;
    }

    // 2. Blacklist Path check
    if (config.blacklistFolders.some(bPath => filePath.toLowerCase().startsWith(bPath.toLowerCase()))) {
      if (manual) reportIgnored('File is in an excluded folder');
      return;
    }

    // 3. Blacklist Name check
    if (config.blacklistPatterns.some(pat => {
      try {
        const regex = new RegExp(pat.replace(/\*/g, '.*'), 'i');
        return regex.test(originalName);
      } catch (e) {
        return originalName.toLowerCase().includes(pat.toLowerCase());
      }
    })) {
      if (manual) reportIgnored('Filename matches a blacklist pattern');
      return;
    }

    const fingerprint = getFileFingerprint(filePath);
    const renameDecision = getRenameDecision(fingerprint, config);

    if (renameDecision.action === 'skip') {
      if (manual) {
        const toastId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        sendToastMessage({ id: toastId, state: 'ignored', originalName, reason: renameDecision.reason });
      }
      return;
    }

    const priorRenameCount = renameDecision.priorRenameCount;
    const toastId = Date.now().toString() + Math.random().toString(36).substr(2, 5);

    try {
      updateTrayIcon('amber');

      sendToastMessage({
        id: toastId,
        state: 'detecting',
        originalName
      });

      // 4. File stability Wait (skip for manually dropped existing files)
      if (!manual) {
        await waitForFileStable(filePath);
      }

      if (!fs.existsSync(filePath)) return;

      // Get file size to check max limit
      const stats = fs.statSync(filePath);
      if (stats.size > config.maxFileSizeMB * 1024 * 1024) {
        sendToastMessage({ id: toastId, state: 'ignored', reason: 'File exceeds size limit' });
        updateTrayIcon('green');
        return;
      }

      // 6. Extraction
      sendToastMessage({ id: toastId, state: 'reading', originalName });

      // Check if we should ignore content reading for this type
      let content = '';
      const isIgnoredForContent = config.ignoredTypesForContent.includes(ext.slice(1).toUpperCase());
      if (!isIgnoredForContent) {
        content = await textExtractor.extractText(filePath, config.maxContentChars);
      } else {
        content = `[Content reading skipped due to privacy rules]`;
      }

      // 7. Blacklist Content Keyword Check
      if (config.blacklistKeywords.some(kw => content.toLowerCase().includes(kw.toLowerCase()))) {
        sendToastMessage({ id: toastId, state: 'ignored', reason: 'Sensitive content matched' });
        updateTrayIcon('green');
        return;
      }

      // 8. Generate name using AI
      sendToastMessage({ id: toastId, state: 'generating', originalName });

      const prompt = `You are a professional file renaming assistant.
Analyze the following document/file info and generate a clean, highly descriptive, and scannable filename in English.

Original Filename: "${originalName}"
File Content Snippet (first few characters/metadata):
"""
${content}
"""

Instructions:
1. Understand the key topics, document type (e.g. invoice, report, certificate, resume, receipt, photo), date, company, or project name from the content.
2. Generate a name in English.
3. The name must be between ${config.renameLength === 'short' ? '2-3 words' : config.renameLength === 'descriptive' ? '5-7 words' : '3-5 words'}.
4. Strip junk prefixes/suffixes like random UUIDs, hash strings, timestamps in raw milliseconds, and version strings (like _v1_final, copy(2)).
5. Use Title Case with spaces between words (e.g., "Google Invoice May 2026", "Project Presentation Design Draft").
6. Respond with ONLY the new filename. Do NOT include any folder paths, file extensions (e.g. do not append .pdf), quotes, markdown formatting, or introductory/explanatory text. Output exactly the name and nothing else.`;

      const rawResponse = await callLLM(
        config.provider,
        config.apiKey,
        getEffectiveModel(config),
        config.ollamaUrl,
        prompt
      );

      // Sanitize response
      let cleanName = rawResponse
        .replace(/[\/\?<>\\:\*\|":]/g, '') // remove forbidden chars
        .replace(/\r?\n|\r/g, ' ') // remove newlines
        .trim();

      // Strip trailing extensions if LLM appended it
      if (cleanName.toLowerCase().endsWith(ext)) {
        cleanName = cleanName.slice(0, -ext.length).trim();
      }

      if (!cleanName) {
        throw new Error('LLM suggested empty filename');
      }

      // Append original name in brackets if enabled
      let finalBaseName = cleanName;
      if (config.preserveOriginalName) {
        const origBase = path.basename(originalName, ext);
        finalBaseName = `${cleanName} (${origBase})`;
      }

      // One optional re-rename: append (1) only on the second rename (skip setting off)
      if (!config.skipReRenamingOnMove && priorRenameCount === 1) {
        const baseWithoutVersion = stripVersionSuffix(finalBaseName);
        finalBaseName = `${baseWithoutVersion} (1)`;
      }

      // 9. Check if name actually changed (skip when adding a new version suffix)
      const originalBaseNoExt = stripVersionSuffix(path.basename(originalName, ext));
      const finalBaseCompare = stripVersionSuffix(finalBaseName);
      if (priorRenameCount === 0 && finalBaseCompare.toLowerCase() === originalBaseNoExt.toLowerCase()) {
        sendToastMessage({ id: toastId, state: 'ignored', reason: 'Name is already optimized' });
        updateTrayIcon('green');
        return;
      }

      // 10. Resolve duplicate filenames in the same folder
      let finalPath = path.join(path.dirname(filePath), finalBaseName + ext);
      if (path.resolve(finalPath).toLowerCase() !== path.resolve(filePath).toLowerCase()) {
        let counter = 1;
        while (fs.existsSync(finalPath)) {
          const baseWithoutVersion = stripVersionSuffix(finalBaseName);
          finalPath = path.join(path.dirname(filePath), `${baseWithoutVersion} (${counter})${ext}`);
          counter++;
        }
      }

      fs.renameSync(filePath, finalPath);
      registerRenamedOutput(filePath, finalPath);

      // Update fingerprint cache so future manual renames of this file are detected
      if (fingerprint) {
        fileFingerprints.delete(normalizePathKey(filePath));
        fileFingerprints.set(normalizePathKey(finalPath), fingerprint);
      }

      // Log history
      const historyId = Date.now().toString();
      const entry = {
        id: historyId,
        timestamp: Date.now(),
        originalPath: filePath,
        originalName,
        newPath: finalPath,
        newName: path.basename(finalPath),
        folderPath: watchedFolderPath,
        extension: fileTypeKey,
        fingerprint,
        status: 'renamed'
      };
      storage.addHistoryEntry(entry);

      // Update frontend
      if (popoverWindow && !popoverWindow.isDestroyed()) {
        popoverWindow.webContents.send('history-updated', storage.getHistory());
      }

      // Send final success toast
      sendToastMessage({
        id: toastId,
        state: 'success',
        originalName,
        newName: path.basename(finalPath),
        filePath: finalPath,
        historyId
      });

    } catch (err) {
      console.error('Processing file failed:', err);
      sendToastMessage({
        id: toastId,
        state: 'error',
        message: err.message || 'AI renaming failed.'
      });
    } finally {
      updateTrayIcon(Object.keys(watchers).length > 0 ? 'green' : 'red');
    }

  } finally {
    processingPaths.delete(pathKey);
  }
}

// App tray creation
function createTray() {
  destroyTray();

  const assetsDir = path.join(app.getAppPath(), 'assets');
  let iconPath = path.join(assetsDir, 'icon-green.png');
  if (!fs.existsSync(iconPath)) {
    // fallback if file doesn't exist yet
    iconPath = null;
  }

  tray = new Tray(iconPath || path.join(__dirname, 'icon.png'));

  const config = storage.getConfig();
  const menuTemplate = [
    { label: 'Clerq', enabled: false },
    { label: config.masterEnabled ? ' Pause watching' : ' Resume watching', click: toggleMasterEnable },
    { label: ' View history', click: () => { togglePopover(); } },
    { label: ' Open watched folder', click: openFirstWatchedFolder },
    { label: 'Settings', click: () => { togglePopover(); } },
    { type: 'separator' },
    {
      label: 'Quit',
      click: confirmQuitApp
    }
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
  tray.setToolTip('Clerq');

  tray.on('click', () => {
    togglePopover();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const config = storage.getConfig();
  const menuTemplate = [
    { label: 'Clerq', enabled: false },
    { label: config.masterEnabled ? 'Pause watching' : ' Resume watching', click: toggleMasterEnable },
    { label: ' View history', click: () => { togglePopover(); } },
    { label: ' Open watched folder', click: openFirstWatchedFolder },
    { label: ' Settings', click: () => { togglePopover(); } },
    { type: 'separator' },
    {
      label: 'Quit',
      click: confirmQuitApp
    }
  ];
  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
}

function toggleMasterEnable() {
  const config = storage.getConfig();
  config.masterEnabled = !config.masterEnabled;
  storage.saveConfig(config);

  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.webContents.send('history-updated', storage.getHistory());
  }

  startWatching();
  updateTrayMenu();
}

function openFirstWatchedFolder() {
  const config = storage.getConfig();
  if (config.watchedFolders.length > 0) {
    shell.openPath(config.watchedFolders[0].path);
  } else {
    dialog.showMessageBox({
      type: 'info',
      title: 'Clerq',
      message: 'No watched folders configured yet. Open settings in the dashboard to add folders.'
    });
  }
}

function confirmQuitApp() {
  dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 1,
    title: 'Confirm Quit',
    message: 'Are you sure you want to quit Clerq? Folder watching will stop.'
  }).then(result => {
    if (result.response === 1) {
      userExplicitQuit = true;
      shutdownApp();
    }
  });
}

// IPC Handling Register
ipcMain.handle('get-config', () => {
  return storage.getConfig();
});

ipcMain.handle('save-config', (event, newConfig) => {
  storage.saveConfig(newConfig);
  applyRuntimePreferences(newConfig);
  startWatching();
  updateTrayMenu();
  return true;
});

ipcMain.handle('get-history', () => {
  return storage.getHistory();
});

ipcMain.handle('clear-history', () => {
  storage.saveHistory([]);
  if (popoverWindow && !popoverWindow.isDestroyed()) {
    popoverWindow.webContents.send('history-updated', []);
  }
  return true;
});

ipcMain.handle('export-history-csv', async () => {
  const history = storage.getHistory();
  if (history.length === 0) {
    return { success: false, error: 'History is empty' };
  }

  const { filePath } = await dialog.showSaveDialog({
    title: 'Export History',
    defaultPath: 'clerq_history.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (!filePath) return { success: false };

  try {
    const headers = 'Timestamp,Original Name,New Name,Folder Path,Extension,Status\n';
    const rows = history.map(item => {
      const date = new Date(item.timestamp).toISOString();
      const orig = `"${item.originalName.replace(/"/g, '""')}"`;
      const newN = `"${item.newName.replace(/"/g, '""')}"`;
      const folder = `"${item.folderPath.replace(/"/g, '""')}"`;
      return `${date},${orig},${newN},${folder},${item.extension},${item.status}`;
    }).join('\n');

    fs.writeFileSync(filePath, headers + rows, 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('add-watched-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled) return null;

  const folderPath = result.filePaths[0];
  const config = storage.getConfig();

  if (config.watchedFolders.some(f => f.path.toLowerCase() === folderPath.toLowerCase())) {
    return null; // Already exists
  }

  config.watchedFolders.push({
    path: folderPath,
    enabled: true,
    watchSubfolders: false
  });

  storage.saveConfig(config);
  startWatching();
  return config.watchedFolders;
});

ipcMain.handle('add-blacklist-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled) return null;

  const folderPath = result.filePaths[0];
  const config = storage.getConfig();

  if (!config.blacklistFolders.some(p => p.toLowerCase() === folderPath.toLowerCase())) {
    config.blacklistFolders.push(folderPath);
    storage.saveConfig(config);
  }

  return config.blacklistFolders;
});

ipcMain.handle('remove-blacklist-folder', (event, folderPath) => {
  const config = storage.getConfig();
  config.blacklistFolders = config.blacklistFolders.filter(
    p => p.toLowerCase() !== folderPath.toLowerCase()
  );
  storage.saveConfig(config);
  return config.blacklistFolders;
});

ipcMain.handle('remove-watched-folder', (event, folderPath) => {
  const config = storage.getConfig();
  config.watchedFolders = config.watchedFolders.filter(f => f.path.toLowerCase() !== folderPath.toLowerCase());

  storage.saveConfig(config);
  removeWatcher(folderPath);
  startWatching();
  return config.watchedFolders;
});

ipcMain.handle('toggle-folder-pause', (event, folderPath) => {
  const config = storage.getConfig();
  const folder = config.watchedFolders.find(f => f.path.toLowerCase() === folderPath.toLowerCase());
  if (folder) {
    folder.enabled = !folder.enabled;
    storage.saveConfig(config);
    startWatching();
  }
  return config.watchedFolders;
});

ipcMain.handle('open-watched-folder', (event, folderPath) => {
  if (fs.existsSync(folderPath)) {
    try {
      const stats = fs.statSync(folderPath);
      if (stats.isFile()) {
        shell.showItemInFolder(folderPath);
      } else {
        shell.openPath(folderPath);
      }
      return { success: true };
    } catch (e) {
      shell.openPath(folderPath);
      return { success: true };
    }
  }
  // File no longer exists at that path — try opening the parent directory
  try {
    const parent = path.dirname(folderPath);
    if (fs.existsSync(parent)) {
      shell.openPath(parent);
      return { success: true, fallback: true };
    }
  } catch (e) {
    // ignore
  }
  return { success: false };
});

// Single Folder Bulk Renaming
ipcMain.handle('select-files-to-rename', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled) return [];
  return result.filePaths.filter(fp => {
    try {
      return fs.existsSync(fp) && fs.statSync(fp).isFile();
    } catch (e) {
      return false;
    }
  });
});

ipcMain.handle('rename-files-manual', async (event, filePaths) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return { success: false, error: 'No files selected' };
  }

  const seen = new Set();
  const validPaths = filePaths.filter(fp => {
    try {
      if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return false;
      const key = normalizePathKey(fp);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    } catch (e) {
      return false;
    }
  });

  if (validPaths.length === 0) {
    return { success: false, error: 'No valid files to rename' };
  }

  for (const fp of validPaths) {
    enqueueFileRename(fp, null, { manual: true });
  }
  return { success: true, count: validPaths.length };
});

ipcMain.handle('path-is-directory', (event, targetPath) => {
  try {
    return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
  } catch (e) {
    return false;
  }
});

ipcMain.handle('select-folder-to-rename', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });

  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-folder-to-rename', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      throw new Error('Folder does not exist');
    }

    const files = fs.readdirSync(folderPath)
      .map(file => path.join(folderPath, file))
      .filter(file => fs.statSync(file).isFile())
      .map(file => path.basename(file))
      .slice(0, 25); // list first 25 files for context

    if (files.length === 0) {
      return { suggestedName: '', error: 'Folder is empty' };
    }

    const config = storage.getConfig();
    const prompt = `You are a professional directory naming assistant.
Analyze the list of files contained within a folder named "${path.basename(folderPath)}" and suggest a clean, descriptive, and collective folder name in English.

List of Files:
${files.map(f => `- ${f}`).join('\n')}

Instructions:
1. Determine the common theme, category, or project that groups these files (e.g., Travel Receipts 2025, Python Project Source, Family Photos).
2. The name should be short and professional (2-4 words, Title Case with spaces).
3. Do NOT include any quotes, folder paths, markdown formatting, or explanatory text.
4. Respond with ONLY the suggested folder name in English.`;

    const suggestedName = await callLLM(
      config.provider,
      config.apiKey,
      getEffectiveModel(config),
      config.ollamaUrl,
      prompt
    );

    return { suggestedName: suggestedName.replace(/[\/\?<>\\:\*\|":]/g, '').trim() };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('apply-folder-rename', async (event, folderPath, newName) => {
  try {
    const parentDir = path.dirname(folderPath);
    let targetPath = path.join(parentDir, newName);

    let counter = 1;
    while (fs.existsSync(targetPath)) {
      targetPath = path.join(parentDir, `${newName} (${counter})`);
      counter++;
    }

    fs.renameSync(folderPath, targetPath);

    // Log history
    const entry = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      originalPath: folderPath,
      originalName: path.basename(folderPath),
      newPath: targetPath,
      newName: path.basename(targetPath),
      folderPath: parentDir,
      extension: 'FOLDER',
      fingerprint: '',
      status: 'renamed'
    };
    storage.addHistoryEntry(entry);

    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send('history-updated', storage.getHistory());
    }

    return { success: true, newPath: targetPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Undo rename operation
ipcMain.handle('undo-rename', async (event, historyId) => {
  try {
    const entry = storage.updateHistoryStatus(historyId, 'reverting');
    if (!entry) throw new Error('History entry not found');

    if (!fs.existsSync(entry.newPath)) {
      throw new Error(`File not found at current location: ${entry.newName}`);
    }

    let revertPath = entry.originalPath;
    let counter = 1;
    const ext = path.extname(revertPath);
    const base = path.join(path.dirname(revertPath), path.basename(revertPath, ext));

    while (fs.existsSync(revertPath)) {
      revertPath = `${base} (${counter})${ext}`;
      counter++;
    }

    fs.renameSync(entry.newPath, revertPath);

    // Update history
    storage.updateHistoryStatus(historyId, 'reverted');

    // Notify frontends
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      popoverWindow.webContents.send('history-updated', storage.getHistory());
    }

    return { success: true, originalName: entry.originalName };
  } catch (e) {
    storage.updateHistoryStatus(historyId, 'renamed'); // revert state
    return { success: false, error: e.message };
  }
});

// Connection Test
ipcMain.handle('test-connection', async (event, settings) => {
  try {
    const prompt = "Respond with the word 'OK' and nothing else.";
    const result = await callLLM(
      settings.provider,
      settings.apiKey,
      getEffectiveModel(settings),
      settings.ollamaUrl,
      prompt
    );

    if (result.toLowerCase().includes('ok')) {
      return { success: true };
    }
    return { success: false, error: `Invalid response: ${result}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});


ipcMain.handle('show-file-in-folder', (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return { success: true };
  }
 
  try {
    const parent = path.dirname(filePath);
    if (fs.existsSync(parent)) {
      shell.openPath(parent);
      return { success: true, fallback: true };
    }
  } catch (e) {
    
  }
  return { success: false };
});

ipcMain.on('quit-app', () => {
  confirmQuitApp();
});

ipcMain.on('hide-popover', () => {
  void hidePopover();
});

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (popoverWindow && !popoverWindow.isDestroyed()) {
      if (!popoverWindow.isVisible()) {
        togglePopover();
      } else {
        popoverWindow.focus();
      }
    } else if (tray) {
      togglePopover();
    }
  });
}

process.on('SIGINT', shutdownApp);
process.on('SIGTERM', shutdownApp);

// Lifecycle events
app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  terminateStaleInstance();
  writePidFile();

  await generateTrayIcons();
  createTray();
  createPopoverWindow();
  createToastWindow();
  startWatching();

  const config = storage.getConfig();

 
  if (config.autoStartOnBoot) {
    try {
      app.setLoginItemSettings({ openAtLogin: true, path: app.getPath('exe') });
    } catch (e) {
      
    }
  }

  applyRuntimePreferences(config);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPopoverWindow();
      createToastWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Keep app running in tray
});

app.on('before-quit', () => {
  if (!isShuttingDown) {
    isShuttingDown = true;

    if (userExplicitQuit) {
      try {
        app.setLoginItemSettings({ openAtLogin: false, path: app.getPath('exe') });
      } catch (e) {
       
      }
    }

    stopAllWatchers();
    destroyAppWindows();
    destroyTray();
    removePidFile();
  }
});
