
let currentConfig = null;


const providerModels = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
  ],
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Recommended)' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
  ],
  claude: [
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' }
  ],
  ollama: [
    { value: 'llama3', label: 'Llama 3' },
    { value: 'mistral', label: 'Mistral' },
    { value: 'phi3', label: 'Phi 3' },
    { value: 'custom', label: 'Custom Model Name' }
  ]
};


const fileTypesList = ['PDF', 'DOCX', 'XLSX', 'TXT', 'JPG', 'PNG', 'CSV', 'PPTX', 'MP4', 'ZIP', 'MP3', 'EXE'];

document.addEventListener('DOMContentLoaded', async () => {
 
  setupTabs();

  
  await loadAndRenderConfig();


  await loadAndRenderHistory();

 
  window.api.onHistoryUpdate((history) => {
    renderHistory(history);
  });

  window.api.onStateChange((state) => {
    updateStatusIndicator(state);
  });

  
  setupFileRenamer();

  
  setupFolderRenamer();


  setupGeneralActions();
});


function setupTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.getAttribute('data-tab');
      showTab(tabId, navItems, tabContents, { animate: true });
    });
  });
}

function showDashboardTab() {
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  showTab('dashboard', navItems, tabContents, { animate: false });
}

window.showDashboardTab = showDashboardTab;

function showTab(tabId, navItems, tabContents, options = {}) {
  const { animate = false } = options;
  navItems.forEach(nav => nav.classList.remove('active'));
  tabContents.forEach(tab => tab.classList.remove('active', 'tab-switch-animate'));

  const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
  const tabContent = document.getElementById(`tab-${tabId}`);
  if (navItem) navItem.classList.add('active');
  if (tabContent) {
    tabContent.classList.add('active');
    if (animate) tabContent.classList.add('tab-switch-animate');
  }
}

// Config loading and binding
async function loadAndRenderConfig() {
  currentConfig = await window.api.getConfig();

  // Master switch
  const masterToggle = document.getElementById('master-toggle');
  masterToggle.checked = currentConfig.masterEnabled;
  masterToggle.addEventListener('change', () => {
    currentConfig.masterEnabled = masterToggle.checked;
    saveConfig();
  });

  // Provider selection
  const providerSelect = document.getElementById('select-provider');
  providerSelect.value = currentConfig.provider;
  updateModelDropdown(currentConfig.provider, currentConfig.model);
  
  providerSelect.addEventListener('change', () => {
    const provider = providerSelect.value;
    currentConfig.provider = provider;

    const defaultModel = providerModels[provider][0].value;
    currentConfig.model = defaultModel;

    updateModelDropdown(provider, defaultModel);
    saveConfig();
  });

  // Toggle Ollama-specific fields visibility initially
  updateProviderFieldVisibility(currentConfig.provider, currentConfig.model);

  // API Key
  const apiKeyInput = document.getElementById('input-api-key');
  apiKeyInput.value = currentConfig.apiKey;
  apiKeyInput.addEventListener('change', () => {
    currentConfig.apiKey = apiKeyInput.value.trim();
    saveConfig();
  });

  // Ollama URL
  const ollamaUrlInput = document.getElementById('input-ollama-url');
  ollamaUrlInput.value = currentConfig.ollamaUrl;
  ollamaUrlInput.addEventListener('change', () => {
    currentConfig.ollamaUrl = ollamaUrlInput.value.trim();
    saveConfig();
  });

  // Model Selection
  const modelSelect = document.getElementById('select-model');
  modelSelect.addEventListener('change', () => {
    currentConfig.model = modelSelect.value;
    updateProviderFieldVisibility(currentConfig.provider, currentConfig.model);
    saveConfig();
  });

  // Ollama custom model name
  const ollamaCustomInput = document.getElementById('input-ollama-custom-model');
  ollamaCustomInput.value = currentConfig.ollamaCustomModel || '';
  ollamaCustomInput.addEventListener('change', () => {
    currentConfig.ollamaCustomModel = ollamaCustomInput.value.trim();
    saveConfig();
  });

  // Rename Length
  const lengthSelect = document.getElementById('select-length');
  lengthSelect.value = currentConfig.renameLength;
  lengthSelect.addEventListener('change', () => {
    currentConfig.renameLength = lengthSelect.value;
    saveConfig();
  });

  // Preserve Name check
  const preserveCheck = document.getElementById('check-preserve-name');
  preserveCheck.checked = currentConfig.preserveOriginalName;
  preserveCheck.addEventListener('change', () => {
    currentConfig.preserveOriginalName = preserveCheck.checked;
    saveConfig();
  });

  // File size slider
  const sizeSlider = document.getElementById('range-file-size');
  const sizeLabel = document.getElementById('label-file-size');
  sizeSlider.value = currentConfig.maxFileSizeMB;
  sizeLabel.textContent = `${currentConfig.maxFileSizeMB} MB`;
  sizeSlider.addEventListener('input', () => {
    sizeLabel.textContent = `${sizeSlider.value} MB`;
  });
  sizeSlider.addEventListener('change', () => {
    currentConfig.maxFileSizeMB = parseInt(sizeSlider.value);
    saveConfig();
  });

  // Max characters slider
  const charsSlider = document.getElementById('range-max-chars');
  const charsLabel = document.getElementById('label-max-chars');
  charsSlider.value = currentConfig.maxContentChars;
  charsLabel.textContent = `${currentConfig.maxContentChars} chars`;
  charsSlider.addEventListener('input', () => {
    charsLabel.textContent = `${charsSlider.value} chars`;
  });
  charsSlider.addEventListener('change', () => {
    currentConfig.maxContentChars = parseInt(charsSlider.value);
    saveConfig();
  });

  // Skip re-rename on move
  const skipReRenameCheck = document.getElementById('check-skip-re-rename');
  skipReRenameCheck.checked = currentConfig.skipReRenamingOnMove;
  skipReRenameCheck.addEventListener('change', () => {
    currentConfig.skipReRenamingOnMove = skipReRenameCheck.checked;
    saveConfig();
  });

  // Auto Start
  const autoStartCheck = document.getElementById('check-auto-start');
  autoStartCheck.checked = currentConfig.autoStartOnBoot || false;
  autoStartCheck.addEventListener('change', () => {
    currentConfig.autoStartOnBoot = autoStartCheck.checked;
    saveConfig();
  });

  // Show Toast
  const showToastCheck = document.getElementById('check-show-toast');
  showToastCheck.checked = currentConfig.notifications.showToast;
  showToastCheck.addEventListener('change', () => {
    currentConfig.notifications.showToast = showToastCheck.checked;
    saveConfig();
  });

  // Show Undo
  const showUndoCheck = document.getElementById('check-show-undo');
  showUndoCheck.checked = currentConfig.notifications.showUndo;
  showUndoCheck.addEventListener('change', () => {
    currentConfig.notifications.showUndo = showUndoCheck.checked;
    saveConfig();
  });

  // Toast Duration
  const durationSlider = document.getElementById('range-toast-duration');
  const durationLabel = document.getElementById('label-toast-duration');
  durationSlider.value = currentConfig.notifications.duration;
  durationLabel.textContent = `${currentConfig.notifications.duration} seconds`;
  durationSlider.addEventListener('input', () => {
    durationLabel.textContent = `${durationSlider.value} seconds`;
  });
  durationSlider.addEventListener('change', () => {
    currentConfig.notifications.duration = parseInt(durationSlider.value);
    saveConfig();
  });

  // Toast Position
  const toastPosSelect = document.getElementById('select-toast-pos');
  toastPosSelect.value = currentConfig.notifications.position;
  toastPosSelect.addEventListener('change', () => {
    currentConfig.notifications.position = toastPosSelect.value;
    saveConfig();
  });

  // Render sublists
  renderWatchedFolders();
  renderFileTypesGrid();
  renderBlacklistFolders();
  renderBlacklistTags();
  renderIgnoredContentTypes();
}

function updateProviderFieldVisibility(provider, selectedModel) {
  const isOllama = provider === 'ollama';
  document.getElementById('row-ollama-url').style.display = isOllama ? 'flex' : 'none';
  document.getElementById('row-api-key').style.display = isOllama ? 'none' : 'flex';
  document.getElementById('row-ollama-custom-model').style.display =
    isOllama && selectedModel === 'custom' ? 'flex' : 'none';
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

function updateModelDropdown(provider, selectedModel) {
  const modelSelect = document.getElementById('select-model');
  modelSelect.innerHTML = '';
  
  const models = providerModels[provider] || [];
  const knownValues = models.map(m => m.value);
  const effectiveSelection = knownValues.includes(selectedModel)
    ? selectedModel
    : (provider === 'ollama' ? 'custom' : selectedModel);

  models.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model.value;
    opt.textContent = model.label;
    if (model.value === effectiveSelection) {
      opt.selected = true;
    }
    modelSelect.appendChild(opt);
  });

  if (provider === 'ollama' && effectiveSelection === 'custom') {
    const customInput = document.getElementById('input-ollama-custom-model');
    if (!customInput.value && selectedModel && !knownValues.includes(selectedModel)) {
      customInput.value = selectedModel;
      currentConfig.ollamaCustomModel = selectedModel;
    }
  }

  updateProviderFieldVisibility(provider, modelSelect.value);
}

// Render folder watch lists
function renderWatchedFolders() {
  const container = document.getElementById('watched-folders-list');
  container.innerHTML = '';

  if (currentConfig.watchedFolders.length === 0) {
    container.innerHTML = '<div class="empty-state">No folders added. Click "+ Add Folder" to begin.</div>';
    return;
  }

  currentConfig.watchedFolders.forEach(folder => {
    const item = document.createElement('div');
    item.className = 'folder-item';

    const info = document.createElement('div');
    info.className = 'folder-item-info';
    info.title = folder.path;

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.path.split(/[\\/]/).pop() || folder.path;

    const pathEl = document.createElement('span');
    pathEl.className = 'folder-path';
    pathEl.textContent = folder.path;

    info.appendChild(name);
    info.appendChild(pathEl);

    
    info.style.cursor = 'pointer';
    info.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.openWatchedFolder(folder.path);
    });

    const actions = document.createElement('div');
    actions.className = 'folder-item-actions';

    // Recursive watch check
    const recurseCheck = document.createElement('label');
    recurseCheck.className = 'checkbox-container';
    recurseCheck.title = 'Watch subfolders recursively';
    recurseCheck.innerHTML = `
      <input type="checkbox" ${folder.watchSubfolders ? 'checked' : ''}>
      <span class="checkmark" style="top:-8px"></span>
    `;
    recurseCheck.querySelector('input').addEventListener('change', (e) => {
      folder.watchSubfolders = e.target.checked;
      saveConfig();
    });

    // Pause Switch
    const pauseToggle = document.createElement('label');
    pauseToggle.className = 'toggle-switch';
    pauseToggle.title = folder.enabled ? 'Pause watching' : 'Resume watching';
    pauseToggle.innerHTML = `
      <input type="checkbox" ${folder.enabled ? 'checked' : ''}>
      <span class="slider"></span>
    `;
    pauseToggle.querySelector('input').addEventListener('change', async () => {
      const folders = await window.api.toggleFolderPause(folder.path);
      currentConfig.watchedFolders = folders;
      renderWatchedFolders();
    });

    // Remove button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.title = 'Remove folder';
    deleteBtn.innerHTML = '✕';
    deleteBtn.addEventListener('click', async () => {
      const folders = await window.api.removeWatchedFolder(folder.path);
      currentConfig.watchedFolders = folders;
      renderWatchedFolders();
    });

    actions.appendChild(recurseCheck);
    actions.appendChild(pauseToggle);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

// Render File Types Grid
function renderFileTypesGrid() {
  const container = document.getElementById('file-types-container');
  container.innerHTML = '';

  fileTypesList.forEach(type => {
    const isChecked = currentConfig.enabledFileTypes[type] !== false; // defaults to true
    
    const label = document.createElement('label');
    label.className = 'checkbox-container';
    label.innerHTML = `
      ${type}
      <input type="checkbox" value="${type}" ${isChecked ? 'checked' : ''}>
      <span class="checkmark"></span>
    `;
    
    label.querySelector('input').addEventListener('change', (e) => {
      currentConfig.enabledFileTypes[type] = e.target.checked;
      saveConfig();
    });

    container.appendChild(label);
  });
}

function renderBlacklistFolders() {
  const container = document.getElementById('blacklist-folders-list');
  container.innerHTML = '';

  if (!currentConfig.blacklistFolders || currentConfig.blacklistFolders.length === 0) {
    container.innerHTML = '<div class="empty-state">No excluded folders.</div>';
    return;
  }

  currentConfig.blacklistFolders.forEach(folderPath => {
    const item = document.createElement('div');
    item.className = 'folder-item compact';

    const info = document.createElement('div');
    info.className = 'folder-item-info';
    info.title = folderPath;

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folderPath.split(/[\\/]/).pop() || folderPath;

    const pathEl = document.createElement('span');
    pathEl.className = 'folder-path';
    pathEl.textContent = folderPath;

    info.appendChild(name);
    info.appendChild(pathEl);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-icon';
    deleteBtn.title = 'Remove excluded folder';
    deleteBtn.innerHTML = '✕';
    deleteBtn.addEventListener('click', async () => {
      const folders = await window.api.removeBlacklistFolder(folderPath);
      currentConfig.blacklistFolders = folders;
      renderBlacklistFolders();
    });

    item.appendChild(info);
    item.appendChild(deleteBtn);
    container.appendChild(item);
  });
}

function renderIgnoredContentTypes() {
  const container = document.getElementById('ignored-content-types-container');
  container.innerHTML = '';

  const ignored = currentConfig.ignoredTypesForContent || [];

  fileTypesList.forEach(type => {
    const label = document.createElement('label');
    label.className = 'checkbox-container';
    label.title = 'Only send filename/metadata to AI, not file contents';
    label.innerHTML = `
      ${type}
      <input type="checkbox" value="${type}" ${ignored.includes(type) ? 'checked' : ''}>
      <span class="checkmark"></span>
    `;

    label.querySelector('input').addEventListener('change', (e) => {
      if (!currentConfig.ignoredTypesForContent) {
        currentConfig.ignoredTypesForContent = [];
      }
      if (e.target.checked) {
        if (!currentConfig.ignoredTypesForContent.includes(type)) {
          currentConfig.ignoredTypesForContent.push(type);
        }
      } else {
        currentConfig.ignoredTypesForContent = currentConfig.ignoredTypesForContent.filter(t => t !== type);
      }
      saveConfig();
    });

    container.appendChild(label);
  });
}

// Render Blacklist tag UI
function renderBlacklistTags() {
  const patternsContainer = document.getElementById('blacklist-patterns-tags');
  patternsContainer.innerHTML = '';
  currentConfig.blacklistPatterns.forEach((pat, index) => {
    const tag = createTagElement(pat, () => {
      currentConfig.blacklistPatterns.splice(index, 1);
      saveConfig();
      renderBlacklistTags();
    });
    patternsContainer.appendChild(tag);
  });

  const keywordsContainer = document.getElementById('blacklist-keywords-tags');
  keywordsContainer.innerHTML = '';
  currentConfig.blacklistKeywords.forEach((kw, index) => {
    const tag = createTagElement(kw, () => {
      currentConfig.blacklistKeywords.splice(index, 1);
      saveConfig();
      renderBlacklistTags();
    });
    keywordsContainer.appendChild(tag);
  });
}

function createTagElement(text, onDelete) {
  const span = document.createElement('span');
  span.className = 'tag-badge';
  span.textContent = text;
  
  const del = document.createElement('span');
  del.className = 'tag-delete';
  del.textContent = ' ✕';
  del.addEventListener('click', onDelete);
  
  span.appendChild(del);
  return span;
}

// Save configuration helper
async function saveConfig() {
  if (currentConfig) {
    await window.api.saveConfig(currentConfig);
  }
}

// History logic
async function loadAndRenderHistory() {
  const history = await window.api.getHistory();
  renderHistory(history);
}

function renderHistory(history) {
  const container = document.getElementById('history-list');
  container.innerHTML = '';

  if (history.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent activities.</div>';
    return;
  }

  history.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-row';

    const typeBadge = document.createElement('div');
    typeBadge.className = `badge-ext ${item.extension.toLowerCase()}`;
    typeBadge.textContent = item.extension;

    const info = document.createElement('div');
    info.className = 'history-info';

    const names = document.createElement('div');
    names.className = 'history-names';
    names.title = `Source folder: ${item.folderPath}`;

    const oldName = document.createElement('span');
    oldName.className = 'old-name';
    oldName.textContent = item.originalName;
    oldName.title = 'Click to show in folder';
    oldName.style.cursor = 'pointer';
    oldName.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.showFileInFolder(item.newPath);
    });

    const newName = document.createElement('span');
    newName.className = 'new-name';
    newName.textContent = item.newName;
    newName.title = 'Click to show in folder';
    newName.style.cursor = 'pointer';
    newName.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.showFileInFolder(item.newPath);
    });

    names.appendChild(oldName);
    names.appendChild(newName);

    const meta = document.createElement('div');
    meta.className = 'history-meta';

    const folder = document.createElement('span');
    folder.className = 'history-folder';
    folder.textContent = item.folderPath.split(/[\\/]/).pop() || item.folderPath;
    folder.title = item.folderPath;

    const time = document.createElement('span');
    time.textContent = formatTimeAgo(item.timestamp);

    meta.appendChild(folder);
    meta.appendChild(time);

    info.appendChild(names);
    info.appendChild(meta);
    row.style.cursor = 'pointer';
    row.addEventListener('click', async (e) => {
      // Don't trigger if clicking the undo button or file name spans
      if (e.target.closest('.btn-undo')) return;
      if (e.target.closest('.old-name') || e.target.closest('.new-name')) return;
      // Try to show the renamed file highlighted in its folder;
      // fall back to opening the parent folder if the file has moved.
      const result = await window.api.showFileInFolder(item.newPath);
      if (result && !result.success) {
        window.api.openWatchedFolder(item.folderPath);
      }
    });
    const action = document.createElement('div');
    
    // Status and undo logic
    if (item.status === 'reverted') {
      action.innerHTML = '<span class="status-reverted">Reverted</span>';
    } else if (item.status === 'reverting') {
      action.innerHTML = '<span class="status-reverted">Reverting...</span>';
    } else {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'btn-undo';
      undoBtn.textContent = 'Undo';
      
      // Gray out after 30 days
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - item.timestamp > thirtyDays) {
        undoBtn.disabled = true;
        undoBtn.title = 'Expired (older than 30 days)';
      }

      undoBtn.addEventListener('click', async () => {
        undoBtn.disabled = true;
        undoBtn.textContent = 'Reverting...';
        const res = await window.api.undoRename(item.id);
        if (!res.success) {
          alert(`Failed to undo rename: ${res.error}`);
          undoBtn.disabled = false;
          undoBtn.textContent = 'Undo';
        }
      });
      action.appendChild(undoBtn);
    }

    row.appendChild(typeBadge);
    row.appendChild(info);
    row.appendChild(action);
    container.appendChild(row);
  });
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function setupFileRenamer() {
  const dropzone = document.getElementById('file-dropzone');
  const statusEl = document.getElementById('file-rename-status');

  async function queueFiles(paths) {
    const filePaths = paths.filter(p => p && !p.endsWith('\\') && !p.endsWith('/'));
    if (filePaths.length === 0) {
      statusEl.className = 'status-message error';
      statusEl.textContent = 'No files selected.';
      statusEl.style.display = 'block';
      return;
    }

    statusEl.className = 'status-message';
    statusEl.textContent = `Renaming ${filePaths.length} file${filePaths.length > 1 ? 's' : ''}...`;
    statusEl.style.display = 'block';

    const result = await window.api.renameFilesManual(filePaths);
    if (result.success) {
      statusEl.className = 'status-message success';
      statusEl.textContent = `Queued ${result.count} file${result.count > 1 ? 's' : ''}. Watch for toast notifications.`;
      setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
    } else {
      statusEl.className = 'status-message error';
      statusEl.textContent = result.error || 'Could not queue files.';
    }
  }

  dropzone.addEventListener('click', async () => {
    const paths = await window.api.selectFilesToRename();
    if (paths.length > 0) queueFiles(paths);
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');

    const paths = [];
    for (const file of e.dataTransfer.files) {
      if (file.path) {
        const isDir = await window.api.pathIsDirectory(file.path);
        if (!isDir) paths.push(file.path);
      }
    }

    if (paths.length === 0) {
      statusEl.className = 'status-message error';
      statusEl.textContent = 'Drop files only (not folders). Use Folder Rename below for folders.';
      statusEl.style.display = 'block';
      return;
    }

    queueFiles(paths);
  });
}

// Bulk Folder Renaming Drag & Drop
function setupFolderRenamer() {
  const dropzone = document.getElementById('folder-dropzone');
  const preview = document.getElementById('folder-rename-preview');
  const previewPath = document.getElementById('preview-folder-path');
  const suggestedInput = document.getElementById('input-suggested-folder-name');
  const statusEl = document.getElementById('folder-rename-status');

  let selectedFolderPath = '';

  // Trigger file dialog on click
  dropzone.addEventListener('click', async () => {
    const path = await window.api.selectFolderToRename();
    if (path) {
      handleFolderSelection(path);
    }
  });

  // Drag over effects
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');

    if (e.dataTransfer.files.length > 0) {
      const droppedPath = e.dataTransfer.files[0].path;
      const isDir = await window.api.pathIsDirectory(droppedPath);
      if (!isDir) {
        statusEl.className = 'status-message error';
        statusEl.textContent = 'Please drop a folder, not a file.';
        statusEl.style.display = 'block';
        return;
      }
      handleFolderSelection(droppedPath);
    }
  });

  async function handleFolderSelection(folderPath) {
    selectedFolderPath = folderPath;
    preview.style.display = 'flex';
    dropzone.style.display = 'none';
    previewPath.textContent = folderPath;
    suggestedInput.value = 'Generating AI suggestion...';
    suggestedInput.disabled = true;
    
    document.getElementById('btn-apply-folder-rename').disabled = true;
    statusEl.style.display = 'none';

    const result = await window.api.scanFolderToRename(folderPath);
    suggestedInput.disabled = false;
    
    if (result.error) {
      suggestedInput.value = '';
      statusEl.className = 'status-message error';
      statusEl.textContent = `Error scanning folder: ${result.error}`;
      statusEl.style.display = 'block';
    } else {
      suggestedInput.value = result.suggestedName;
      document.getElementById('btn-apply-folder-rename').disabled = false;
    }
  }

  // Cancel action
  document.getElementById('btn-cancel-folder-rename').addEventListener('click', () => {
    preview.style.display = 'none';
    dropzone.style.display = 'flex';
    selectedFolderPath = '';
    statusEl.style.display = 'none';
  });

  // Apply Action
  document.getElementById('btn-apply-folder-rename').addEventListener('click', async () => {
    const newName = suggestedInput.value.trim();
    if (!newName) return;

    statusEl.style.display = 'none';
    document.getElementById('btn-apply-folder-rename').disabled = true;

    const result = await window.api.applyFolderRename(selectedFolderPath, newName);
    if (result.success) {
      statusEl.className = 'status-message success';
      statusEl.textContent = `Renamed ✓ Saved to log.`;
      statusEl.style.display = 'block';
      setTimeout(() => {
        preview.style.display = 'none';
        dropzone.style.display = 'flex';
        selectedFolderPath = '';
        statusEl.style.display = 'none';
      }, 3000);
    } else {
      statusEl.className = 'status-message error';
      statusEl.textContent = `Rename failed: ${result.error}`;
      statusEl.style.display = 'block';
      document.getElementById('btn-apply-folder-rename').disabled = false;
    }
  });
}

// Bind general action triggers
function setupGeneralActions() {
  // Add Folder Click
  document.getElementById('btn-add-folder').addEventListener('click', async () => {
    const list = await window.api.addWatchedFolder();
    if (list) {
      currentConfig.watchedFolders = list;
      renderWatchedFolders();
    }
  });

  document.getElementById('btn-add-blacklist-folder').addEventListener('click', async () => {
    const list = await window.api.addBlacklistFolder();
    if (list) {
      currentConfig.blacklistFolders = list;
      renderBlacklistFolders();
    }
  });

  // Password Visibility Toggle
  document.getElementById('btn-toggle-key-visibility').addEventListener('click', () => {
    const keyInput = document.getElementById('input-api-key');
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
    } else {
      keyInput.type = 'password';
    }
  });

  // Blacklist tags add events
  document.getElementById('input-add-pattern').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val && !currentConfig.blacklistPatterns.includes(val)) {
        currentConfig.blacklistPatterns.push(val);
        saveConfig();
        renderBlacklistTags();
      }
      e.target.value = '';
    }
  });

  document.getElementById('input-add-keyword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val && !currentConfig.blacklistKeywords.includes(val)) {
        currentConfig.blacklistKeywords.push(val);
        saveConfig();
        renderBlacklistTags();
      }
      e.target.value = '';
    }
  });

  // Test LLM Connection
  const testBtn = document.getElementById('btn-test-connection');
  const testResult = document.getElementById('connection-test-result');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = 'Testing connection...';
    testResult.style.display = 'none';

    const provider = document.getElementById('select-provider').value;
    const apiKey = document.getElementById('input-api-key').value;
    const ollamaUrl = document.getElementById('input-ollama-url').value;
    const testConfig = {
      provider,
      apiKey,
      model: document.getElementById('select-model').value,
      ollamaCustomModel: document.getElementById('input-ollama-custom-model').value.trim(),
      ollamaUrl
    };

    let model;
    try {
      model = getEffectiveModel(testConfig);
    } catch (e) {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
      testResult.className = 'status-message error';
      testResult.textContent = e.message;
      testResult.style.display = 'block';
      return;
    }

    const res = await window.api.testConnection({ provider, apiKey, model, ollamaUrl });
    testBtn.disabled = false;
    testBtn.textContent = 'Test Connection';

    if (res.success) {
      testResult.className = 'status-message success';
      testResult.textContent = 'Connection Successful! Model is active.';
    } else {
      testResult.className = 'status-message error';
      testResult.textContent = `Connection Failed: ${res.error}`;
    }
    testResult.style.display = 'block';
  });

  // Export CSV
  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    const res = await window.api.exportHistoryCSV();
    if (res.error) {
      alert(`Export failed: ${res.error}`);
    }
  });

  // Clear log list
  document.getElementById('btn-clear-history').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all history? This will also remove the ability to undo these renames.')) {
      window.api.clearHistory();
    }
  });

  // Reset Settings to default
  document.getElementById('btn-settings-reset').addEventListener('click', async () => {
    if (confirm('Reset all settings to default values? This cannot be undone.')) {
      // Save default configuration structure
      const defaults = {
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
      await window.api.saveConfig(defaults);
      await loadAndRenderConfig();
    }
  });

  // Close dashboard window (app keeps running in tray)
  document.getElementById('btn-close-window').addEventListener('click', () => {
    window.api.closeWindow();
  });

  // Quit app
  document.getElementById('btn-quit-app').addEventListener('click', () => {
    window.api.quitApp();
  });
}

function updateStatusIndicator(state) {
  const dot = document.getElementById('status-indicator');
  dot.className = `status-dot ${state}`;
}
