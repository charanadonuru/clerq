const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  exportHistoryCSV: () => ipcRenderer.invoke('export-history-csv'),
  
  addWatchedFolder: () => ipcRenderer.invoke('add-watched-folder'),
  removeWatchedFolder: (folderPath) => ipcRenderer.invoke('remove-watched-folder', folderPath),
  addBlacklistFolder: () => ipcRenderer.invoke('add-blacklist-folder'),
  removeBlacklistFolder: (folderPath) => ipcRenderer.invoke('remove-blacklist-folder', folderPath),
  toggleFolderPause: (folderPath) => ipcRenderer.invoke('toggle-folder-pause', folderPath),
  openWatchedFolder: (folderPath) => ipcRenderer.invoke('open-watched-folder', folderPath),
  showFileInFolder: (filePath) => ipcRenderer.invoke('show-file-in-folder', filePath),
  
  selectFilesToRename: () => ipcRenderer.invoke('select-files-to-rename'),
  renameFilesManual: (filePaths) => ipcRenderer.invoke('rename-files-manual', filePaths),
  pathIsDirectory: (targetPath) => ipcRenderer.invoke('path-is-directory', targetPath),
  selectFolderToRename: () => ipcRenderer.invoke('select-folder-to-rename'),
  scanFolderToRename: (folderPath) => ipcRenderer.invoke('scan-folder-to-rename', folderPath),
  applyFolderRename: (folderPath, newName) => ipcRenderer.invoke('apply-folder-rename', folderPath, newName),
  
  undoRename: (id) => ipcRenderer.invoke('undo-rename', id),
  testConnection: (settings) => ipcRenderer.invoke('test-connection', settings),
  quitApp: () => ipcRenderer.send('quit-app'),
  closeWindow: () => ipcRenderer.send('hide-popover'),
  
  // Event listeners
  onHistoryUpdate: (callback) => ipcRenderer.on('history-updated', (event, value) => callback(value)),
  onStateChange: (callback) => ipcRenderer.on('state-changed', (event, value) => callback(value)),
  onToastMessage: (callback) => ipcRenderer.on('toast-message', (event, value) => callback(value))
});
