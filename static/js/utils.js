// ── Utility functions ─────────────────────────────────────────────────────────
function fmt(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── UNDO ──────────────────────────────────────────────────────────────────────
function pushUndo() {
  undoStack.push(JSON.stringify(zones));
  if (undoStack.length > 50) undoStack.shift();
}

function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  zones = JSON.parse(undoStack.pop());
  selectedZoneId = null;
  renderZonesList();
  toast('Undone');
}
