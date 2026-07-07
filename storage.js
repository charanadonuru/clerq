const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Storage {
  getUserDataPath() {
    try {
      return app ? app.getPath('userData') : path.join(process.env.APPDATA || '', 'Clerq');
    } catch (e) {
      return path.join(process.env.APPDATA || process.env.USERPROFILE || '', 'Clerq');
    }
  }

  getConfigPath() {
    return path.join(this.getUserDataPath(), 'config.json');
  }

  getHistoryPath() {
    return path.join(this.getUserDataPath(), 'history.json');
  }

  constructor() {
    this.defaultConfig = {
      masterEnabled: true,
      watchedFolders: [],
      apiKey: '',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      ollamaUrl: 'http://localhost:11434',
      ollamaCustomModel: '',
      autoStartOnBoot: false,
      renameLength: 'medium',
      preserveOriginalName: false,
      maxFileSizeMB: 50,
      enabledFileTypes: {
        PDF: true, DOCX: true, XLSX: true, TXT: true, JPG: true,
        PNG: true, CSV: true, PPTX: true, MP4: true, ZIP: true,
        MP3: true, EXE: true
      },
      blacklistFolders: [],
      blacklistPatterns: [],
      blacklistKeywords: [],
      maxContentChars: 500,
      ignoredTypesForContent: [],
      skipReRenamingOnMove: false,
      notifications: {
        showToast: true,
        showUndo: true,
        duration: 5,
        position: 'bottom-right'
      }
    };
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const userDataPath = this.getUserDataPath();
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    const configPath = this.getConfigPath();
    if (!fs.existsSync(configPath)) {
      try {
        fs.writeFileSync(configPath, JSON.stringify(this.defaultConfig, null, 2), 'utf8');
      } catch (e) {
        console.error('Error creating default config:', e);
      }
    }
    
    const historyPath = this.getHistoryPath();
    if (!fs.existsSync(historyPath)) {
      try {
        fs.writeFileSync(historyPath, JSON.stringify([], null, 2), 'utf8');
      } catch (e) {
        console.error('Error creating default history:', e);
      }
    }
  }

  getConfig() {
    this.init();
    try {
      const configPath = this.getConfigPath();
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        return { ...this.defaultConfig, ...JSON.parse(data) };
      }
    } catch (e) {
      console.error('Error reading config:', e);
    }
    return this.defaultConfig;
  }

  saveConfig(config) {
    this.init();
    try {
      const configPath = this.getConfigPath();
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving config:', e);
    }
  }

  getHistory() {
    this.init();
    try {
      const historyPath = this.getHistoryPath();
      if (fs.existsSync(historyPath)) {
        const data = fs.readFileSync(historyPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Error reading history:', e);
    }
    return [];
  }

  saveHistory(history) {
    this.init();
    try {
      const historyPath = this.getHistoryPath();
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving history:', e);
    }
  }

  addHistoryEntry(entry) {
    const history = this.getHistory();
    history.unshift(entry);
    
    // Auto-expire after 30 days or 500 entries
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let filteredHistory = history.filter(item => item.timestamp > thirtyDaysAgo);
    if (filteredHistory.length > 500) {
      filteredHistory = filteredHistory.slice(0, 500);
    }

    this.saveHistory(filteredHistory);
  }

  updateHistoryStatus(id, status) {
    const history = this.getHistory();
    const index = history.findIndex(item => item.id === id);
    if (index !== -1) {
      history[index].status = status;
      this.saveHistory(history);
      return history[index];
    }
    return null;
  }

  getPriorRenameCount(fingerprint) {
    if (!fingerprint) return 0;
    const history = this.getHistory();
    return history.filter(item => item.fingerprint === fingerprint && item.status === 'renamed').length;
  }
}

module.exports = new Storage();
