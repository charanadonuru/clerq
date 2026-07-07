const container = document.getElementById('toast-container');

window.api.onToastMessage((data) => {
  const { id, state, originalName, newName, filePath, historyId, message, reason, duration = 5, showUndo = true } = data;

  let card = document.getElementById(`toast-${id}`);

  // Create card if it doesn't exist (unless it's a skipped event that we just dismiss immediately)
  if (!card && state !== 'ignored') {
    card = document.createElement('div');
    card.id = `toast-${id}`;
    card.className = 'toast-card';
    container.appendChild(card);
  }

  if (state === 'ignored') {
    if (!card) {
      card = document.createElement('div');
      card.id = `toast-${id}`;
      card.className = 'toast-card';
      container.appendChild(card);
    }
    renderIgnored(card, originalName, reason);
    scheduleDismiss(card, 2500);
    return;
  }

  switch (state) {
    case 'detecting':
      renderProgress(card, 'Detecting...', originalName, 'spinner');
      break;
    case 'reading':
      renderProgress(card, 'Reading file...', originalName, 'spinner');
      break;
    case 'generating':
      renderProgress(card, 'Generating name...', originalName, 'sparkle');
      break;
    case 'success':
      renderSuccess(card, originalName, newName, filePath, historyId, showUndo, duration);
      break;
    case 'error':
      renderError(card, originalName, message);
      scheduleDismiss(card, 4000);
      break;
  }
});

function renderProgress(card, statusText, fileName, iconType) {
  let iconHtml = '<div class="spinner"></div>';
  if (iconType === 'sparkle') {
    iconHtml = '<span class="sparkle">✦</span>';
  }

  card.innerHTML = `
    <div class="toast-header">
      <div class="status-icon">${iconHtml}</div>
      <span class="status-text">${statusText}</span>
    </div>
    <div class="toast-body">
      <span class="file-name-label" title="${fileName}">${fileName}</span>
    </div>
  `;
}

function renderSuccess(card, oldName, newName, filePath, historyId, showUndo, duration) {
  card.innerHTML = `
    <div class="toast-header">
      <div class="status-icon"><span class="success-check">✓</span></div>
      <span class="status-text">Renamed</span>
    </div>
    <div class="toast-body">
      <div class="rename-path">
        <span class="old-name" title="${oldName}">${oldName}</span>
        <span class="new-name" title="${newName}">${newName}</span>
      </div>
    </div>
    <div class="toast-actions">
      <button class="toast-btn" id="btn-show-${card.id}">Show in Folder</button>
      ${showUndo ? `<button class="toast-btn primary" id="btn-undo-${card.id}">Undo</button>` : ''}
    </div>
  `;

  // Bind Show in Folder
  document.getElementById(`btn-show-${card.id}`).addEventListener('click', () => {
    window.api.openWatchedFolder(filePath);
  });

  // Bind Undo
  if (showUndo) {
    const undoBtn = document.getElementById(`btn-undo-${card.id}`);
    undoBtn.addEventListener('click', async () => {
      undoBtn.disabled = true;
      undoBtn.textContent = 'Reverting...';
      const res = await window.api.undoRename(historyId);
      if (res.success) {
        const actions = card.querySelector('.toast-actions');
        actions.innerHTML = `<span class="toast-btn reverted">↩ Reverted to original</span>`;
        // Clear any auto dismiss and dismiss in 2s
        if (card.dataset.timeoutId) {
          clearTimeout(parseInt(card.dataset.timeoutId));
        }
        scheduleDismiss(card, 2000);
      } else {
        alert(`Failed to revert: ${res.error}`);
        undoBtn.disabled = false;
        undoBtn.textContent = 'Undo';
      }
    });
  }

  // Setup auto-dismiss with hover tracking
  setupAutoDismiss(card, duration * 1000);
}

function renderIgnored(card, fileName, reason) {
  card.innerHTML = `
    <div class="toast-header">
      <div class="status-icon"><span class="success-check" style="color:#7d8590">🛈</span></div>
      <span class="status-text" style="color:#7d8590">Skipped</span>
    </div>
    <div class="toast-body">
      <span class="file-name-label" title="${fileName}">${fileName}</span>
      <span style="font-size:10px; color:#7d8590; font-style:italic;">${reason}</span>
    </div>
  `;
}

function renderError(card, fileName, errorMsg) {
  card.innerHTML = `
    <div class="toast-header">
      <div class="status-icon"><span class="error-cross">✕</span></div>
      <span class="status-text" style="color:#f85149">Error</span>
    </div>
    <div class="toast-body">
      <span class="file-name-label" title="${fileName}">${fileName}</span>
      <span style="font-size:10px; color:#f85149; word-break:break-all;">${errorMsg}</span>
    </div>
  `;
}

function setupAutoDismiss(card, delay) {
  card.dataset.dismissDelay = delay;
  card.dataset.startTime = Date.now();
  card.dataset.remainingTime = delay;

  const startTimer = (time) => {
    const id = setTimeout(() => {
      dismissCard(card);
    }, time);
    card.dataset.timeoutId = id;
    card.dataset.startTime = Date.now();
  };

  card.addEventListener('mouseenter', () => {
    if (card.dataset.timeoutId) {
      clearTimeout(parseInt(card.dataset.timeoutId));
    }
    const elapsed = Date.now() - parseInt(card.dataset.startTime);
    card.dataset.remainingTime = Math.max(0, parseInt(card.dataset.remainingTime) - elapsed);
  });

  card.addEventListener('mouseleave', () => {
    if (parseInt(card.dataset.remainingTime) > 0) {
      startTimer(parseInt(card.dataset.remainingTime));
    }
  });

  startTimer(delay);
}

function scheduleDismiss(card, delay) {
  setTimeout(() => {
    dismissCard(card);
  }, delay);
}

function dismissCard(card) {
  card.classList.add('slide-out');
  card.addEventListener('animationend', () => {
    card.remove();
  });
}
