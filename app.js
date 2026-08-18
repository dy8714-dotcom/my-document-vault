// ============================================================
// マイドキュメント保管庫 アプリケーションロジック (v3.0 - 第3段階)
// 追加機能:
// - ファイル名変更（Drive同期）
// - 閲覧履歴（100件、履歴タブ）
// - プレビューモーダル（Drive埋め込み、前後ナビ）
// - グリッドレイアウト（サムネイル切替）
// - 検索（現タブ・全タブ横断）
// - お気に入り（ピン留め）
// - メモ機能（200文字、アイコン表示）
// - 登録日/更新日切替
// - PWA対応
// ============================================================

// ==== グローバル状態 ====
let currentTab = "pdf";
let firebaseUser = null;
let googleAccessToken = null;
let tokenClient = null;
let cellsData = [];           // 現在のタブのセルデータ
let labelsData = [];          // 現在のタブのラベルデータ
let historyData = [];         // 履歴（履歴タブ表示用）
let allCellsCache = {};       // 全タブのセル {tabId: cells[]} (横断検索用)
let allLabelsCache = {};      // 全タブのラベル {tabId: labels[]}
let allDriveFilesCache = {};  // 全タブのDriveファイル {tabId: files[]}

let editingLabel = null;
let actionTargetCell = null;
let labelSelectTargetCell = null;
let renameTargetCell = null;
let memoTargetCell = null;

let currentLayout = "list";   // "list" or "grid"
let currentDateMode = "created"; // "created" or "modified"
let searchQuery = "";
let searchScope = "current";  // "current" or "all"
let previewList = [];         // プレビュー中のセルリスト
let previewIndex = 0;         // プレビュー中の現在位置
let thumbnailCache = {};      // {driveFileId: thumbnailUrl}

const HISTORY_TAB_ID = "__history__";

// ==== DOM ヘルパー ====
const $ = (id) => document.getElementById(id);

// ==== 起動 ====
window.addEventListener("DOMContentLoaded", () => {
  firebase.initializeApp(firebaseConfig);

  // 設定を localStorage から復元
  currentLayout = localStorage.getItem("mdv_layout") || "list";
  currentDateMode = localStorage.getItem("mdv_dateMode") || "created";
  updateLayoutButtons();
  $("date-mode").value = currentDateMode;

  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      firebaseUser = user;
      showMainScreen();
    } else {
      firebaseUser = null;
      showLoginScreen();
    }
  });

  attachEventListeners();
  renderTabs();
});

function attachEventListeners() {
  // ログイン系
  $("login-btn").addEventListener("click", handleLogin);
  $("logout-btn").addEventListener("click", handleLogout);
  
  // ファイル追加
  $("add-file-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", handleFileSelect);
  
  // 更新
  $("refresh-btn").addEventListener("click", () => loadCells());
  
  // ラベル追加
  $("add-label-btn").addEventListener("click", openLabelModalForCreate);

  // 検索
  $("search-input").addEventListener("input", debounce(handleSearchInput, 300));
  $("search-scope").addEventListener("change", handleSearchInput);
  
  // 日付表示切替
  $("date-mode").addEventListener("change", (e) => {
    currentDateMode = e.target.value;
    localStorage.setItem("mdv_dateMode", currentDateMode);
    renderSections();
  });
  
  // レイアウト切替
  $("layout-list").addEventListener("click", () => setLayout("list"));
  $("layout-grid").addEventListener("click", () => setLayout("grid"));

  // ラベルモーダル
  $("label-modal-cancel").addEventListener("click", closeLabelModal);
  $("label-modal-save").addEventListener("click", saveLabelFromModal);
  $("label-modal-delete").addEventListener("click", deleteLabelFromModal);

  // セル操作モーダル
  $("cell-action-cancel").addEventListener("click", closeCellActionModal);
  $("action-preview").addEventListener("click", () => {
    const c = actionTargetCell;
    closeCellActionModal();
    if (c) openPreview(c);
  });
  $("action-open").addEventListener("click", () => {
    if (actionTargetCell) openInDrive(actionTargetCell);
    closeCellActionModal();
  });
  $("action-favorite").addEventListener("click", () => {
    const c = actionTargetCell;
    closeCellActionModal();
    if (c) toggleFavorite(c);
  });
  $("action-rename").addEventListener("click", () => {
    const c = actionTargetCell;
    closeCellActionModal();
    if (c) openRenameModal(c);
  });
  $("action-memo").addEventListener("click", () => {
    const c = actionTargetCell;
    closeCellActionModal();
    if (c) openMemoModal(c);
  });
  $("action-move").addEventListener("click", () => {
    const c = actionTargetCell;
    closeCellActionModal();
    if (c) openLabelSelectModal(c);
  });
  $("action-delete").addEventListener("click", () => {
    const c = actionTargetCell;
    closeCellActionModal();
    if (c) deleteCell(c);
  });

  // ラベル選択モーダル
  $("label-select-cancel").addEventListener("click", closeLabelSelectModal);
  $("label-select-save").addEventListener("click", saveLabelSelection);

  // 名前変更モーダル
  $("rename-cancel").addEventListener("click", () => $("rename-modal").style.display = "none");
  $("rename-save").addEventListener("click", saveRename);

  // メモモーダル
  $("memo-cancel").addEventListener("click", () => $("memo-modal").style.display = "none");
  $("memo-clear").addEventListener("click", clearMemo);
  $("memo-save").addEventListener("click", saveMemo);
  $("memo-input").addEventListener("input", () => {
    $("memo-count").textContent = $("memo-input").value.length;
  });

  // プレビュー
  $("preview-close").addEventListener("click", closePreview);
  $("preview-prev").addEventListener("click", () => movePreview(-1));
  $("preview-next").addEventListener("click", () => movePreview(1));
  $("preview-open-tab").addEventListener("click", () => {
    if (previewList[previewIndex]) openInDrive(previewList[previewIndex]);
  });
  
  // プレビューのキーボード操作
  document.addEventListener("keydown", (e) => {
    if ($("preview-modal").style.display !== "flex") return;
    if (e.key === "ArrowLeft") movePreview(-1);
    else if (e.key === "ArrowRight") movePreview(1);
    else if (e.key === "Escape") closePreview();
  });

  // モーダル背景クリックで閉じる
  document.querySelectorAll(".modal-backdrop").forEach((bd) => {
    bd.addEventListener("click", (e) => {
      const modal = bd.closest(".modal");
      if (modal.id === "preview-modal") closePreview();
      else modal.style.display = "none";
    });
  });
}

// ==== ユーティリティ ====
function debounce(fn, wait) {
  let t;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// ============================================================
// ログイン
// ============================================================
async function handleLogin() {
  setLoginStatus("ログイン中...");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope(GOOGLE_SCOPES);
    if (isMobileDevice()) {
      await firebase.auth().signInWithRedirect(provider);
    } else {
      await firebase.auth().signInWithPopup(provider);
    }
  } catch (e) {
    console.error("[Login] エラー:", e);
    setLoginStatus("ログインに失敗しました: " + (e.message || e));
  }
}

function setLoginStatus(text) { $("login-status").textContent = text || ""; }

async function handleLogout() {
  if (!confirm("ログアウトしますか？")) return;
  googleAccessToken = null;
  await firebase.auth().signOut();
}

// ============================================================
// 画面切替
// ============================================================
function showLoginScreen() {
  $("login-screen").style.display = "flex";
  $("main-screen").style.display = "none";
}

function showMainScreen() {
  $("login-screen").style.display = "none";
  $("main-screen").style.display = "flex";
  $("user-email").textContent = firebaseUser.email || "";
  initGoogleTokenClient();
  requestDriveToken();
}

// ============================================================
// Google OAuth
// ============================================================
function initGoogleTokenClient() {
  if (tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        googleAccessToken = tokenResponse.access_token;
        loadCells();
      } else if (tokenResponse.error) {
        showToast("Drive認証に失敗: " + tokenResponse.error, "error");
      }
    },
  });
}

function requestDriveToken() {
  if (!tokenClient) { setTimeout(requestDriveToken, 500); return; }
  tokenClient.requestAccessToken({ hint: firebaseUser.email });
}

// ============================================================
// タブ（履歴タブ追加）
// ============================================================
function renderTabs() {
  const wrap = $("tabs");
  wrap.innerHTML = "";
  TAB_DEFINITIONS.forEach((tab) => {
    const btn = document.createElement("button");
    btn.className = "tab" + (tab.id === currentTab ? " active" : "");
    btn.textContent = tab.name;
    btn.addEventListener("click", () => switchTab(tab.id));
    wrap.appendChild(btn);
  });
  // 履歴タブ追加
  const histBtn = document.createElement("button");
  histBtn.className = "tab" + (currentTab === HISTORY_TAB_ID ? " active" : "");
  histBtn.textContent = "🕐 履歴";
  histBtn.addEventListener("click", () => switchTab(HISTORY_TAB_ID));
  wrap.appendChild(histBtn);
}

function switchTab(tabId) {
  currentTab = tabId;
  searchQuery = "";
  $("search-input").value = "";
  renderTabs();
  if (tabId === HISTORY_TAB_ID) {
    loadHistoryView();
  } else {
    loadCells();
  }
}

function getCurrentTabDef() {
  return TAB_DEFINITIONS.find((t) => t.id === currentTab);
}

// ============================================================
// レイアウト切替
// ============================================================
function setLayout(layout) {
  currentLayout = layout;
  localStorage.setItem("mdv_layout", layout);
  updateLayoutButtons();
  if (currentTab === HISTORY_TAB_ID) {
    renderHistorySections();
  } else {
    renderSections();
  }
}

function updateLayoutButtons() {
  $("layout-list").classList.toggle("active", currentLayout === "list");
  $("layout-grid").classList.toggle("active", currentLayout === "grid");
}

// ============================================================
// データ読み込み
// ============================================================
async function loadCells() {
  if (!googleAccessToken) { showLoading("Google Driveに接続中..."); return; }
  showLoading("読み込み中...");

  try {
    const tabDef = getCurrentTabDef();
    if (!tabDef || !tabDef.folderId || tabDef.folderId.includes("【")) {
      throw new Error("フォルダIDが設定されていません");
    }
    const [fsCells, fsLabels, driveFiles] = await Promise.all([
      loadFirestoreCells(tabDef.id),
      loadFirestoreLabels(tabDef.id),
      loadDriveFiles(tabDef.folderId)
    ]);
    labelsData = fsLabels;
    cellsData = await mergeCellsAndFiles(fsCells, driveFiles, tabDef.id);
    
    // キャッシュ更新
    allCellsCache[tabDef.id] = cellsData;
    allLabelsCache[tabDef.id] = labelsData;
    allDriveFilesCache[tabDef.id] = driveFiles;
    
    renderSections();
    updateFooter();
  } catch (e) {
    console.error("[loadCells] エラー:", e);
    showToast("読み込みエラー: " + (e.message || e), "error");
    cellsData = []; labelsData = [];
    renderSections(); updateFooter();
  } finally {
    hideLoading();
  }
}

async function loadFirestoreCells(tabId) {
  const snap = await firebase.firestore()
    .collection("users").doc(firebaseUser.uid)
    .collection("cells")
    .where("tabId", "==", tabId)
    .get();
  const cells = [];
  snap.forEach((doc) => cells.push({ id: doc.id, ...doc.data() }));
  cells.sort((a, b) => (a.order || 0) - (b.order || 0));
  return cells;
}

async function loadFirestoreLabels(tabId) {
  const snap = await firebase.firestore()
    .collection("users").doc(firebaseUser.uid)
    .collection("labels")
    .where("tabId", "==", tabId)
    .get();
  const labels = [];
  snap.forEach((doc) => labels.push({ id: doc.id, ...doc.data() }));
  labels.sort((a, b) => (a.order || 0) - (b.order || 0));
  return labels;
}

async function loadDriveFiles(folderId) {
  const q = `'${folderId}' in parents and trashed=false`;
  // thumbnailLinkも取得
  const url = "https://www.googleapis.com/drive/v3/files"
    + "?q=" + encodeURIComponent(q)
    + "&fields=" + encodeURIComponent("files(id,name,mimeType,modifiedTime,createdTime,thumbnailLink,iconLink,hasThumbnail)")
    + "&pageSize=200";
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + googleAccessToken }
  });
  if (!res.ok) {
    if (res.status === 401) { googleAccessToken = null; requestDriveToken(); throw new Error("認証期限切れ"); }
    if (res.status === 404) throw new Error("フォルダが見つかりません");
    throw new Error("Drive APIエラー: " + res.status);
  }
  const data = await res.json();
  const files = data.files || [];
  // サムネイルURLをキャッシュ
  files.forEach((f) => {
    if (f.thumbnailLink) thumbnailCache[f.id] = f.thumbnailLink;
  });
  return files;
}

async function mergeCellsAndFiles(fsCells, driveFiles, tabId) {
  const fsFileIds = new Set(fsCells.map((c) => c.driveFileId).filter(Boolean));
  const driveFileIds = new Set(driveFiles.map((f) => f.id));

  // Driveに残っているセルのみ保持、Drive情報で更新
  let merged = fsCells
    .filter((c) => driveFileIds.has(c.driveFileId))
    .map((cell) => {
      const df = driveFiles.find((f) => f.id === cell.driveFileId);
      return df ? { ...cell, title: df.name, mimeType: df.mimeType, driveModifiedTime: df.modifiedTime } : cell;
    });

  // 新規Driveファイル → 未分類として追加
  const newDriveFiles = driveFiles.filter((f) => !fsFileIds.has(f.id));
  for (const f of newDriveFiles) {
    const newCell = {
      tabId, driveFileId: f.id, title: f.name, mimeType: f.mimeType,
      driveCreatedTime: f.createdTime, driveModifiedTime: f.modifiedTime,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
      labelIds: [], favorite: false, memo: "",
      order: (merged.length + 1) * 100
    };
    const docRef = await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").add(newCell);
    merged.push({ id: docRef.id, ...newCell, registeredAt: new Date() });
  }

  // 削除されたセルのFirestoreデータをクリーンアップ
  const deleted = fsCells.filter((c) => !driveFileIds.has(c.driveFileId));
  for (const c of deleted) {
    try {
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(c.id).delete();
    } catch (e) { console.warn(e); }
  }

  merged.sort((a, b) => (a.order || 0) - (b.order || 0));
  return merged;
}

// ============================================================
// 全タブ横断データ取得（横断検索用）
// ============================================================
async function loadAllTabsData() {
  showLoading("全タブを読み込み中...");
  try {
    for (const tab of TAB_DEFINITIONS) {
      if (allCellsCache[tab.id] && allDriveFilesCache[tab.id]) continue; // キャッシュ済みならスキップ
      try {
        const [fsCells, fsLabels, driveFiles] = await Promise.all([
          loadFirestoreCells(tab.id),
          loadFirestoreLabels(tab.id),
          loadDriveFiles(tab.folderId)
        ]);
        const cells = await mergeCellsAndFiles(fsCells, driveFiles, tab.id);
        allCellsCache[tab.id] = cells;
        allLabelsCache[tab.id] = fsLabels;
        allDriveFilesCache[tab.id] = driveFiles;
      } catch (e) {
        console.warn(`Tab ${tab.id}: ${e.message}`);
        allCellsCache[tab.id] = [];
      }
    }
  } finally {
    hideLoading();
  }
}

// ============================================================
// 検索処理
// ============================================================
async function handleSearchInput() {
  searchQuery = $("search-input").value.trim().toLowerCase();
  searchScope = $("search-scope").value;
  
  if (currentTab === HISTORY_TAB_ID) {
    renderHistorySections();
    return;
  }
  
  if (searchScope === "all" && searchQuery) {
    await loadAllTabsData();
  }
  renderSections();
}

function filterCells(cells, tabId) {
  if (!searchQuery) return cells;
  return cells.filter((c) => {
    const title = (c.title || "").toLowerCase();
    const memo = (c.memo || "").toLowerCase();
    return title.includes(searchQuery) || memo.includes(searchQuery);
  });
}

// ============================================================
// セクション描画
// ============================================================
function renderSections() {
  const wrap = $("sections");
  wrap.innerHTML = "";

  // 横断検索モード
  if (searchScope === "all" && searchQuery) {
    renderCrossTabSearchResults(wrap);
    updateFooter();
    return;
  }

  const tabDef = getCurrentTabDef();
  if (!tabDef) return;
  
  const filteredCells = filterCells(cellsData);

  // お気に入り
  const favoriteCells = filteredCells.filter((c) => c.favorite);
  if (favoriteCells.length > 0) {
    wrap.appendChild(buildSection({
      id: "__favorite__",
      name: "★ お気に入り",
      color: FAVORITE_COLOR,
      cells: favoriteCells,
      tabDef,
      isFavorite: true
    }));
  }

  // 未分類
  const uncategorized = filteredCells.filter((c) => !c.labelIds || c.labelIds.length === 0);
  if (uncategorized.length > 0) {
    wrap.appendChild(buildSection({
      id: "__uncategorized__",
      name: "⚠ 未分類（新規追加）",
      color: UNCATEGORIZED_COLOR,
      cells: uncategorized,
      tabDef,
      isUncategorized: true
    }));
  }

  // ラベルごと
  labelsData.forEach((label) => {
    const labelCells = filteredCells.filter((c) => c.labelIds && c.labelIds.includes(label.id));
    if (searchQuery && labelCells.length === 0) return; // 検索中は空セクション非表示
    wrap.appendChild(buildSection({
      id: label.id,
      name: label.name,
      color: label.color || LABEL_COLOR_PRESETS[0],
      cells: labelCells,
      tabDef,
      label
    }));
  });

  // ラベルもファイルもゼロなら初期表示
  if (labelsData.length === 0 && uncategorized.length === 0 && favoriteCells.length === 0 && !searchQuery) {
    wrap.appendChild(buildSection({
      id: "__all__",
      name: "ファイル（ラベル未作成）",
      color: { bg: "#F5F5F0", border: "#D3D1C7", text: "#5F5E5A" },
      cells: filteredCells,
      tabDef,
      isAll: true
    }));
  }

  // 検索でヒットゼロ
  if (searchQuery && wrap.children.length === 0) {
    wrap.innerHTML = '<p style="text-align:center; color:#888780; padding:40px;">該当するファイルがありません</p>';
  }
  
  updateFooter();
}

function renderCrossTabSearchResults(wrap) {
  let anyHit = false;
  TAB_DEFINITIONS.forEach((tab) => {
    const cells = allCellsCache[tab.id] || [];
    const filtered = filterCells(cells);
    if (filtered.length === 0) return;
    anyHit = true;
    wrap.appendChild(buildSection({
      id: `__crosstab_${tab.id}__`,
      name: `${tab.name} (${filtered.length}件)`,
      color: { bg: "#F5F5F0", border: tab.color, text: "#2C2C2A" },
      cells: filtered,
      tabDef: tab,
      isCrossTab: true
    }));
  });
  if (!anyHit) {
    wrap.innerHTML = '<p style="text-align:center; color:#888780; padding:40px;">該当するファイルがありません</p>';
  }
}

function buildSection({ id, name, color, cells, tabDef, isUncategorized, isAll, isFavorite, isCrossTab, label }) {
  const section = document.createElement("div");
  section.className = "section";
  section.dataset.labelId = id;

  const header = document.createElement("div");
  header.className = "section-header";
  header.style.background = color.bg;
  header.style.borderLeftColor = color.border;
  header.style.color = color.text;

  const nameEl = document.createElement("span");
  nameEl.className = "section-header-name";
  nameEl.textContent = name;
  header.appendChild(nameEl);

  const countEl = document.createElement("span");
  countEl.className = "section-header-count";
  countEl.textContent = `${cells.length}件`;
  header.appendChild(countEl);

  if (label) {
    const editBtn = document.createElement("button");
    editBtn.className = "section-header-edit";
    editBtn.textContent = "編集";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLabelModalForEdit(label);
    });
    header.appendChild(editBtn);
  }
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "grid layout-" + currentLayout;
  grid.dataset.labelId = id;

  // 表示するセル数（レイアウト・isAllで違う）
  let renderCount;
  if (currentLayout === "grid" || isFavorite || isCrossTab) {
    renderCount = cells.length; // グリッドやお気に入りは空セル出さない
  } else if (isAll) {
    renderCount = Math.max(DEFAULT_CELL_COUNT, cells.length);
  } else {
    const minCells = cells.length < 5 ? 5 : cells.length;
    renderCount = Math.max(cells.length, minCells);
  }

  for (let i = 0; i < renderCount; i++) {
    if (cells[i]) {
      grid.appendChild(buildFilledCell(cells[i], tabDef));
    } else {
      grid.appendChild(buildEmptyCell(id));
    }
  }

  // ドロップ可能なセクションのみdrop設定
  if (!isCrossTab && !isFavorite) {
    setupDropTarget(grid, id);
  }
  section.appendChild(grid);
  return section;
}

// ============================================================
// セル構築
// ============================================================
function buildFilledCell(cell, tabDef, opts = {}) {
  const el = document.createElement("div");
  el.className = "cell layout-" + currentLayout;
  el.title = cell.title;
  el.draggable = !opts.isHistory;
  el.dataset.cellId = cell.id;
  el.dataset.tabId = cell.tabId;

  const dateVal = currentDateMode === "modified"
    ? cell.driveModifiedTime
    : (cell.driveCreatedTime || (cell.registeredAt && cell.registeredAt.toDate ? cell.registeredAt.toDate() : null));
  const dateStr = formatDate(dateVal);
  const datePrefix = currentDateMode === "modified" ? "更新" : "";

  const labelDotsHtml = (cell.labelIds || [])
    .map((labelId) => {
      const lbls = allLabelsCache[cell.tabId] || labelsData;
      const lbl = lbls.find((l) => l.id === labelId);
      if (!lbl) return "";
      return `<span class="cell-label-dot" style="background: ${lbl.color.border};" title="${escapeHtml(lbl.name)}"></span>`;
    }).join("");

  const memoDot = (cell.memo && cell.memo.trim()) 
    ? `<span class="cell-memo-dot" title="メモあり: ${escapeHtml(cell.memo.substring(0, 60))}"></span>` : "";

  const favStar = cell.favorite ? '<span class="cell-favorite-star">★</span>' : "";

  if (currentLayout === "grid") {
    // グリッドレイアウト
    const thumbUrl = thumbnailCache[cell.driveFileId];
    const thumbHtml = thumbUrl
      ? `<img src="${thumbUrl}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<span class=\\'cell-thumb-fallback\\'>📄</span>'">`
      : `<span class="cell-thumb-fallback">📄</span>`;

    el.innerHTML = `
      ${favStar}
      <div class="cell-thumb">${thumbHtml}</div>
      <div class="cell-info">
        <div class="cell-title-line">
          <span class="cell-icon" style="background: ${tabDef.color};">${tabDef.letter}</span>
          <span class="cell-title">${escapeHtml(cell.title)}</span>
        </div>
        <div class="cell-bottom">
          <span class="cell-date">${datePrefix}${dateStr}</span>
          <span class="cell-label-dots">${labelDotsHtml}${memoDot}</span>
        </div>
      </div>
      <button class="cell-menu-btn" title="操作">⋮</button>
    `;
  } else {
    // リストレイアウト
    el.innerHTML = `
      ${favStar}
      <div class="cell-content">
        <span class="cell-icon" style="background: ${tabDef.color};">${tabDef.letter}</span>
        <span class="cell-title">${escapeHtml(cell.title)}</span>
      </div>
      <div class="cell-bottom">
        <span class="cell-date">${datePrefix}${dateStr}</span>
        <span class="cell-label-dots">${labelDotsHtml}${memoDot}</span>
      </div>
      <button class="cell-menu-btn" title="操作">⋮</button>
    `;
  }

  // 履歴ビュー時：閲覧時刻を上書き表示
  if (opts.isHistory && opts.historyTime) {
    el.classList.add("cell-history");
    const dateEl = el.querySelector(".cell-date");
    if (dateEl) {
      dateEl.className = "cell-history-time";
      dateEl.textContent = "🕐 " + formatDateTime(opts.historyTime);
    }
  }

  // クリック → プレビュー
  el.addEventListener("click", (e) => {
    if (e.target.closest(".cell-menu-btn")) return;
    openPreview(cell);
  });

  // メニューボタン
  el.querySelector(".cell-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openCellActionModal(cell);
  });

  // ドラッグ
  if (!opts.isHistory) {
    setupCellDrag(el, cell);
  }
  return el;
}

function buildEmptyCell(labelId) {
  const el = document.createElement("div");
  el.className = "cell cell-empty";
  return el;
}

// ============================================================
// ドラッグ&ドロップ
// ============================================================
let draggedCell = null;

function setupCellDrag(el, cell) {
  el.addEventListener("dragstart", (e) => {
    draggedCell = cell;
    el.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", cell.id);
  });
  el.addEventListener("dragend", () => {
    el.classList.remove("dragging");
    draggedCell = null;
  });
}

function setupDropTarget(grid, sectionId) {
  grid.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });
  grid.addEventListener("drop", async (e) => {
    e.preventDefault();
    if (!draggedCell) return;
    const c = draggedCell;
    let newLabelIds;
    if (sectionId === "__uncategorized__") newLabelIds = [];
    else if (sectionId === "__all__" || sectionId === "__favorite__") return;
    else newLabelIds = [sectionId];
    
    if (JSON.stringify((c.labelIds || []).sort()) === JSON.stringify(newLabelIds.sort())) return;
    
    try {
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(c.id)
        .update({ labelIds: newLabelIds });
      const target = cellsData.find((x) => x.id === c.id);
      if (target) target.labelIds = newLabelIds;
      renderSections();
      showToast("ラベルを変更しました", "success");
    } catch (e) {
      console.error(e);
      showToast("ラベル変更に失敗しました", "error");
    }
  });
}

// ============================================================
// ラベルモーダル
// ============================================================
let selectedColor = null;

function openLabelModalForCreate() {
  if (currentTab === HISTORY_TAB_ID) {
    showToast("履歴タブではラベル追加できません", "error");
    return;
  }
  editingLabel = null;
  $("label-modal-title").textContent = "ラベル追加";
  $("label-name-input").value = "";
  $("label-modal-delete").style.display = "none";
  selectedColor = LABEL_COLOR_PRESETS[0];
  renderColorPicker();
  $("label-modal").style.display = "flex";
  $("label-name-input").focus();
}

function openLabelModalForEdit(label) {
  editingLabel = label;
  $("label-modal-title").textContent = "ラベル編集";
  $("label-name-input").value = label.name;
  $("label-modal-delete").style.display = "inline-block";
  selectedColor = label.color || LABEL_COLOR_PRESETS[0];
  renderColorPicker();
  $("label-modal").style.display = "flex";
}

function closeLabelModal() {
  $("label-modal").style.display = "none";
  editingLabel = null;
}

function renderColorPicker() {
  const wrap = $("color-picker");
  wrap.innerHTML = "";
  LABEL_COLOR_PRESETS.forEach((c) => {
    const opt = document.createElement("div");
    opt.className = "color-option";
    opt.style.background = c.bg;
    opt.style.color = c.text;
    opt.style.borderColor = c.border;
    if (selectedColor && selectedColor.bg === c.bg) opt.classList.add("selected");
    opt.textContent = "あ";
    opt.addEventListener("click", () => { selectedColor = c; renderColorPicker(); });
    wrap.appendChild(opt);
  });
}

async function saveLabelFromModal() {
  const name = $("label-name-input").value.trim();
  if (!name) { alert("ラベル名を入力してください"); return; }
  if (!selectedColor) { alert("色を選択してください"); return; }

  showLoading("保存中...");
  try {
    if (editingLabel) {
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("labels").doc(editingLabel.id)
        .update({ name, color: selectedColor });
    } else {
      const order = labelsData.length > 0 ? Math.max(...labelsData.map((l) => l.order || 0)) + 100 : 100;
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("labels").add({
          tabId: currentTab, name, color: selectedColor, order,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    closeLabelModal();
    showToast("保存しました", "success");
    await loadCells();
  } catch (e) {
    console.error(e);
    showToast("保存に失敗しました", "error");
  } finally { hideLoading(); }
}

async function deleteLabelFromModal() {
  if (!editingLabel) return;
  if (!confirm(`ラベル「${editingLabel.name}」を削除しますか？\n\n※このラベルが付いているファイルは未分類になります`)) return;

  showLoading("削除中...");
  try {
    const affected = cellsData.filter((c) => c.labelIds && c.labelIds.includes(editingLabel.id));
    const batch = firebase.firestore().batch();
    affected.forEach((cell) => {
      const ref = firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(cell.id);
      batch.update(ref, { labelIds: cell.labelIds.filter((id) => id !== editingLabel.id) });
    });
    await batch.commit();
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("labels").doc(editingLabel.id).delete();
    closeLabelModal();
    showToast("削除しました", "success");
    await loadCells();
  } catch (e) {
    console.error(e);
    showToast("削除に失敗しました", "error");
  } finally { hideLoading(); }
}

// ============================================================
// セル操作モーダル
// ============================================================
function openCellActionModal(cell) {
  actionTargetCell = cell;
  $("cell-action-title").textContent = cell.title;
  // お気に入りボタンの表示
  $("action-favorite").textContent = cell.favorite ? "☆ お気に入り解除" : "★ お気に入り";
  $("cell-action-modal").style.display = "flex";
}

function closeCellActionModal() {
  $("cell-action-modal").style.display = "none";
  actionTargetCell = null;
}

// ============================================================
// お気に入り
// ============================================================
async function toggleFavorite(cell) {
  const newFav = !cell.favorite;
  try {
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(cell.id)
      .update({ favorite: newFav });
    cell.favorite = newFav;
    // キャッシュも更新
    const cached = (allCellsCache[cell.tabId] || []).find((c) => c.id === cell.id);
    if (cached) cached.favorite = newFav;
    renderSections();
    showToast(newFav ? "お気に入りに追加" : "お気に入りから削除", "success");
  } catch (e) {
    console.error(e);
    showToast("失敗しました", "error");
  }
}

// ============================================================
// 名前変更
// ============================================================
function openRenameModal(cell) {
  renameTargetCell = cell;
  $("rename-input").value = cell.title;
  $("rename-modal").style.display = "flex";
  setTimeout(() => $("rename-input").focus(), 100);
}

async function saveRename() {
  if (!renameTargetCell) return;
  const newName = $("rename-input").value.trim();
  if (!newName) { alert("ファイル名を入力してください"); return; }
  if (newName === renameTargetCell.title) { $("rename-modal").style.display = "none"; return; }

  showLoading("名前を変更中...");
  try {
    // Drive側のファイル名変更
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${renameTargetCell.driveFileId}`,
      {
        method: "PATCH",
        headers: {
          "Authorization": "Bearer " + googleAccessToken,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ name: newName })
      }
    );
    if (!res.ok) throw new Error("Drive更新失敗: " + res.status);
    
    // Firestoreも更新
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(renameTargetCell.id)
      .update({ title: newName });
    
    renameTargetCell.title = newName;
    const cached = (allCellsCache[renameTargetCell.tabId] || []).find((c) => c.id === renameTargetCell.id);
    if (cached) cached.title = newName;
    
    $("rename-modal").style.display = "none";
    renameTargetCell = null;
    showToast("名前を変更しました", "success");
    if (currentTab === HISTORY_TAB_ID) renderHistorySections();
    else renderSections();
  } catch (e) {
    console.error(e);
    showToast("名前変更に失敗しました: " + (e.message || e), "error");
  } finally { hideLoading(); }
}

// ============================================================
// メモ機能
// ============================================================
function openMemoModal(cell) {
  memoTargetCell = cell;
  $("memo-modal-title").textContent = "メモ: " + cell.title;
  $("memo-input").value = cell.memo || "";
  $("memo-count").textContent = ($("memo-input").value || "").length;
  $("memo-modal").style.display = "flex";
  setTimeout(() => $("memo-input").focus(), 100);
}

async function saveMemo() {
  if (!memoTargetCell) return;
  const memo = $("memo-input").value.substring(0, MEMO_MAX_LENGTH);
  try {
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(memoTargetCell.id)
      .update({ memo });
    memoTargetCell.memo = memo;
    const cached = (allCellsCache[memoTargetCell.tabId] || []).find((c) => c.id === memoTargetCell.id);
    if (cached) cached.memo = memo;
    $("memo-modal").style.display = "none";
    memoTargetCell = null;
    showToast("メモを保存しました", "success");
    if (currentTab === HISTORY_TAB_ID) renderHistorySections();
    else renderSections();
  } catch (e) {
    console.error(e);
    showToast("メモ保存失敗", "error");
  }
}

async function clearMemo() {
  if (!memoTargetCell) return;
  if (!confirm("メモを削除しますか？")) return;
  $("memo-input").value = "";
  await saveMemo();
}

// ============================================================
// ラベル選択モーダル
// ============================================================
function openLabelSelectModal(cell) {
  if (currentTab === HISTORY_TAB_ID) {
    // 履歴タブから選択された場合、そのセルの元タブのラベルを使う
    const targetLabels = allLabelsCache[cell.tabId] || [];
    _showLabelSelectModal(cell, targetLabels);
  } else {
    _showLabelSelectModal(cell, labelsData);
  }
}

function _showLabelSelectModal(cell, availableLabels) {
  labelSelectTargetCell = cell;
  const list = $("label-select-list");
  list.innerHTML = "";
  if (availableLabels.length === 0) {
    list.innerHTML = '<p style="color:#888780; font-size:13px; padding:8px 0;">ラベルがありません。</p>';
  } else {
    availableLabels.forEach((label) => {
      const row = document.createElement("label");
      row.className = "label-select-row";
      const checked = (cell.labelIds || []).includes(label.id);
      row.innerHTML = `
        <input type="checkbox" data-label-id="${label.id}" ${checked ? "checked" : ""}>
        <span class="label-select-color" style="background:${label.color.bg}; border-color:${label.color.border};"></span>
        <span class="label-select-name">${escapeHtml(label.name)}</span>
      `;
      list.appendChild(row);
    });
  }
  $("label-select-modal").style.display = "flex";
}

function closeLabelSelectModal() {
  $("label-select-modal").style.display = "none";
  labelSelectTargetCell = null;
}

async function saveLabelSelection() {
  if (!labelSelectTargetCell) return;
  const checks = $("label-select-list").querySelectorAll('input[type="checkbox"]');
  const newLabelIds = [];
  checks.forEach((cb) => { if (cb.checked) newLabelIds.push(cb.dataset.labelId); });

  try {
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(labelSelectTargetCell.id)
      .update({ labelIds: newLabelIds });
    labelSelectTargetCell.labelIds = newLabelIds;
    const cached = (allCellsCache[labelSelectTargetCell.tabId] || []).find((c) => c.id === labelSelectTargetCell.id);
    if (cached) cached.labelIds = newLabelIds;
    closeLabelSelectModal();
    if (currentTab === HISTORY_TAB_ID) renderHistorySections();
    else renderSections();
    showToast("ラベルを更新しました", "success");
  } catch (e) {
    console.error(e);
    showToast("更新に失敗しました", "error");
  }
}

// ============================================================
// プレビュー
// ============================================================
function openPreview(cell) {
  // 現在表示中のセル群からリストを作成（前後ナビ用）
  if (currentTab === HISTORY_TAB_ID) {
    previewList = historyData.map((h) => h.cell).filter(Boolean);
  } else if (searchScope === "all" && searchQuery) {
    previewList = [];
    TAB_DEFINITIONS.forEach((tab) => {
      const cs = allCellsCache[tab.id] || [];
      previewList = previewList.concat(filterCells(cs));
    });
  } else {
    previewList = filterCells(cellsData);
  }
  previewIndex = previewList.findIndex((c) => c.id === cell.id);
  if (previewIndex < 0) {
    previewList = [cell];
    previewIndex = 0;
  }
  showPreviewAtIndex();
  $("preview-modal").style.display = "flex";
  // 履歴記録
  recordHistory(cell);
}

function showPreviewAtIndex() {
  const cell = previewList[previewIndex];
  if (!cell) return;
  $("preview-title").textContent = cell.title;
  const tab = TAB_DEFINITIONS.find((t) => t.id === cell.tabId);
  $("preview-subtitle").textContent = `${tab ? tab.name : ""} ・ ${previewIndex + 1} / ${previewList.length}`;
  $("preview-iframe").src = `https://drive.google.com/file/d/${cell.driveFileId}/preview`;
  $("preview-prev").disabled = previewIndex <= 0;
  $("preview-next").disabled = previewIndex >= previewList.length - 1;
}

function movePreview(direction) {
  const newIdx = previewIndex + direction;
  if (newIdx < 0 || newIdx >= previewList.length) return;
  previewIndex = newIdx;
  showPreviewAtIndex();
  // 履歴記録
  recordHistory(previewList[previewIndex]);
}

function closePreview() {
  $("preview-modal").style.display = "none";
  $("preview-iframe").src = ""; // iframeをリセット
  previewList = [];
  previewIndex = 0;
}

// ============================================================
// 履歴機能
// ============================================================
async function recordHistory(cell) {
  if (!cell || !firebaseUser) return;
  try {
    // 同じdriveFileIdの既存履歴を削除して、新規追加
    const snap = await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("history")
      .where("driveFileId", "==", cell.driveFileId)
      .get();
    const batch = firebase.firestore().batch();
    snap.forEach((doc) => batch.delete(doc.ref));
    
    const newRef = firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("history").doc();
    batch.set(newRef, {
      driveFileId: cell.driveFileId,
      cellId: cell.id,
      tabId: cell.tabId,
      title: cell.title,
      viewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    
    // 100件超えたら古いのを削除
    await pruneHistory();
  } catch (e) {
    console.warn("[history] 記録失敗:", e);
  }
}

async function pruneHistory() {
  try {
    const snap = await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("history")
      .orderBy("viewedAt", "desc")
      .get();
    if (snap.size <= HISTORY_MAX_ITEMS) return;
    const batch = firebase.firestore().batch();
    let count = 0;
    snap.forEach((doc) => {
      count++;
      if (count > HISTORY_MAX_ITEMS) batch.delete(doc.ref);
    });
    await batch.commit();
  } catch (e) { console.warn(e); }
}

async function loadHistoryView() {
  if (!googleAccessToken) { showLoading("Google Driveに接続中..."); return; }
  showLoading("履歴を読み込み中...");
  try {
    // 履歴取得
    const snap = await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("history")
      .orderBy("viewedAt", "desc")
      .limit(HISTORY_MAX_ITEMS)
      .get();
    const history = [];
    snap.forEach((doc) => history.push({ id: doc.id, ...doc.data() }));

    // 全タブのデータを読み込む（履歴のセル情報が必要）
    await loadAllTabsData();
    
    // 履歴の各エントリに対応するセルデータを紐付ける
    historyData = history.map((h) => {
      const tabCells = allCellsCache[h.tabId] || [];
      const cell = tabCells.find((c) => c.driveFileId === h.driveFileId);
      return { history: h, cell };
    }).filter((h) => h.cell); // セルが存在するもののみ

    renderHistorySections();
    updateFooter();
  } catch (e) {
    console.error(e);
    showToast("履歴の読み込みに失敗しました: " + (e.message || e), "error");
  } finally { hideLoading(); }
}

function renderHistorySections() {
  const wrap = $("sections");
  wrap.innerHTML = "";
  
  const filtered = searchQuery 
    ? historyData.filter((h) => {
        const q = searchQuery;
        return (h.cell.title || "").toLowerCase().includes(q) 
            || (h.cell.memo || "").toLowerCase().includes(q);
      })
    : historyData;

  if (filtered.length === 0) {
    wrap.innerHTML = '<p style="text-align:center; color:#888780; padding:40px;">履歴がありません</p>';
    return;
  }

  // 履歴セクション（時系列一覧、レイアウト切替対応）
  const section = document.createElement("div");
  section.className = "section";
  
  const header = document.createElement("div");
  header.className = "section-header";
  header.style.background = "#EEEDFE";
  header.style.borderLeftColor = "#7F77DD";
  header.style.color = "#3C3489";
  header.innerHTML = `
    <span class="section-header-name">🕐 最近見たファイル</span>
    <span class="section-header-count">${filtered.length}件</span>
  `;
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "grid layout-" + currentLayout;

  filtered.forEach((h) => {
    const cell = h.cell;
    const tab = TAB_DEFINITIONS.find((t) => t.id === h.history.tabId);
    if (!tab) return;
    const viewedAt = h.history.viewedAt && h.history.viewedAt.toDate 
      ? h.history.viewedAt.toDate() : new Date();
    const el = buildFilledCell(cell, tab, { isHistory: true, historyTime: viewedAt });
    grid.appendChild(el);
  });

  section.appendChild(grid);
  wrap.appendChild(section);
}

// ============================================================
// セル操作
// ============================================================
function openInDrive(cell) {
  const url = `https://drive.google.com/file/d/${cell.driveFileId}/view`;
  window.open(url, "_blank");
  recordHistory(cell);
}

async function deleteCell(cell) {
  if (!confirm(`「${cell.title}」を削除しますか？\n\nGoogle Drive上のファイルも削除されます。`)) return;

  showLoading("削除中...");
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${cell.driveFileId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + googleAccessToken }
    });
    if (!res.ok && res.status !== 404) throw new Error("Drive削除失敗: " + res.status);

    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(cell.id).delete();

    // 履歴からも削除
    try {
      const histSnap = await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("history")
        .where("driveFileId", "==", cell.driveFileId)
        .get();
      const batch = firebase.firestore().batch();
      histSnap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    } catch (e) { console.warn(e); }

    showToast("削除しました", "success");
    // キャッシュからも削除
    if (allCellsCache[cell.tabId]) {
      allCellsCache[cell.tabId] = allCellsCache[cell.tabId].filter((c) => c.id !== cell.id);
    }
    if (currentTab === HISTORY_TAB_ID) await loadHistoryView();
    else await loadCells();
  } catch (e) {
    console.error("[delete] エラー:", e);
    showToast("削除に失敗しました: " + (e.message || e), "error");
  } finally { hideLoading(); }
}

// ============================================================
// ファイル追加
// ============================================================
async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";

  if (currentTab === HISTORY_TAB_ID) {
    showToast("履歴タブではファイル追加できません。他のタブに切り替えてください", "error");
    return;
  }

  showLoading(`「${file.name}」をアップロード中...`);
  try {
    const tabDef = getCurrentTabDef();
    await uploadToDrive(file, tabDef.folderId);
    showToast("アップロード完了", "success");
    await loadCells();
  } catch (e) {
    console.error("[upload] エラー:", e);
    showToast("アップロード失敗: " + (e.message || e), "error");
  } finally { hideLoading(); }
}

async function uploadToDrive(file, folderId) {
  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: "Bearer " + googleAccessToken },
    body: form
  });
  if (!res.ok) throw new Error("Driveアップロード失敗: " + (await res.text()));
  return await res.json();
}

// ============================================================
// UI ヘルパー
// ============================================================
function showLoading(text) {
  $("loading-text").textContent = text || "処理中...";
  $("loading").style.display = "flex";
}
function hideLoading() { $("loading").style.display = "none"; }

function showToast(message, type = "") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = "toast" + (type ? " " + type : "");
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 3500);
}

function updateFooter() {
  if (currentTab === HISTORY_TAB_ID) {
    $("footer-info").textContent = `履歴 ${historyData.length}件 (最大${HISTORY_MAX_ITEMS}件)`;
  } else if (searchScope === "all" && searchQuery) {
    let total = 0;
    TAB_DEFINITIONS.forEach((t) => {
      total += filterCells(allCellsCache[t.id] || []).length;
    });
    $("footer-info").textContent = `全タブ検索結果: ${total}件`;
  } else {
    const cellCount = cellsData.length;
    const labelCount = labelsData.length;
    let extra = "";
    if (searchQuery) {
      const hit = filterCells(cellsData).length;
      extra = ` ・ 検索ヒット: ${hit}件`;
    }
    $("footer-info").textContent = `ファイル ${cellCount}件 ・ ラベル ${labelCount}個${extra}`;
  }
}

function formatDate(d) {
  if (!d) return "";
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function formatDateTime(d) {
  if (!d) return "";
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
