'use strict';

// ══════════════════════════════════════════════════════════════════════════
// State
// ══════════════════════════════════════════════════════════════════════════
let W = 128, H = 64;

// ── Page (multi-page) system ──────────────────────────────────────────────
// Each page: {id, name, width, height, layers, activeLayerId}
let pages = [];
let activePageId = null;
let projectName = '未命名專案';

// ── Layer system ──────────────────────────────────────────────────────────
// layers[0] = topmost, layers[last] = bottommost (Photoshop convention)
let layers = [];
let activeLayerId = null;
let _layerSeq = 0;  // for unique IDs

// ── History ───────────────────────────────────────────────────────────────
let undoStack = [], redoStack = [];
const MAX_UNDO = 50;

// ── View / tools ──────────────────────────────────────────────────────────
let zoom = 6;
let tool = 'pencil';
let drawColor = 1;
let brushSize = 1;
let showGrid = true;
let fontMode = 'canvas';

// ── Drawing state ─────────────────────────────────────────────────────────
let isDrawing = false;
let lastX = -1, lastY = -1;
let shapeStart = null;
let shapePreview = null;

// ── Selection ─────────────────────────────────────────────────────────────
let selectRect = null;
let isSelectDragging = false;
let selectBuffer = null;

// ── Text / icon preview ───────────────────────────────────────────────────
let textPreview = null;
let iconPreview = null;
let iconCat = null;
let _currentSearchResults = null;

// ── Move tool ─────────────────────────────────────────────────────────────
let isMovingLayer = false;
let moveDragStart  = null;   // {mx,my,lx,ly}

// ── Mouse tracking ────────────────────────────────────────────────────────
let lastMouseX = 0, lastMouseY = 0;

// ── Image import ──────────────────────────────────────────────────────────
let importImg    = null;
let imgCropRect  = null;
let isCropDragging = false;
let cropDragStart  = null;

// ── Pan ───────────────────────────────────────────────────────────────────
let isPanning = false;
let panStart  = {x:0,y:0,px:0,py:0};

// ── Fonts ─────────────────────────────────────────────────────────────────
let uploadedFonts = [];
const cjkBitmapCache = new Map();

// ── Layer drag (panel reorder) ────────────────────────────────────────────
let panelDragId = null;

// ══════════════════════════════════════════════════════════════════════════
// DOM refs
// ══════════════════════════════════════════════════════════════════════════
const mainCanvas    = document.getElementById('mainCanvas');
const overlayCanvas = document.getElementById('overlayCanvas');
const previewCanvas = document.getElementById('previewCanvas');
const mCtx = mainCanvas.getContext('2d');
const oCtx = overlayCanvas.getContext('2d');
const pCtx = previewCanvas.getContext('2d');
const canvasArea    = document.getElementById('canvasArea');

// ══════════════════════════════════════════════════════════════════════════
// Layer management
// ══════════════════════════════════════════════════════════════════════════
function mkId() { return `l${++_layerSeq}_${Date.now()}`; }

function createLayer(name, type, x, y, w, h, grid) {
  return {
    id: mkId(), name: name || `圖層 ${_layerSeq}`,
    type: type || 'draw',
    visible: true, locked: false,
    x: x ?? 0, y: y ?? 0,
    w: w || W,  h: h || H,
    grid: grid || Array.from({length: h||H}, () => new Array(w||W).fill(0)),
  };
}

function getActiveLayer() {
  return layers.find(l => l.id === activeLayerId) || layers[0] || null;
}

// Composite: bottom-to-top merge of all visible layers
function getComposite() {
  const out = Array.from({length:H}, () => new Array(W).fill(0));
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    for (let gy = 0; gy < l.h; gy++) {
      for (let gx = 0; gx < l.w; gx++) {
        const rx = l.x + gx, ry = l.y + gy;
        if (rx >= 0 && ry >= 0 && rx < W && ry < H && l.grid[gy]?.[gx])
          out[ry][rx] = 1;
      }
    }
  }
  return out;
}

// Read a pixel from the active layer (local coords)
function glp(layer, lx, ly) {
  return (lx>=0&&ly>=0&&lx<layer.w&&ly<layer.h) ? (layer.grid[ly]?.[lx] ?? 0) : 0;
}
// Write a pixel to the active layer (local coords)
function slp(layer, lx, ly, v) {
  if (lx>=0&&ly>=0&&lx<layer.w&&ly<layer.h) {
    if (!layer.grid[ly]) layer.grid[ly] = new Array(layer.w).fill(0);
    layer.grid[ly][lx] = v;
  }
}

// Canvas-coord pixel ops (uses active layer offset)
function sp(x, y, v) {
  const l = getActiveLayer();
  if (!l || l.locked) return;
  slp(l, x - l.x, y - l.y, v);
}
function gp(x, y) {
  // Reads from the composite (for fill & selection detection)
  if (x<0||y<0||x>=W||y>=H) return -1;
  const comp = getComposite();
  return comp[y][x];
}

// ── Layer CRUD ────────────────────────────────────────────────────────────
function addLayer(name, type, x, y, w, h, grid) {
  const l = createLayer(name, type, x, y, w, h, grid);
  layers.unshift(l);        // add to top
  activeLayerId = l.id;
  refreshLayerPanel();
  return l;
}

function deleteLayer(id) {
  if (layers.length <= 1) { toast('至少需要一個圖層', 'err'); return; }
  const idx = layers.findIndex(l => l.id === id);
  if (idx < 0) return;
  saveUndo();
  layers.splice(idx, 1);
  if (activeLayerId === id) activeLayerId = layers[Math.min(idx, layers.length-1)].id;
  refreshLayerPanel(); render(); renderPreview(); updateInfo();
}

function duplicateLayer(id) {
  const src = layers.find(l => l.id === id);
  if (!src) return;
  saveUndo();
  const copy = createLayer(src.name + ' 副本', src.type,
    src.x + 4, src.y + 4, src.w, src.h, src.grid.map(r=>[...r]));
  const idx = layers.findIndex(l => l.id === id);
  layers.splice(idx, 0, copy);
  activeLayerId = copy.id;
  refreshLayerPanel(); render(); renderPreview();
  toast('圖層已複製', 'ok');
}

/** Copy a layer from the active page to a different page */
function copyLayerToPage(layerId, targetPageId) {
  // Ensure current page state is flushed first
  saveCurrentPage();

  const srcPage   = pages.find(p => p.id === activePageId);
  const targetPage= pages.find(p => p.id === targetPageId);
  if (!srcPage || !targetPage) return;

  // Find the layer in the current (flushed) page state
  const srcLayer = srcPage.layers.find(l => l.id === layerId);
  if (!srcLayer) return;

  const copy = {
    ...srcLayer,
    id: mkId(),
    name: srcLayer.name + ' (from ' + (srcPage.name) + ')',
    grid: srcLayer.grid.map(r => [...r]),
  };

  // Prepend to target page's layers
  targetPage.layers.unshift(copy);
  targetPage.activeLayerId = copy.id;

  // If we are currently viewing the target page, sync back to live state
  if (targetPageId === activePageId) {
    layers = targetPage.layers.map(l => ({...l, grid: l.grid.map(r=>[...r])}));
    activeLayerId = copy.id;
    refreshLayerPanel(); render(); renderPreview();
  }

  toast(`圖層「${srcLayer.name}」已複製到「${targetPage.name}」`, 'ok');
}

/** Show a dropdown near anchorEl listing all pages to copy layerId into */
function showCopyToPageDropdown(layerId, anchorEl) {
  // Close any existing dropdown
  document.getElementById('ctpDropdown')?.remove();

  const others = pages.filter(p => p.id !== activePageId);
  if (!others.length) {
    toast('沒有其他頁面，請先新增頁面', 'err');
    return;
  }

  const drop = document.createElement('div');
  drop.id = 'ctpDropdown';
  drop.className = 'ctp-dropdown';

  const label = document.createElement('div');
  label.className = 'ctp-label';
  label.textContent = '複製到頁面';
  drop.appendChild(label);

  others.forEach(pg => {
    const btn = document.createElement('button');
    btn.className = 'ctp-item';
    const ic = document.createElement('span');
    ic.className = 'material-icons';
    ic.textContent = 'insert_drive_file';
    const nm = document.createElement('span');
    nm.textContent = pg.name;
    btn.appendChild(ic); btn.appendChild(nm);
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLayerToPage(layerId, pg.id);
      drop.remove();
    });
    drop.appendChild(btn);
  });

  // Position below the anchor button
  const rect = anchorEl.getBoundingClientRect();
  drop.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.bottom+4}px;z-index:9999`;
  document.body.appendChild(drop);

  // Auto-close on outside click
  const onOutside = e => {
    if (!drop.contains(e.target) && e.target !== anchorEl) {
      drop.remove();
      document.removeEventListener('mousedown', onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
}

function mergeDown(id) {
  const idx = layers.findIndex(l => l.id === id);
  if (idx < 0 || idx >= layers.length - 1) { toast('已是最底層', 'err'); return; }
  saveUndo();
  const top = layers[idx], bot = layers[idx + 1];
  // Merge top into bot
  for (let gy = 0; gy < top.h; gy++) {
    for (let gx = 0; gx < top.w; gx++) {
      if (!top.grid[gy]?.[gx]) continue;
      const bx = top.x - bot.x + gx, by = top.y - bot.y + gy;
      slp(bot, bx, by, 1);
    }
  }
  layers.splice(idx, 1);
  activeLayerId = bot.id;
  refreshLayerPanel(); render(); renderPreview(); updateInfo();
  toast('已向下合併', 'ok');
}

function flattenAll() {
  saveUndo();
  const comp = getComposite();
  layers = [createLayer('背景', 'draw', 0, 0, W, H, comp)];
  activeLayerId = layers[0].id;
  refreshLayerPanel(); render(); renderPreview(); updateInfo();
  toast('已合併所有圖層', 'ok');
}

function reorderLayer(srcId, targetId) {
  if (srcId === targetId) return;
  saveUndo();
  const si = layers.findIndex(l => l.id === srcId);
  const ti = layers.findIndex(l => l.id === targetId);
  if (si < 0 || ti < 0) return;
  const [moved] = layers.splice(si, 1);
  layers.splice(ti, 0, moved);
  refreshLayerPanel(); render();
}

// ══════════════════════════════════════════════════════════════════════════
// Page management
// ══════════════════════════════════════════════════════════════════════════

function mkPageId() { return `pg_${++_layerSeq}_${Date.now()}`; }

/** Flush current canvas state into the active page object */
function saveCurrentPage() {
  const pg = pages.find(p => p.id === activePageId);
  if (!pg) return;
  pg.width  = W; pg.height = H;
  pg.layers = layers.map(l => ({...l, grid: l.grid.map(r => [...r])}));
  pg.activeLayerId = activeLayerId;
}

/** Load a page's state into the live canvas */
function loadPage(pageId) {
  saveCurrentPage();
  const pg = pages.find(p => p.id === pageId);
  if (!pg) return;
  activePageId = pageId;
  W = pg.width; H = pg.height;
  layers = pg.layers.map(l => ({...l, grid: l.grid.map(r => [...r])}));
  activeLayerId = pg.activeLayerId || layers[0]?.id;
  undoStack = []; redoStack = [];
  fitZoom(); initCanvas();
  refreshLayerPanel(); refreshPageTabs();
}

/** Create and switch to a new blank page */
function createNewPage(name) {
  saveCurrentPage();
  const bg = createLayer('背景', 'draw', 0, 0, W, H);
  const pg = { id: mkPageId(), name: name || `頁面 ${pages.length + 1}`,
    width: W, height: H, layers: [bg], activeLayerId: bg.id };
  pages.push(pg);
  activePageId = null; // suppress saveCurrentPage
  loadPage(pg.id);
}

/** Duplicate the given page and switch to it */
function duplicatePage(pageId) {
  saveCurrentPage();
  const src = pages.find(p => p.id === pageId);
  if (!src) return;
  const idMap = {};
  const newLayers = src.layers.map(l => {
    const nid = mkId(); idMap[l.id] = nid;
    return {...l, id: nid, grid: l.grid.map(r => [...r])};
  });
  const pg = { id: mkPageId(), name: src.name + ' 副本',
    width: src.width, height: src.height,
    layers: newLayers, activeLayerId: idMap[src.activeLayerId] || newLayers[0]?.id };
  const si = pages.findIndex(p => p.id === pageId);
  pages.splice(si + 1, 0, pg);
  activePageId = null;
  loadPage(pg.id);
  toast(`「${pg.name}」已複製`, 'ok');
}

/** Delete a page (requires at least 1 remaining) */
function deletePage(pageId) {
  if (pages.length <= 1) { toast('至少需要一個頁面', 'err'); return; }
  const idx = pages.findIndex(p => p.id === pageId);
  if (idx < 0) return;
  const wasActive = pageId === activePageId;
  pages.splice(idx, 1);
  if (wasActive) {
    activePageId = null;
    loadPage(pages[Math.min(idx, pages.length - 1)].id);
  } else {
    refreshPageTabs();
  }
}

/** Move page left or right in the page bar */
function movePage(pageId, dir) {
  const idx = pages.findIndex(p => p.id === pageId);
  const ni  = idx + dir;
  if (ni < 0 || ni >= pages.length) return;
  [pages[idx], pages[ni]] = [pages[ni], pages[idx]];
  refreshPageTabs();
}

/** Re-render the page tab bar */
function refreshPageTabs() {
  const tabsEl = document.getElementById('pageTabs');
  tabsEl.innerHTML = '';
  pages.forEach(pg => {
    const tab = document.createElement('div');
    tab.className = 'page-tab' + (pg.id === activePageId ? ' active' : '');
    tab.dataset.id = pg.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'page-tab-name';
    nameEl.textContent = pg.name;
    nameEl.contentEditable = 'true';
    nameEl.spellcheck = false;
    nameEl.addEventListener('click', e => {
      if (pg.id !== activePageId) { e.preventDefault(); loadPage(pg.id); }
    });
    nameEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
      e.stopPropagation();
    });
    nameEl.addEventListener('blur', () => {
      const v = nameEl.textContent.trim();
      pg.name = v || pg.name;
      nameEl.textContent = pg.name;
    });

    const dupeBtn = document.createElement('button');
    dupeBtn.className = 'page-tab-btn'; dupeBtn.title = '複製頁面';
    dupeBtn.innerHTML = '<span class="material-icons">copy_all</span>';
    dupeBtn.addEventListener('click', e => { e.stopPropagation(); duplicatePage(pg.id); });

    const delBtn = document.createElement('button');
    delBtn.className = 'page-tab-btn danger'; delBtn.title = '刪除頁面';
    delBtn.innerHTML = '<span class="material-icons">close</span>';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (pages.length <= 1) { toast('至少需要一個頁面', 'err'); return; }
      if (confirm(`刪除頁面「${pg.name}」？`)) deletePage(pg.id);
    });

    tab.appendChild(nameEl); tab.appendChild(dupeBtn); tab.appendChild(delBtn);
    tab.addEventListener('click', () => { if (pg.id !== activePageId) loadPage(pg.id); });
    tabsEl.appendChild(tab);
  });

  const cnt = document.getElementById('pageCount');
  if (cnt) cnt.textContent = `${pages.length} 頁`;
}

// ══════════════════════════════════════════════════════════════════════════
// Project export / import
// ══════════════════════════════════════════════════════════════════════════

function exportProject() {
  saveCurrentPage();
  const pn = document.getElementById('projectName')?.value.trim() || projectName;
  projectName = pn;
  const proj = {
    version: '1.0', name: pn,
    pages: pages.map(p => ({...p, layers: p.layers.map(l => ({...l, grid: l.grid.map(r=>[...r])}))})),
    activePageId,
  };
  dlText(JSON.stringify(proj, null, 2), pn + '.oled.json', 'application/json');
  toast('專案已匯出', 'ok');
}

function importProjectFile(file) {
  const r = new FileReader();
  r.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      if (d.pages && Array.isArray(d.pages) && d.pages.length) {
        // ── Project format ──
        projectName = d.name || '匯入專案';
        const pnEl = document.getElementById('projectName');
        if (pnEl) pnEl.value = projectName;
        pages = d.pages.map(p => ({
          ...p,
          layers: (p.layers||[]).map(l=>({...l, grid:(l.grid||[]).map(r=>[...r])}))
        }));
        activePageId = null;
        loadPage(d.activePageId || pages[0].id);
        toast(`專案「${projectName}」已載入（${pages.length} 頁）`, 'ok');
      } else if (d.width && d.height) {
        // ── Single-page / legacy format ── append as new page
        saveCurrentPage();
        const bg = d.layers
          ? d.layers.map(l=>({...l, id: mkId(), grid:(l.grid||[]).map(r=>[...r])}))
          : [createLayer('背景','draw',0,0,d.width,d.height, (d.pixels||[]).map(r=>[...r]))];
        const pg = { id: mkPageId(), name: d.name || '匯入頁面',
          width: d.width, height: d.height,
          layers: bg, activeLayerId: bg[0]?.id };
        pages.push(pg);
        activePageId = null;
        loadPage(pg.id);
        toast('頁面已匯入為新頁面', 'ok');
      } else {
        throw new Error('無法識別的格式');
      }
    } catch(err) { toast('匯入失敗：' + err.message, 'err'); }
  };
  r.readAsText(file);
}

// ══════════════════════════════════════════════════════════════════════════
// Canvas init (layer init now happens via initPages → createNewPage)
// ══════════════════════════════════════════════════════════════════════════
function initLayers() {
  // Initialize first page
  const bg = createLayer('背景', 'draw', 0, 0, W, H);
  const pg = { id: mkPageId(), name: '頁面 1', width: W, height: H,
               layers: [bg], activeLayerId: bg.id };
  pages     = [pg];
  activePageId = pg.id;
  layers    = [createLayer('背景', 'draw', 0, 0, W, H)];
  activeLayerId = layers[0].id;
  pg.activeLayerId = layers[0].id;
}

function initCanvas() {
  mainCanvas.width = overlayCanvas.width = W * zoom;
  mainCanvas.height = overlayCanvas.height = H * zoom;
  previewCanvas.width = W; previewCanvas.height = H;
  previewCanvas.style.aspectRatio = `${W}/${H}`;
  render(); renderPreview(); updateInfo();
}

function fitZoom() {
  const aW = canvasArea.clientWidth - 40, aH = canvasArea.clientHeight - 40;
  zoom = Math.max(1, Math.min(Math.floor(aW/W), Math.floor(aH/H), 24));
}

function init() {
  initLayers(); fitZoom(); initCanvas();
  bindEvents(); updateToolHighlight(); syncBrushPreview();
  buildIconPanel(); refreshLayerPanel(); refreshPageTabs();
  document.getElementById('previewInfo').textContent = `${W}×${H} px`;
  const pnEl = document.getElementById('projectName');
  if (pnEl) pnEl.value = projectName;
  syncThresholdLabel();
  loadCodepoints(); _ensureFont();
}

// ══════════════════════════════════════════════════════════════════════════
// Render
// ══════════════════════════════════════════════════════════════════════════
function render() {
  const cs = zoom, cw = mainCanvas.width, ch = mainCanvas.height;
  mCtx.fillStyle = '#060d14'; mCtx.fillRect(0, 0, cw, ch);

  const activeId = activeLayerId;

  // Draw layers bottom-to-top
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l.visible) continue;
    const isActive = l.id === activeId;

    // Lit pixels
    mCtx.fillStyle = isActive ? '#00e57a' : 'rgba(0,220,110,0.55)';
    for (let gy = 0; gy < l.h; gy++) {
      for (let gx = 0; gx < l.w; gx++) {
        if (!l.grid[gy]?.[gx]) continue;
        const rx = l.x + gx, ry = l.y + gy;
        if (rx>=0&&ry>=0&&rx<W&&ry<H) mCtx.fillRect(rx*cs, ry*cs, cs, cs);
      }
    }

    // Show non-background object layer bounding box
    if (isActive && l.type !== 'draw') {
      mCtx.strokeStyle = 'rgba(59,158,255,0.55)'; mCtx.lineWidth = 1; mCtx.setLineDash([3,3]);
      mCtx.strokeRect(l.x*cs + .5, l.y*cs + .5, l.w*cs, l.h*cs);
      mCtx.setLineDash([]);
    }
  }

  // Shape preview
  if (shapePreview) {
    mCtx.fillStyle = drawColor ? 'rgba(0,229,122,.6)' : 'rgba(5,13,20,.85)';
    for (const [px,py] of shapePreview)
      if (px>=0&&py>=0&&px<W&&py<H) mCtx.fillRect(px*cs, py*cs, cs, cs);
  }

  // Text / icon floating preview
  const preview = textPreview || iconPreview;
  if (preview) {
    const {grid, x:tx, y:ty} = preview;
    const tw = grid[0]?.length||0, th = grid.length;
    mCtx.fillStyle = 'rgba(59,158,255,.72)';
    for (let gy=0; gy<th; gy++)
      for (let gx=0; gx<tw; gx++)
        if (grid[gy]?.[gx]) {
          const px=tx+gx, py=ty+gy;
          if (px>=0&&py>=0&&px<W&&py<H) mCtx.fillRect(px*cs, py*cs, cs, cs);
        }
    oCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
    oCtx.strokeStyle='rgba(59,158,255,.8)'; oCtx.lineWidth=1; oCtx.setLineDash([4,4]);
    oCtx.strokeRect(tx*cs+.5, ty*cs+.5, tw*cs, th*cs);
    oCtx.setLineDash([]); return;
  }

  // Grid
  if (showGrid && cs >= 4) {
    mCtx.strokeStyle='rgba(255,255,255,.04)'; mCtx.lineWidth=.5; mCtx.beginPath();
    for (let x=0;x<=W;x++){mCtx.moveTo(x*cs,0);mCtx.lineTo(x*cs,ch);}
    for (let y=0;y<=H;y++){mCtx.moveTo(0,y*cs);mCtx.lineTo(cw,y*cs);}
    mCtx.stroke();
    if (cs>=6) {
      mCtx.strokeStyle='rgba(255,255,255,.09)'; mCtx.lineWidth=1; mCtx.beginPath();
      for (let x=0;x<=W;x+=8){mCtx.moveTo(x*cs,0);mCtx.lineTo(x*cs,ch);}
      for (let y=0;y<=H;y+=8){mCtx.moveTo(0,y*cs);mCtx.lineTo(cw,y*cs);}
      mCtx.stroke();
    }
  }

  // Selection / overlay
  oCtx.clearRect(0,0,overlayCanvas.width,overlayCanvas.height);
  if (selectRect) {
    const{x,y,w,h}=selectRect;
    oCtx.strokeStyle='#3b9eff'; oCtx.lineWidth=1; oCtx.setLineDash([4,4]);
    oCtx.strokeRect(x*cs+.5,y*cs+.5,w*cs,h*cs);
    oCtx.setLineDash([]);
  }
}

function renderPreview() {
  const comp = getComposite();
  pCtx.fillStyle='#000'; pCtx.fillRect(0,0,W,H);
  pCtx.fillStyle='#fff';
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (comp[y][x]) pCtx.fillRect(x,y,1,1);
}

// Render a layer thumbnail (shows position on canvas)
function renderThumb(layer, canvas) {
  const tw=canvas.width, th=canvas.height;
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#0a0f1a'; ctx.fillRect(0,0,tw,th);
  const sx=tw/W, sy=th/H;
  ctx.fillStyle='#00e57a';
  for (let gy=0;gy<layer.h;gy++) {
    for (let gx=0;gx<layer.w;gx++) {
      if (!layer.grid[gy]?.[gx]) continue;
      const rx=layer.x+gx, ry=layer.y+gy;
      if (rx>=0&&ry>=0&&rx<W&&ry<H)
        ctx.fillRect(Math.floor(rx*sx), Math.floor(ry*sy),
                     Math.max(1,Math.ceil(sx)), Math.max(1,Math.ceil(sy)));
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Undo / Redo  (snapshot full layers array)
// ══════════════════════════════════════════════════════════════════════════
function snapState() {
  return { activeLayerId, layers: layers.map(l=>({...l, grid:l.grid.map(r=>[...r])})) };
}
function applyState(s) {
  layers = s.layers; activeLayerId = s.activeLayerId;
  refreshLayerPanel(); render(); renderPreview(); updateInfo();
}

function saveUndo() {
  undoStack.push(snapState());
  if (undoStack.length>MAX_UNDO) undoStack.shift();
  redoStack=[];
}
function undo() { if(!undoStack.length)return; redoStack.push(snapState()); applyState(undoStack.pop()); }
function redo() { if(!redoStack.length)return; undoStack.push(snapState()); applyState(redoStack.pop()); }

// ══════════════════════════════════════════════════════════════════════════
// Drawing primitives (operate in canvas coords, write to active layer)
// ══════════════════════════════════════════════════════════════════════════
function stamp(cx, cy, col) {
  const l=getActiveLayer(); if(!l||l.locked) return;
  if (brushSize<=1) { slp(l, cx-l.x, cy-l.y, col); return; }
  const r=(brushSize-1)/2;
  for (let dy=-Math.ceil(r);dy<=Math.ceil(r);dy++)
    for (let dx=-Math.ceil(r);dx<=Math.ceil(r);dx++)
      if (Math.hypot(dx,dy)<=r+0.5) slp(l, cx+dx-l.x, cy+dy-l.y, col);
}

function bLine(x0,y0,x1,y1,col,arr){
  let dx=Math.abs(x1-x0),dy=Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1,err=dx-dy;
  while(true){arr?arr.push([x0,y0]):sp(x0,y0,col);if(x0===x1&&y0===y1)break;let e2=2*err;if(e2>-dy){err-=dy;x0+=sx;}if(e2<dx){err+=dx;y0+=sy;}}
}
function bRect(x0,y0,x1,y1,fill,arr){
  const lx=Math.min(x0,x1),rx=Math.max(x0,x1),ly=Math.min(y0,y1),ry=Math.max(y0,y1);
  for(let y=ly;y<=ry;y++)for(let x=lx;x<=rx;x++)if(fill||x===lx||x===rx||y===ly||y===ry)arr?arr.push([x,y]):sp(x,y,drawColor);
}
function bCircle(cx,cy,ex,ey,fill,arr){
  const r=Math.round(Math.hypot(ex-cx,ey-cy));let x=0,y=r,d=3-2*r;
  const p8=(ox,oy)=>{
    const pts=[[cx+ox,cy+oy],[cx-ox,cy+oy],[cx+ox,cy-oy],[cx-ox,cy-oy],[cx+oy,cy+ox],[cx-oy,cy+ox],[cx+oy,cy-ox],[cx-oy,cy-ox]];
    if(fill){const rows=new Map();pts.forEach(([px,py])=>{if(!rows.has(py))rows.set(py,[]);rows.get(py).push(px);});rows.forEach((xs,ry)=>{const mn=Math.min(...xs),mx=Math.max(...xs);for(let ix=mn;ix<=mx;ix++)arr?arr.push([ix,ry]):sp(ix,ry,drawColor);});}
    else pts.forEach(([px,py])=>arr?arr.push([px,py]):sp(px,py,drawColor));
  };
  while(x<=y){p8(x,y);if(d<0)d+=4*x+6;else{d+=4*(x-y)+10;y--;}x++;}
}
function floodFill(sx,sy,tgt,fillColor){
  if(tgt===fillColor)return;
  const l=getActiveLayer(); if(!l) return;
  const stack=[[sx,sy]],vis=new Set();
  while(stack.length){
    const[x,y]=stack.pop(),k=`${x},${y}`;
    if(vis.has(k)||x<0||y<0||x>=W||y>=H) continue;
    const lx=x-l.x,ly=y-l.y;
    if(lx<0||ly<0||lx>=l.w||ly>=l.h||glp(l,lx,ly)!==tgt) continue;
    vis.add(k); slp(l,lx,ly,fillColor);
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Transforms (operate on active layer)
// ══════════════════════════════════════════════════════════════════════════
function flipH(){
  const l=getActiveLayer();if(!l)return;saveUndo();
  l.grid.forEach(r=>r.reverse());render();renderPreview();
}
function flipV(){
  const l=getActiveLayer();if(!l)return;saveUndo();
  l.grid.reverse();render();renderPreview();
}
function invert(){
  const l=getActiveLayer();if(!l)return;saveUndo();
  for(let y=0;y<l.h;y++)for(let x=0;x<l.w;x++)l.grid[y][x]^=1;
  render();renderPreview();updateInfo();
}
function rotCW(){
  const l=getActiveLayer();if(!l)return;saveUndo();
  const np=Array.from({length:l.w},(_,x)=>Array.from({length:l.h},(_,y)=>l.grid[l.h-1-y][x]));
  [l.w,l.h]=[l.h,l.w];l.grid=np;
  // If background layer, also update W/H
  if(l.x===0&&l.y===0&&l.w===H&&l.h===W){[W,H]=[H,W];fitZoom();initCanvas();}
  else render();renderPreview();
}
function rotCCW(){rotCW();rotCW();rotCW();}
function shift(dx,dy){
  const l=getActiveLayer();if(!l)return;saveUndo();
  l.x+=dx;l.y+=dy;render();renderPreview();
}
function centerH(){
  const l=getActiveLayer();if(!l)return;saveUndo();
  // Find content extents in canvas coords
  let mn=W,mx=-1;
  for(let gy=0;gy<l.h;gy++)for(let gx=0;gx<l.w;gx++)
    if(l.grid[gy]?.[gx]){const rx=l.x+gx;mn=Math.min(mn,rx);mx=Math.max(mx,rx);}
  if(mx<0)return;
  l.x+=Math.round((W-(mx-mn+1))/2)-mn;
  render();renderPreview();
}

// ══════════════════════════════════════════════════════════════════════════
// Text rendering  (supersampling + relative threshold)
// ══════════════════════════════════════════════════════════════════════════

// Supersampling scale for a given target pixel size
// Smaller targets need more oversampling to preserve strokes
function ssScale(size) {
  if (size <= 8)  return 8;
  if (size <= 12) return 6;
  if (size <= 20) return 4;
  if (size <= 36) return 3;
  return 2;
}

// Apply adaptive threshold: threshPct (1-100) = % of max brightness to include
// Low value → include dim/thin strokes; high value → only bright core pixels
function applyRelThreshold(data, w, h, threshPct) {
  let maxB = 0;
  for (let i = 0; i < w * h; i++) { const v = data[i * 4]; if (v > maxB) maxB = v; }
  if (maxB === 0) return null;
  const thresh = Math.max(1, maxB * (threshPct / 100));
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(data[(y * w + x) * 4] >= thresh ? 1 : 0);
    grid.push(row);
  }
  return grid;
}

/**
 * renderTextCanvas – renders text via canvas with supersampling.
 * threshPct: 1–100, percentage of max brightness to include.
 *   Low  (5–20%):  captures thin anti-aliased strokes → more detail
 *   High (60–90%): keeps only bright core → thicker/bolder look
 */
function renderTextCanvas(text, family, size, bold, italic, threshPct) {
  if (!text) return null;
  const SCALE   = ssScale(size);
  const bSize   = size * SCALE;
  const fontStr = `${italic?'italic':''} ${bold?'bold':''} ${bSize}px ${family}`.trim();

  // Measure at high resolution
  const mc = document.createElement('canvas');
  mc.width = 8192; mc.height = bSize * 4;
  const mx = mc.getContext('2d'); mx.font = fontStr;
  const m   = mx.measureText(text);
  const bW  = Math.ceil(m.width) + bSize;
  const bH  = bSize + Math.ceil(m.actualBoundingBoxDescent || bSize * 0.3) + 8;

  // Render at bSize
  const hc = document.createElement('canvas');
  hc.width  = Math.max(bW, 1);
  hc.height = Math.max(bH, 1);
  const hx  = hc.getContext('2d');
  hx.fillStyle = '#000'; hx.fillRect(0, 0, hc.width, hc.height);
  hx.fillStyle = '#fff'; hx.font = fontStr; hx.textBaseline = 'top';
  hx.fillText(text, bSize * 0.125, bSize * 0.125);

  // Downsample to target size
  const tw = Math.max(Math.ceil(bW / SCALE), 1);
  const th = Math.max(Math.ceil(bH / SCALE), 1);
  const lc = document.createElement('canvas');
  lc.width = tw; lc.height = th;
  const lx = lc.getContext('2d');
  lx.imageSmoothingEnabled = true;
  lx.imageSmoothingQuality = 'high';
  lx.drawImage(hc, 0, 0, tw, th);

  const grid = applyRelThreshold(lx.getImageData(0, 0, tw, th).data, tw, th, threshPct);
  if (!grid) return null;
  return trimGrid(grid);
}

// ── CJK bitmap (supersampled, relative threshold, cached raw grayscale) ───
const CJK_FONTS = {
  cjk_8:      {size:8,  family:"'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"},
  cjk_12:     {size:12, family:"'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"},
  cjk_16:     {size:16, family:"'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"},
  cjk_24:     {size:24, family:"'Microsoft JhengHei','PingFang TC','Noto Sans TC',sans-serif"},
  cjk_16_song:{size:16, family:"'KaiTi','STKaiti','BiauKai',serif"},
  cjk_16_mono:{size:16, family:"'MingLiU','SimSun',monospace"},
};

// Cache stores raw Float32 grayscale so threshold can be re-applied without re-render
const cjkRawCache = new Map();  // `${ch}:${size}:${family}` → {raw, w, h, maxB}

function getCJKRaw(ch, size, family) {
  const key = `${ch}:${size}:${family}`;
  if (cjkRawCache.has(key)) return cjkRawCache.get(key);

  const SCALE = ssScale(size);
  const bSize = size * SCALE;
  const tc    = document.createElement('canvas');
  tc.width    = bSize * 2; tc.height = bSize * 2;
  const tx    = tc.getContext('2d');
  tx.fillStyle = '#000'; tx.fillRect(0, 0, tc.width, tc.height);
  tx.fillStyle = '#fff'; tx.font = `${bSize}px ${family}`; tx.textBaseline = 'top';
  tx.fillText(ch, 0, 0);
  const bw = Math.max(Math.ceil(tx.measureText(ch).width), 1);

  const lc = document.createElement('canvas');
  lc.width  = Math.max(Math.ceil(bw / SCALE), 1);
  lc.height = Math.max(size, 1);
  const lx  = lc.getContext('2d');
  lx.imageSmoothingEnabled = true; lx.imageSmoothingQuality = 'high';
  lx.drawImage(tc, 0, 0, bw, bSize, 0, 0, lc.width, lc.height);

  const imgData = lx.getImageData(0, 0, lc.width, lc.height).data;
  const raw = new Uint8Array(lc.width * lc.height);
  let maxB = 0;
  for (let i = 0; i < raw.length; i++) { raw[i] = imgData[i * 4]; if (raw[i] > maxB) maxB = raw[i]; }

  const entry = {raw, w: lc.width, h: lc.height, maxB};
  cjkRawCache.set(key, entry);
  return entry;
}

function renderCJKChar(ch, size, family, threshPct) {
  const {raw, w, h, maxB} = getCJKRaw(ch, size, family);
  const thresh = Math.max(1, maxB * (threshPct / 100));
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(raw[y * w + x] >= thresh ? 1 : 0);
    grid.push(row);
  }
  return grid;
}

function renderCJKText(text, fontKey, spacing, threshPct) {
  const cfg = CJK_FONTS[fontKey] || CJK_FONTS.cjk_16;
  const {size, family} = cfg, sp = spacing || 1;
  const charGrids = [];
  for (const ch of text) charGrids.push(renderCJKChar(ch, size, family, threshPct));
  if (!charGrids.length) return null;
  const h      = charGrids[0].length;
  const totalW = charGrids.reduce((s, g) => s + (g[0]?.length || 0), 0) + (charGrids.length - 1) * sp;
  const grid   = Array.from({length: h}, () => new Array(totalW).fill(0));
  let x = 0;
  for (const cg of charGrids) {
    const cw = cg[0]?.length || 0;
    for (let cy = 0; cy < h; cy++) for (let cx2 = 0; cx2 < cw; cx2++) grid[cy][x + cx2] = cg[cy][cx2];
    x += cw + sp;
  }
  return {grid, width: totalW, height: h};
}

function trimGrid(grid) {
  let top = grid.length, bot = 0, lft = grid[0]?.length || 0, rgt = 0;
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < (grid[y]?.length || 0); x++)
      if (grid[y][x]) { top=Math.min(top,y); bot=Math.max(bot,y); lft=Math.min(lft,x); rgt=Math.max(rgt,x); }
  if (bot < top) return {grid: [[0]], width: 1, height: 1};
  const out = [];
  for (let y = top; y <= bot; y++) out.push(grid[y].slice(lft, rgt + 1));
  return {grid: out, width: rgt - lft + 1, height: bot - top + 1};
}

// ══════════════════════════════════════════════════════════════════════════
// Live text preview
// ══════════════════════════════════════════════════════════════════════════
function buildTextGrid(){
  const txt=document.getElementById('textInput').value; if(!txt.trim())return null;
  // threshold is now 1-100 (% of max brightness); lower = more detail / thinner strokes
  const threshPct = Math.max(1, Math.min(100, parseInt(document.getElementById('threshold').value) || 20));
  if(fontMode==='canvas')return renderTextCanvas(
    txt, document.getElementById('fontFamily').value,
    parseInt(document.getElementById('fontSizePreset').value)||12,
    document.getElementById('chkBold').checked,
    document.getElementById('chkItalic').checked,
    threshPct
  );
  const fk=document.getElementById('bitmapFont').value;
  const sp=parseInt(document.getElementById('charSpacing').value)||1;
  return CJK_FONTS[fk] ? renderCJKText(txt,fk,sp,threshPct) : renderText(txt,fk,sp,fk.includes('bold'));
}
function autoUpdateTextPreview(){
  if(tool!=='text')return;
  const result=buildTextGrid();
  if(!result||!result.grid.length){textPreview=null;document.getElementById('liveHint').style.display='none';render();return;}
  if(textPreview)textPreview.grid=result.grid;
  else textPreview={grid:result.grid,x:lastMouseX,y:lastMouseY};
  document.getElementById('liveHint').style.display='';render();
}
function startTextPlacement(){
  const result=buildTextGrid();if(!result||!result.grid.length){toast('請輸入文字或選擇字體','err');return;}
  textPreview={grid:result.grid,x:lastMouseX,y:lastMouseY};iconPreview=null;render();
  toast('移動滑鼠定位 · 點擊或 Enter 放置 · Esc 取消');
}
function commitText(){
  if(!textPreview)return;saveUndo();
  const{grid,x:tx,y:ty}=textPreview;const h=grid.length,w=grid[0]?.length||0;
  const cnt=layers.filter(l=>l.type==='text').length+1;
  addLayer(`文字 ${cnt}`,'text',tx,ty,w,h,grid.map(r=>[...r]));
  textPreview=null;document.getElementById('liveHint').style.display='none';
  render();renderPreview();updateInfo();toast('文字已放置為新圖層','ok');
}
function cancelText(){textPreview=null;iconPreview=null;document.getElementById('liveHint').style.display='none';render();}

// ══════════════════════════════════════════════════════════════════════════
// Font upload
// ══════════════════════════════════════════════════════════════════════════
async function uploadFont(file){
  const base=file.name.replace(/\.[^.]+$/,''),safe=base.replace(/[^a-zA-Z0-9\-_]/g,'_');
  const url=URL.createObjectURL(file);
  try{const face=new FontFace(safe,`url(${url})`);await face.load();document.fonts.add(face);uploadedFonts.push({name:safe,displayName:base,url});refreshFontUI();document.getElementById('fontFamily').value=safe;toast(`字體「${base}」載入成功`,'ok');}
  catch(e){URL.revokeObjectURL(url);toast('字體載入失敗：'+e.message,'err');}
}
function refreshFontUI(){
  const grp=document.getElementById('uploadedFontsGroup'),list=document.getElementById('uploadedFontsList');
  while(grp.firstChild)grp.removeChild(grp.firstChild);
  uploadedFonts.forEach(f=>{const o=document.createElement('option');o.value=f.name;o.textContent=f.displayName;grp.appendChild(o);});
  grp.style.display=uploadedFonts.length?'':'none';list.style.display=uploadedFonts.length?'flex':'none';
  list.innerHTML=uploadedFonts.map(f=>`<div class="uploaded-font-tag"><span>${f.displayName}</span><button onclick="removeFont('${f.name}')">✕</button></div>`).join('');
}
function removeFont(name){const idx=uploadedFonts.findIndex(f=>f.name===name);if(idx<0)return;URL.revokeObjectURL(uploadedFonts[idx].url);uploadedFonts.splice(idx,1);refreshFontUI();if(document.getElementById('fontFamily').value===name)document.getElementById('fontFamily').value='sans-serif';}

// ══════════════════════════════════════════════════════════════════════════
// Icon panel
// ══════════════════════════════════════════════════════════════════════════
function buildIconPanel(){
  const tabsEl=document.getElementById('iconCatTabs');
  const catNames=Object.keys(MATERIAL_ICON_CATS);iconCat=catNames[0];
  tabsEl.innerHTML=catNames.map(c=>`<button class="icon-cat-btn" data-cat="${c}">${c}</button>`).join('');
  tabsEl.querySelectorAll('.icon-cat-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{iconCat=btn.dataset.cat;_currentSearchResults=null;document.getElementById('iconSearch').value='';document.getElementById('btnClearSearch').style.display='none';tabsEl.querySelectorAll('.icon-cat-btn').forEach(b=>b.classList.toggle('active',b===btn));showIconList(MATERIAL_ICON_CATS[iconCat]);});
  });
  tabsEl.querySelector('.icon-cat-btn')?.classList.add('active');showIconList(MATERIAL_ICON_CATS[iconCat]);
  document.getElementById('iconCountBadge').textContent=Object.values(MATERIAL_ICON_CATS).flat().length+' 個圖示';
}
function showIconList(names){
  const gridEl=document.getElementById('iconGrid');gridEl.innerHTML='';
  if(!names?.length){gridEl.innerHTML='<div class="icon-no-result">無符合結果</div>';return;}
  const size=parseInt(document.getElementById('iconSize').value)||16;
  const frag=document.createDocumentFragment();
  names.forEach(name=>{
    const cell=document.createElement('div');cell.className='icon-cell';cell.title=name.replace(/_/g,' ');
    const ic=document.createElement('span');ic.className='material-icons mi-cell-icon';ic.textContent=name;
    const lbl=document.createElement('span');lbl.className='icon-cell-label';lbl.textContent=name.replace(/_/g,' ');
    cell.appendChild(ic);cell.appendChild(lbl);
    cell.addEventListener('click',()=>startIconPlacement(name,size));
    frag.appendChild(cell);
  });
  gridEl.appendChild(frag);
}
async function startIconPlacement(name,size){
  document.getElementById('iconLoadHint').style.display='flex';
  try{
    const result=await materialIconToGrid(name,size);
    if(!result.valid){toast(`「${name}」在此尺寸無法渲染`,'err');return;}
    iconPreview={grid:result.grid,x:lastMouseX,y:lastMouseY};textPreview=null;render();
    toast(`${name.replace(/_/g,' ')} · ${size}px · 點擊或 Enter 放置`);
  }catch(e){toast('圖示渲染失敗：'+e.message,'err');}
  finally{document.getElementById('iconLoadHint').style.display='none';}
}
function commitIcon(){
  if(!iconPreview)return;saveUndo();
  const{grid,x:tx,y:ty}=iconPreview;const h=grid.length,w=grid[0]?.length||0;
  const cnt=layers.filter(l=>l.type==='icon').length+1;
  addLayer(`圖示 ${cnt}`,'icon',tx,ty,w,h,grid.map(r=>[...r]));
  iconPreview=null;render();renderPreview();updateInfo();toast('圖示已放置為新圖層','ok');
}

// ══════════════════════════════════════════════════════════════════════════
// Image import
// ══════════════════════════════════════════════════════════════════════════
function handleImageSelect(file){
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{importImg={src:img};imgCropRect=null;document.getElementById('imgImportOpts').style.display='block';setupCropCanvas(img);updateImgPreview();URL.revokeObjectURL(url);};
  img.onerror=()=>{toast('無法讀取圖片','err');URL.revokeObjectURL(url);};img.src=url;
}
function setupCropCanvas(img){
  const cc=document.getElementById('imgCropCanvas');
  const PANEL_W=196,PANEL_H=140;const scale=Math.min(PANEL_W/img.width,PANEL_H/img.height,1);
  cc.width=Math.max(Math.round(img.width*scale),1);cc.height=Math.max(Math.round(img.height*scale),1);
  cc._img=img;cc._scale=scale;drawCropCanvas();
}
function drawCropCanvas(){
  const cc=document.getElementById('imgCropCanvas');if(!cc._img)return;
  const ctx=cc.getContext('2d'),s=cc._scale,img=cc._img,cw=cc.width,ch=cc.height;
  ctx.drawImage(img,0,0,cw,ch);
  const cr=imgCropRect||{x:0,y:0,w:img.width,h:img.height};
  const dx=cr.x*s,dy=cr.y*s,dw=cr.w*s,dh=cr.h*s;
  ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(0,0,cw,dy);ctx.fillRect(0,dy+dh,cw,ch-dy-dh);ctx.fillRect(0,dy,dx,dh);ctx.fillRect(dx+dw,dy,cw-dx-dw,dh);
  ctx.strokeStyle='#00e57a';ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.strokeRect(dx+.75,dy+.75,dw-1.5,dh-1.5);ctx.setLineDash([]);
  const hs=5;ctx.fillStyle='#00e57a';[[dx,dy],[dx+dw,dy],[dx,dy+dh],[dx+dw,dy+dh]].forEach(([hx,hy])=>ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs));
  document.getElementById('imgCropInfo').textContent=imgCropRect?`裁切：${cr.w}×${cr.h} → ${W}×${H}`:`全圖：${img.width}×${img.height} → ${W}×${H}`;
}
function setupCropEvents(){
  const cc=document.getElementById('imgCropCanvas');
  cc.addEventListener('mousedown',e=>{if(!cc._img)return;const r=cc.getBoundingClientRect(),s=cc._scale;cropDragStart={ix:Math.round((e.clientX-r.left)/s),iy:Math.round((e.clientY-r.top)/s)};isCropDragging=true;e.preventDefault();});
  cc.addEventListener('mousemove',e=>{if(!isCropDragging||!cropDragStart||!cc._img)return;const r=cc.getBoundingClientRect(),s=cc._scale,img=cc._img;const ix=Math.round((e.clientX-r.left)/s),iy=Math.round((e.clientY-r.top)/s);const x=Math.max(0,Math.min(cropDragStart.ix,ix)),y=Math.max(0,Math.min(cropDragStart.iy,iy));const w=Math.max(1,Math.abs(ix-cropDragStart.ix)),h=Math.max(1,Math.abs(iy-cropDragStart.iy));imgCropRect={x,y,w:Math.min(w,img.width-x),h:Math.min(h,img.height-y)};drawCropCanvas();updateImgPreview();});
  window.addEventListener('mouseup',()=>{isCropDragging=false;});
}
function getSourceRect(img){return imgCropRect?{sx:imgCropRect.x,sy:imgCropRect.y,sw:imgCropRect.w,sh:imgCropRect.h}:{sx:0,sy:0,sw:img.width,sh:img.height};}
function scaleImageToCanvas(img,mode){
  const tc=document.createElement('canvas');tc.width=W;tc.height=H;const tx=tc.getContext('2d');tx.fillStyle='#000';tx.fillRect(0,0,W,H);
  const{sx,sy,sw,sh}=getSourceRect(img);
  if(mode==='fit'){const scale=Math.min(W/sw,H/sh);const dw=sw*scale,dh=sh*scale,dx=(W-dw)/2,dy=(H-dh)/2;tx.drawImage(img,sx,sy,sw,sh,dx,dy,dw,dh);}
  else if(mode==='fill'){const scale=Math.max(W/sw,H/sh);const visW=W/scale,visH=H/scale;tx.drawImage(img,sx+(sw-visW)/2,sy+(sh-visH)/2,visW,visH,0,0,W,H);}
  else tx.drawImage(img,sx,sy,sw,sh,0,0,W,H);
  return tc.getContext('2d').getImageData(0,0,W,H);
}
function applyThreshold(data,t){const g=Array.from({length:H},()=>new Array(W).fill(0));for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;g[y][x]=(0.299*data.data[i]+0.587*data.data[i+1]+0.114*data.data[i+2])>t?1:0;}return g;}
function floydSteinberg(data,t){
  const gray=new Float32Array(W*H);for(let i=0;i<W*H;i++)gray[i]=0.299*data.data[i*4]+0.587*data.data[i*4+1]+0.114*data.data[i*4+2];
  const g=Array.from({length:H},()=>new Array(W).fill(0));
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const old=gray[y*W+x],nv=old>t?255:0,err=old-nv;g[y][x]=nv>128?1:0;if(x+1<W)gray[y*W+x+1]+=err*7/16;if(y+1<H){if(x>0)gray[(y+1)*W+x-1]+=err*3/16;gray[(y+1)*W+x]+=err*5/16;if(x+1<W)gray[(y+1)*W+x+1]+=err/16;}}
  return g;
}
const BAYER4=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
function orderedDither(data,t){const g=Array.from({length:H},()=>new Array(W).fill(0));for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;const gray=0.299*data.data[i]+0.587*data.data[i+1]+0.114*data.data[i+2];g[y][x]=gray>t*(0.7+0.3*BAYER4[y%4][x%4]/15)?1:0;}return g;}
function updateImgPreview(){
  if(!importImg?.src)return;
  const mode=document.getElementById('imgScaleMode').value;const t=parseInt(document.getElementById('imgThreshold').value)||128;const dither=document.getElementById('imgDither').value;
  const imgData=scaleImageToCanvas(importImg.src,mode);
  const grid=dither==='floyd'?floydSteinberg(imgData,t):dither==='ordered'?orderedDither(imgData,t):applyThreshold(imgData,t);
  importImg.previewGrid=grid;
  const pc=document.getElementById('imgPreviewCanvas');pc.width=W;pc.height=H;pc.style.aspectRatio=`${W}/${H}`;
  const px=pc.getContext('2d');px.fillStyle='#000';px.fillRect(0,0,W,H);px.fillStyle='#fff';
  for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(grid[y][x])px.fillRect(x,y,1,1);
}
function applyImageImport(){
  if(!importImg?.previewGrid){toast('請先選擇圖片','err');return;}
  saveUndo();
  const grid=importImg.previewGrid.map(r=>[...r]);
  const cnt=layers.filter(l=>l.type==='image').length+1;
  addLayer(`圖片 ${cnt}`,'image',0,0,W,H,grid);
  importImg=null;imgCropRect=null;document.getElementById('imgImportOpts').style.display='none';
  render();renderPreview();updateInfo();toast('圖片已匯入為新圖層','ok');
}

// ══════════════════════════════════════════════════════════════════════════
// Selection (operates on active layer)
// ══════════════════════════════════════════════════════════════════════════
function selPx(){
  if(!selectRect)return null;const l=getActiveLayer();if(!l)return null;
  const{x,y,w,h}=selectRect;
  return Array.from({length:h},(_,dy)=>Array.from({length:w},(_,dx)=>glp(l,x+dx-l.x,y+dy-l.y)));
}
function clearSel(){if(!selectRect)return;saveUndo();const l=getActiveLayer();if(!l)return;const{x,y,w,h}=selectRect;for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)slp(l,x+dx-l.x,y+dy-l.y,0);render();renderPreview();updateInfo();}
function invertSel(){if(!selectRect)return;saveUndo();const l=getActiveLayer();if(!l)return;const{x,y,w,h}=selectRect;for(let dy=0;dy<h;dy++)for(let dx=0;dx<w;dx++)slp(l,x+dx-l.x,y+dy-l.y,glp(l,x+dx-l.x,y+dy-l.y)^1);render();renderPreview();}
function flipHSel(){if(!selectRect)return;saveUndo();const buf=selPx(),{x,y,w,h}=selectRect;if(!buf)return;buf.forEach(r=>r.reverse());const l=getActiveLayer();buf.forEach((row,dy)=>row.forEach((v,dx)=>slp(l,x+dx-l.x,y+dy-l.y,v)));render();renderPreview();}
function flipVSel(){if(!selectRect)return;saveUndo();const buf=selPx(),{x,y,w,h}=selectRect;if(!buf)return;buf.reverse();const l=getActiveLayer();buf.forEach((row,dy)=>row.forEach((v,dx)=>slp(l,x+dx-l.x,y+dy-l.y,v)));render();renderPreview();}

// ══════════════════════════════════════════════════════════════════════════
// Layer panel UI
// ══════════════════════════════════════════════════════════════════════════
function refreshLayerPanel(){
  const list=document.getElementById('layerList');
  list.innerHTML='';
  const THUMB_W=44,THUMB_H=Math.round(THUMB_W*H/W);

  layers.forEach((layer,idx)=>{
    const row=document.createElement('div');
    row.className='layer-row'+(layer.id===activeLayerId?' active':'');
    row.dataset.id=layer.id;
    row.draggable=true;
    row.title=`${layer.name} (${layer.type}) ${layer.w}×${layer.h}`;

    // Visibility toggle
    const visBtn=document.createElement('button');
    visBtn.className='layer-vis-btn'+(layer.visible?'':' hidden');
    visBtn.innerHTML=layer.visible?'<span class="material-icons">visibility</span>':'<span class="material-icons">visibility_off</span>';
    visBtn.title=layer.visible?'隱藏':'顯示';
    visBtn.addEventListener('click',e=>{e.stopPropagation();saveUndo();layer.visible=!layer.visible;refreshLayerPanel();render();renderPreview();});

    // Thumbnail
    const thumb=document.createElement('canvas');
    thumb.width=THUMB_W;thumb.height=THUMB_H;thumb.className='layer-thumb';
    renderThumb(layer,thumb);

    // Info
    const info=document.createElement('div');info.className='layer-info';
    const nameEl=document.createElement('span');nameEl.className='layer-name';nameEl.textContent=layer.name;
    nameEl.contentEditable='true';nameEl.spellcheck=false;
    nameEl.addEventListener('dblclick',e=>e.stopPropagation());
    nameEl.addEventListener('blur',()=>{const v=nameEl.textContent.trim();if(v)layer.name=v;else nameEl.textContent=layer.name;});
    nameEl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();nameEl.blur();}e.stopPropagation();});
    const typeEl=document.createElement('span');typeEl.className='layer-type-badge';typeEl.textContent=layer.type;
    info.appendChild(nameEl);info.appendChild(typeEl);

    // Action buttons
    const btns=document.createElement('div');btns.className='layer-btns';

    const dupeBtn=document.createElement('button');
    dupeBtn.className='layer-action-btn';dupeBtn.title='複製圖層';dupeBtn.innerHTML='<span class="material-icons">copy_all</span>';
    dupeBtn.addEventListener('click',e=>{e.stopPropagation();duplicateLayer(layer.id);});

    const ctpBtn=document.createElement('button');
    ctpBtn.className='layer-action-btn ctp-btn';ctpBtn.title='複製到其他頁面';
    ctpBtn.innerHTML='<span class="material-icons">drive_file_move_rtl</span>';
    ctpBtn.addEventListener('click',e=>{e.stopPropagation();showCopyToPageDropdown(layer.id,ctpBtn);});

    const delBtn=document.createElement('button');
    delBtn.className='layer-action-btn danger';delBtn.title='刪除圖層';delBtn.innerHTML='<span class="material-icons">delete</span>';
    delBtn.addEventListener('click',e=>{e.stopPropagation();if(layers.length<=1){toast('至少需要一個圖層','err');return;}deleteLayer(layer.id);});

    btns.appendChild(dupeBtn);btns.appendChild(ctpBtn);btns.appendChild(delBtn);

    row.appendChild(visBtn);row.appendChild(thumb);row.appendChild(info);row.appendChild(btns);

    // Select layer on click
    row.addEventListener('click',()=>{activeLayerId=layer.id;refreshLayerPanel();render();});

    // Drag to reorder
    row.addEventListener('dragstart',e=>{panelDragId=layer.id;row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',layer.id);});
    row.addEventListener('dragend',()=>{row.classList.remove('dragging');document.querySelectorAll('.layer-row.drag-over').forEach(r=>r.classList.remove('drag-over'));});
    row.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('drag-over');});
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{e.preventDefault();row.classList.remove('drag-over');const src=e.dataTransfer.getData('text/plain');if(src&&src!==layer.id)reorderLayer(src,layer.id);});

    list.appendChild(row);
  });

  // Update layer count badge
  const badge=document.getElementById('layerCountBadge');
  if(badge) badge.textContent=`${layers.length} 層`;
}

// ══════════════════════════════════════════════════════════════════════════
// Coordinate helpers
// ══════════════════════════════════════════════════════════════════════════
function toPixel(clientX,clientY){
  const r=mainCanvas.getBoundingClientRect();
  return{x:Math.floor((clientX-r.left)/zoom),y:Math.floor((clientY-r.top)/zoom)};
}

// ══════════════════════════════════════════════════════════════════════════
// Mouse events
// ══════════════════════════════════════════════════════════════════════════
canvasArea.addEventListener('mousedown',onDown);
canvasArea.addEventListener('mousemove',onMove);
window.addEventListener('mouseup',onUp);
canvasArea.addEventListener('wheel',onWheel,{passive:false});
canvasArea.addEventListener('contextmenu',e=>e.preventDefault());

function onDown(e){
  if(e.button===1){isPanning=true;panStart={x:e.clientX,y:e.clientY,px:canvasArea.scrollLeft,py:canvasArea.scrollTop};e.preventDefault();return;}
  const{x,y}=toPixel(e.clientX,e.clientY);

  if(textPreview){textPreview.x=x;textPreview.y=y;commitText();return;}
  if(iconPreview){iconPreview.x=x;iconPreview.y=y;commitIcon();return;}

  if(tool==='move'){
    const l=getActiveLayer();if(!l)return;
    saveUndo();isMovingLayer=true;
    moveDragStart={mx:x,my:y,lx:l.x,ly:l.y};
    return;
  }
  if(tool==='select'){if(x>=0&&y>=0&&x<W&&y<H){isSelectDragging=true;selectRect={x,y,w:1,h:1};shapeStart={x,y};}render();return;}
  if(tool==='fill'){if(x>=0&&y>=0&&x<W&&y<H){const col=e.button===2?(1-drawColor):drawColor;saveUndo();const l=getActiveLayer();if(l)floodFill(x,y,glp(l,x-l.x,y-l.y),col);render();renderPreview();updateInfo();}return;}
  if(['line','rect','rect_fill','circle','circle_fill'].includes(tool)){shapeStart={x,y};isDrawing=true;return;}

  isDrawing=true;saveUndo();
  const col=e.button===2?(1-drawColor):drawColor;
  stamp(x,y,col);lastX=x;lastY=y;render();renderPreview();updateInfo();
}

function onMove(e){
  if(isPanning){canvasArea.scrollLeft=panStart.px-(e.clientX-panStart.x);canvasArea.scrollTop=panStart.py-(e.clientY-panStart.y);return;}
  const{x,y}=toPixel(e.clientX,e.clientY);
  if(x>=0&&y>=0&&x<W&&y<H){lastMouseX=x;lastMouseY=y;}
  document.getElementById('pixelInfo').textContent=(x>=0&&y>=0&&x<W&&y<H)?`(${x}, ${y})`:'-';

  if(textPreview){textPreview.x=x;textPreview.y=y;render();return;}
  if(iconPreview){iconPreview.x=x;iconPreview.y=y;render();return;}

  if(isMovingLayer){
    const l=getActiveLayer();if(!l)return;
    l.x=moveDragStart.lx+(x-moveDragStart.mx);l.y=moveDragStart.ly+(y-moveDragStart.my);
    render();renderPreview();refreshLayerPanel();return;
  }
  if(!isDrawing&&!isSelectDragging)return;
  if(isSelectDragging){const{x:sx,y:sy}=shapeStart;selectRect={x:Math.min(sx,x),y:Math.min(sy,y),w:Math.abs(x-sx)+1,h:Math.abs(y-sy)+1};render();return;}

  if(['line','rect','rect_fill','circle','circle_fill'].includes(tool)){
    const pts=[];
    if(tool==='line')bLine(shapeStart.x,shapeStart.y,x,y,drawColor,pts);
    else if(tool==='rect')bRect(shapeStart.x,shapeStart.y,x,y,false,pts);
    else if(tool==='rect_fill')bRect(shapeStart.x,shapeStart.y,x,y,true,pts);
    else if(tool==='circle')bCircle(shapeStart.x,shapeStart.y,x,y,false,pts);
    else if(tool==='circle_fill')bCircle(shapeStart.x,shapeStart.y,x,y,true,pts);
    shapePreview=pts;render();return;
  }
  if(x===lastX&&y===lastY)return;
  const col=e.buttons&2?(1-drawColor):drawColor;stamp(x,y,col);lastX=x;lastY=y;render();renderPreview();updateInfo();
}

function onUp(e){
  if(isPanning){isPanning=false;return;}
  if(isMovingLayer){isMovingLayer=false;refreshLayerPanel();return;}
  if(isSelectDragging){isSelectDragging=false;return;}
  if(isDrawing&&shapeStart&&['line','rect','rect_fill','circle','circle_fill'].includes(tool)){
    const{x,y}=toPixel(e.clientX,e.clientY);saveUndo();
    if(tool==='line')bLine(shapeStart.x,shapeStart.y,x,y,drawColor);
    else if(tool==='rect')bRect(shapeStart.x,shapeStart.y,x,y,false);
    else if(tool==='rect_fill')bRect(shapeStart.x,shapeStart.y,x,y,true);
    else if(tool==='circle')bCircle(shapeStart.x,shapeStart.y,x,y,false);
    else if(tool==='circle_fill')bCircle(shapeStart.x,shapeStart.y,x,y,true);
    shapePreview=null;shapeStart=null;render();renderPreview();updateInfo();
  }
  isDrawing=false;shapeStart=null;
}
function onWheel(e){e.preventDefault();setZoom(zoom+(e.deltaY<0?1:-1));}

// ══════════════════════════════════════════════════════════════════════════
// Zoom / Info
// ══════════════════════════════════════════════════════════════════════════
function setZoom(z){zoom=Math.max(1,Math.min(40,z));initCanvas();document.getElementById('zoomInfo').textContent=`×${zoom}`;}
function updateInfo(){
  const comp=getComposite();const on=comp.flat().reduce((s,v)=>s+v,0),total=W*H;
  document.getElementById('canvasInfo').textContent=`${W}×${H}`;
  document.getElementById('zoomInfo').textContent=`×${zoom}`;
  document.getElementById('pixelCount').textContent=`${on} / ${total}`;
  document.getElementById('pixelRatio').textContent=`${(on/total*100).toFixed(1)}%`;
  document.getElementById('previewInfo').textContent=`${W}×${H} px`;
}

// ══════════════════════════════════════════════════════════════════════════
// Export
// ══════════════════════════════════════════════════════════════════════════
async function doExport(format){
  saveCurrentPage();
  const name=document.getElementById('exportName').value.trim()||'my_image';
  const comp=getComposite();
  if(format==='json'){dlText(JSON.stringify({width:W,height:H,layers,activeLayerId,name},null,2),name+'.json','application/json');toast('JSON 已下載（含圖層）','ok');return;}
  try{const res=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({width:W,height:H,pixels:comp,format,name})});const data=await res.json();if(data.error){toast('錯誤：'+data.error,'err');return;}showModal(data.code,format,name);}
  catch(e){toast('請求失敗：'+e.message,'err');}
}
function showModal(code,format,name){
  const labels={micropython:'MicroPython 程式碼',framebuf:'Framebuf Bitmap',c_array:'C/Arduino 程式碼'};
  document.getElementById('modalTitle').textContent=labels[format]||format;
  document.getElementById('codeOutput').textContent=code;
  document.getElementById('codeModal').style.display='flex';
  document.getElementById('btnDownloadCode').onclick=()=>dlText(code,name+(format==='c_array'?'.h':'.py'),'text/plain');
}
function dlText(text,filename,mime){const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([text],{type:mime})),download:filename});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function loadJson(file) { importProjectFile(file); }

// ══════════════════════════════════════════════════════════════════════════
// Canvas resize
// ══════════════════════════════════════════════════════════════════════════
function resizeCanvas(nw,nh){
  if(nw<1||nh<1||nw>512||nh>512){toast('尺寸超出範圍','err');return;}
  saveUndo();
  // Resize all layers that are full-canvas (background layers)
  layers.forEach(l=>{
    if(l.x===0&&l.y===0&&l.w===W&&l.h===H){
      const ng=Array.from({length:nh},(_,y)=>Array.from({length:nw},(_,x)=>y<H&&x<W?(l.grid[y]?.[x]||0):0));
      l.w=nw;l.h=nh;l.grid=ng;
    }
  });
  W=nw;H=nh;fitZoom();initCanvas();refreshLayerPanel();toast(`畫布已調整為 ${W}×${H}`,'ok');
}

// ══════════════════════════════════════════════════════════════════════════
// Brush preview
// ══════════════════════════════════════════════════════════════════════════
function syncBrushPreview(){
  const size=parseInt(document.getElementById('brushSize').value)||1;brushSize=size;
  document.getElementById('brushSizeVal').textContent=size;
  const bc=document.getElementById('brushPreview'),bx=bc.getContext('2d');
  bx.fillStyle='#111';bx.fillRect(0,0,40,40);
  const r=(size-1)/2,cx=20,cy=20,scale=Math.min(14/Math.max(size,1),3);
  bx.fillStyle='#00e57a';
  for(let dy=-Math.ceil(r);dy<=Math.ceil(r);dy++)for(let dx=-Math.ceil(r);dx<=Math.ceil(r);dx++)if(Math.hypot(dx,dy)<=r+0.5)bx.fillRect(cx+dx*scale-scale/2,cy+dy*scale-scale/2,scale,scale);
}

// ══════════════════════════════════════════════════════════════════════════
// Tool UI
// ══════════════════════════════════════════════════════════════════════════
function toggleLayerSidebar(){
  const s=document.getElementById('layerSidebar'),b=document.getElementById('btnToggleLayers');
  s.classList.toggle('open');b.classList.toggle('active');
}

function updateToolHighlight(){
  document.querySelectorAll('.tool-btn').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  document.getElementById('textPanel').style.display=tool==='text'?'block':'none';
  document.getElementById('selectPanel').style.display=tool==='select'?'block':'none';
  document.getElementById('brushSection').style.display=['pencil','eraser'].includes(tool)?'block':'none';
  if(tool==='text')autoUpdateTextPreview();
  else if(tool!=='text'){textPreview=null;document.getElementById('liveHint').style.display='none';}
  if(tool!=='text'&&tool!=='select'&&!['pencil','eraser','fill','line','rect','rect_fill','circle','circle_fill','move'].includes(tool))render();
  render();
}
function setFontMode(mode){fontMode=mode;document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));document.getElementById('canvasFontOpts').style.display=mode==='canvas'?'block':'none';document.getElementById('bitmapFontOpts').style.display=mode==='bitmap'?'block':'none';autoUpdateTextPreview();}
function syncThresholdLabel(){
  const el=document.getElementById('threshold'); if(!el)return;
  const v=parseInt(el.value)||20;
  const desc = v<=15 ? '細節最多' : v<=35 ? '均衡' : v<=60 ? '較粗' : '最粗';
  document.getElementById('thresholdVal').textContent=`${v}% · ${desc}`;
}

// ══════════════════════════════════════════════════════════════════════════
// Event binding
// ══════════════════════════════════════════════════════════════════════════
function bindEvents(){
  // Page bar
  document.getElementById('btnAddPage').addEventListener('click', () => createNewPage());
  document.getElementById('btnExportProject').addEventListener('click', exportProject);
  document.getElementById('btnImportProject').addEventListener('click', () => document.getElementById('projectFileInput').click());
  document.getElementById('projectFileInput').addEventListener('change', e => { if(e.target.files[0]) importProjectFile(e.target.files[0]); e.target.value=''; });
  document.getElementById('projectName')?.addEventListener('change', e => { projectName = e.target.value.trim() || projectName; });

  document.getElementById('btnToggleLayers').addEventListener('click',toggleLayerSidebar);
  document.querySelectorAll('.tool-btn').forEach(btn=>{btn.addEventListener('click',()=>{tool=btn.dataset.tool;if(tool!=='select')selectRect=null;updateToolHighlight();});});
  document.getElementById('brushSize').addEventListener('input',syncBrushPreview);
  document.querySelectorAll('.color-btn').forEach(btn=>{btn.addEventListener('click',()=>{drawColor=parseInt(btn.dataset.color);document.querySelectorAll('.color-btn').forEach(b=>b.classList.toggle('active',b===btn));});});

  document.getElementById('btnFlipH').addEventListener('click',flipH);
  document.getElementById('btnFlipV').addEventListener('click',flipV);
  document.getElementById('btnRotCW').addEventListener('click',rotCW);
  document.getElementById('btnRotCCW').addEventListener('click',rotCCW);
  document.getElementById('btnInvert').addEventListener('click',invert);
  document.getElementById('btnShiftL').addEventListener('click',()=>shift(-1,0));
  document.getElementById('btnShiftR').addEventListener('click',()=>shift(1,0));
  document.getElementById('btnShiftU').addEventListener('click',()=>shift(0,-1));
  document.getElementById('btnShiftD').addEventListener('click',()=>shift(0,1));
  document.getElementById('btnCenter').addEventListener('click',centerH);
  document.getElementById('btnUndo').addEventListener('click',undo);
  document.getElementById('btnRedo').addEventListener('click',redo);
  document.getElementById('btnClear').addEventListener('click',()=>{saveUndo();const l=getActiveLayer();if(l){l.grid=Array.from({length:l.h},()=>new Array(l.w).fill(0));}render();renderPreview();updateInfo();toast('圖層已清除');});
  document.getElementById('btnFill').addEventListener('click',()=>{saveUndo();const l=getActiveLayer();if(l)for(let y=0;y<l.h;y++)for(let x=0;x<l.w;x++)l.grid[y][x]=1;render();renderPreview();updateInfo();});
  document.getElementById('btnZoomIn').addEventListener('click',()=>setZoom(zoom+1));
  document.getElementById('btnZoomOut').addEventListener('click',()=>setZoom(zoom-1));
  document.getElementById('btnZoomFit').addEventListener('click',()=>{fitZoom();initCanvas();});
  document.getElementById('chkGrid').addEventListener('change',e=>{showGrid=e.target.checked;render();});

  // Layer panel buttons
  document.getElementById('btnAddLayer').addEventListener('click',()=>{saveUndo();addLayer(`圖層 ${layers.length+1}`,'draw',0,0,W,H);toast('新增圖層','ok');render();renderPreview();});
  document.getElementById('btnMergeDown').addEventListener('click',()=>{mergeDown(activeLayerId);});
  document.getElementById('btnFlattenLayers').addEventListener('click',()=>flattenAll());

  // Font mode
  document.querySelectorAll('.seg-btn').forEach(btn=>btn.addEventListener('click',()=>setFontMode(btn.dataset.mode)));
  const slider=document.getElementById('fontSizeSlider'),szSel=document.getElementById('fontSizePreset');
  slider.addEventListener('input',()=>{szSel.value=slider.value;autoUpdateTextPreview();});
  szSel.addEventListener('change',()=>{slider.value=szSel.value;autoUpdateTextPreview();});
  ['textInput','fontFamily','bitmapFont'].forEach(id=>document.getElementById(id)?.addEventListener('input',autoUpdateTextPreview));
  ['fontFamily','fontSizePreset','bitmapFont','charSpacing'].forEach(id=>document.getElementById(id)?.addEventListener('change',autoUpdateTextPreview));
  ['chkBold','chkItalic'].forEach(id=>document.getElementById(id)?.addEventListener('change',autoUpdateTextPreview));
  document.getElementById('threshold').addEventListener('input',()=>{syncThresholdLabel();autoUpdateTextPreview();});
  document.getElementById('charSpacing').addEventListener('input',autoUpdateTextPreview);

  document.getElementById('btnUploadFont').addEventListener('click',()=>document.getElementById('fontFileInput').click());
  document.getElementById('fontFileInput').addEventListener('change',e=>{const f=e.target.files[0];if(f)uploadFont(f);e.target.value='';});
  document.getElementById('btnPlaceText').addEventListener('click',startTextPlacement);
  document.getElementById('btnCancelText').addEventListener('click',cancelText);
  document.getElementById('textInput').addEventListener('keydown',e=>{if(e.key==='Enter')startTextPlacement();});

  document.getElementById('btnCopySel').addEventListener('click',()=>{selectBuffer=selPx();toast('已複製');});
  document.getElementById('btnCutSel').addEventListener('click',()=>{selectBuffer=selPx();clearSel();toast('已剪下');});
  document.getElementById('btnClearSel').addEventListener('click',clearSel);
  document.getElementById('btnInvertSel').addEventListener('click',invertSel);
  document.getElementById('btnFlipHSel').addEventListener('click',flipHSel);
  document.getElementById('btnFlipVSel').addEventListener('click',flipVSel);

  const iconSearchEl=document.getElementById('iconSearch'),clearSearchEl=document.getElementById('btnClearSearch');
  document.getElementById('iconSize').addEventListener('change',()=>showIconList(_currentSearchResults||MATERIAL_ICON_CATS[iconCat]));
  iconSearchEl.addEventListener('input',()=>{const q=iconSearchEl.value.trim();clearSearchEl.style.display=q?'':'none';if(!q){_currentSearchResults=null;document.querySelectorAll('.icon-cat-btn').forEach(b=>b.classList.toggle('active',b.dataset.cat===iconCat));showIconList(MATERIAL_ICON_CATS[iconCat]);}else{_currentSearchResults=searchIcons(q);document.querySelectorAll('.icon-cat-btn').forEach(b=>b.classList.remove('active'));showIconList(_currentSearchResults);}});
  clearSearchEl.addEventListener('click',()=>{iconSearchEl.value='';clearSearchEl.style.display='none';_currentSearchResults=null;document.querySelectorAll('.icon-cat-btn').forEach(b=>b.classList.toggle('active',b.dataset.cat===iconCat));showIconList(MATERIAL_ICON_CATS[iconCat]);});

  document.getElementById('btnImportImg').addEventListener('click',()=>document.getElementById('imgFileInput').click());
  document.getElementById('imgFileInput').addEventListener('change',e=>{const f=e.target.files[0];if(f)handleImageSelect(f);e.target.value='';});
  document.getElementById('btnResetCrop').addEventListener('click',()=>{imgCropRect=null;drawCropCanvas();updateImgPreview();});
  document.getElementById('imgThreshold').addEventListener('input',e=>{document.getElementById('imgThreshVal').textContent=e.target.value;updateImgPreview();});
  document.getElementById('imgScaleMode').addEventListener('change',updateImgPreview);
  document.getElementById('imgDither').addEventListener('change',updateImgPreview);
  document.getElementById('btnApplyImg').addEventListener('click',applyImageImport);
  document.getElementById('btnCancelImg').addEventListener('click',()=>{importImg=null;imgCropRect=null;document.getElementById('imgImportOpts').style.display='none';});
  setupCropEvents();

  document.querySelectorAll('.btn-export').forEach(btn=>btn.addEventListener('click',()=>doExport(btn.dataset.format)));
  document.getElementById('btnLoadJson').addEventListener('click',()=>document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change',e=>{if(e.target.files[0])loadJson(e.target.files[0]);e.target.value='';});
  document.getElementById('btnExportProjectAlt')?.addEventListener('click', exportProject);
  document.getElementById('btnCloseModal').addEventListener('click',()=>document.getElementById('codeModal').style.display='none');
  document.getElementById('btnCopyCode').addEventListener('click',()=>navigator.clipboard.writeText(document.getElementById('codeOutput').textContent).then(()=>toast('已複製到剪貼簿','ok')));
  document.getElementById('codeModal').addEventListener('click',e=>{if(e.target.id==='codeModal')document.getElementById('codeModal').style.display='none';});

  document.getElementById('presetSize').addEventListener('change',e=>{const v=e.target.value,custom=v==='custom';document.getElementById('customSizeRow').style.display=custom?'flex':'none';if(!custom){const[nw,nh]=v.split('x').map(Number);resizeCanvas(nw,nh);}});
  document.getElementById('applySize').addEventListener('click',()=>resizeCanvas(parseInt(document.getElementById('customWidth').value)||128,parseInt(document.getElementById('customHeight').value)||64));

  document.addEventListener('keydown',onKey);
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg,type=''){const el=document.getElementById('toast');el.textContent=msg;el.className='toast show'+(type?' '+type:'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2500);}

// ── Keyboard shortcuts ────────────────────────────────────────────────────
function onKey(e){
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  if(e.ctrlKey&&e.key==='z'){undo();return;}
  if(e.ctrlKey&&(e.key==='y'||e.key==='Y')){redo();return;}
  if(e.ctrlKey&&e.key==='d'){e.preventDefault();duplicateLayer(activeLayerId);return;}
  if(e.key==='Escape'){cancelText();selectRect=null;render();return;}
  if(e.key==='Enter'&&(textPreview||iconPreview)){textPreview?commitText():commitIcon();return;}
  if(e.key==='Delete'&&selectRect){clearSel();return;}
  const map={p:'pencil',e:'eraser',f:'fill',l:'line',r:'rect',c:'circle',t:'text',s:'select',m:'move'};
  if(!e.ctrlKey&&!e.altKey&&map[e.key.toLowerCase()]){tool=map[e.key.toLowerCase()];updateToolHighlight();return;}
  if(e.key==='+'||e.key==='=')setZoom(zoom+1);
  if(e.key==='-')setZoom(zoom-1);
  if(e.key==='ArrowLeft'){e.preventDefault();shift(-1,0);}
  if(e.key==='ArrowRight'){e.preventDefault();shift(1,0);}
  if(e.key==='ArrowUp'){e.preventDefault();shift(0,-1);}
  if(e.key==='ArrowDown'){e.preventDefault();shift(0,1);}
}

window.addEventListener('load',init);
window.addEventListener('resize',()=>{fitZoom();initCanvas();});
