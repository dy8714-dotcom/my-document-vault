// ============================================================
// マイドキュメント保管庫 アプリケーションロジック (v2.0)
// 第2段階：ラベル管理、複数ラベル、ドラッグ&ドロップ、未分類セクション、モバイル対応
// ============================================================

// ----- グローバル状態 -----
let currentTab = "pdf";
let firebaseUser = null;
let googleAccessToken = null;
let tokenClient = null;
let cellsData = [];           // 現在のタブのセルデータ
let labelsData = [];          // 現在のタブのラベルデータ
let editingLabel = null;      // ラベル編集中のラベル
let actionTargetCell = null;  // セル操作モーダルの対象セル
let labelSelectTargetCell = null; // ラベル選択モーダルの対象セル

// ----- DOM ヘルパー -----
const $ = (id) => document.getElementById(id);

// ----- 起動 -----
window.addEventListener("DOMContentLoaded", () => {
  firebase.initializeApp(firebaseConfig);
  
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      firebaseUser = user;
      showMainScreen();
    } else {
      firebaseUser = null;
      showLoginScreen();
    }
  });

  // ボタン
  $("login-btn").addEventListener("click", handleLogin);
  $("logout-btn").addEventListener("click", handleLogout);
  $("add-file-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", handleFileSelect);
  $("refresh-btn").addEventListener("click", () => loadCells());
  $("add-label-btn").addEventListener("click", openLabelModalForCreate);

  // ラベルモーダル
  $("label-modal-cancel").addEventListener("click", closeLabelModal);
  $("label-modal-save").addEventListener("click", saveLabelFromModal);
  $("label-modal-delete").addEventListener("click", deleteLabelFromModal);

  // セル操作モーダル
  $("cell-action-cancel").addEventListener("click", closeCellActionModal);
  $("action-open").addEventListener("click", () => {
    if (actionTargetCell) openInDrive(actionTargetCell);
    closeCellActionModal();
  });
  $("action-move").addEventListener("click", () => {
    const cell = actionTargetCell;
    closeCellActionModal();
    if (cell) openLabelSelectModal(cell);
  });
  $("action-delete").addEventListener("click", () => {
    const cell = actionTargetCell;
    closeCellActionModal();
    if (cell) deleteCell(cell);
  });

  // ラベル選択モーダル
  $("label-select-cancel").addEventListener("click", closeLabelSelectModal);
  $("label-select-save").addEventListener("click", saveLabelSelection);

  renderTabs();
});

// ============================================================
// ログイン処理
// ============================================================
async function handleLogin() {
  setLoginStatus("ログイン中...");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope(GOOGLE_SCOPES);
    
    // モバイルではリダイレクト方式が安定
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

function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function setLoginStatus(text) {
  $("login-status").textContent = text || "";
}

async function handleLogout() {
  if (!confirm("ログアウトしますか？")) return;
  googleAccessToken = null;
  await firebase.auth().signOut();
}

// ============================================================
// 画面切り替え
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
// Google OAuth (Drive API用)
// ============================================================
function initGoogleTokenClient() {
  if (tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: (tokenResponse) => {
      console.log("[OAuth] トークンレスポンス受信");
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
  if (!tokenClient) {
    setTimeout(requestDriveToken, 500);
    return;
  }
  tokenClient.requestAccessToken({ hint: firebaseUser.email });
}

// ============================================================
// タブ
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
}

function switchTab(tabId) {
  currentTab = tabId;
  renderTabs();
  loadCells();
}

function getCurrentTabDef() {
  return TAB_DEFINITIONS.find((t) => t.id === currentTab);
}

// ============================================================
// データ読み込み（セル + ラベル）
// ============================================================
async function loadCells() {
  if (!googleAccessToken) {
    showLoading("Google Driveに接続中...");
    return;
  }

  showLoading("読み込み中...");
  setStatusText("");

  try {
    const tabDef = getCurrentTabDef();

    if (!tabDef.folderId || tabDef.folderId.includes("【")) {
      throw new Error(`フォルダIDが設定されていません`);
    }

    // 並列読み込み
    const [fsCells, fsLabels, driveFiles] = await Promise.all([
      loadFirestoreCells(tabDef.id),
      loadFirestoreLabels(tabDef.id),
      loadDriveFiles(tabDef.folderId)
    ]);

    labelsData = fsLabels;
    cellsData = await mergeCellsAndFiles(fsCells, driveFiles, tabDef.id);

    renderSections();
    updateFooter();
  } catch (e) {
    console.error("[loadCells] エラー:", e);
    showToast("読み込みエラー: " + (e.message || e), "error");
    cellsData = [];
    labelsData = [];
    renderSections();
    updateFooter();
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
  const url = "https://www.googleapis.com/drive/v3/files"
    + "?q=" + encodeURIComponent(q)
    + "&fields=" + encodeURIComponent("files(id,name,mimeType,modifiedTime,createdTime)")
    + "&pageSize=200";
  
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + googleAccessToken }
  });
  
  if (!res.ok) {
    if (res.status === 401) {
      googleAccessToken = null;
      requestDriveToken();
      throw new Error("認証期限切れ。再ログインしてください。");
    }
    if (res.status === 404) {
      throw new Error(`フォルダが見つかりません`);
    }
    throw new Error(`Drive APIエラー: ${res.status}`);
  }
  
  const data = await res.json();
  return data.files || [];
}

async function mergeCellsAndFiles(fsCells, driveFiles, tabId) {
  const fsFileIds = new Set(fsCells.map((c) => c.driveFileId).filter(Boolean));
  const driveFileIds = new Set(driveFiles.map((f) => f.id));

  // Driveに存在するセルだけ残す
  let merged = fsCells.filter((c) => driveFileIds.has(c.driveFileId));

  // Drive側情報で更新
  merged = merged.map((cell) => {
    const driveFile = driveFiles.find((f) => f.id === cell.driveFileId);
    if (driveFile) {
      return {
        ...cell,
        title: driveFile.name,
        mimeType: driveFile.mimeType,
        driveModifiedTime: driveFile.modifiedTime
      };
    }
    return cell;
  });

  // 新規ファイル → 未分類として追加
  const newDriveFiles = driveFiles.filter((f) => !fsFileIds.has(f.id));
  for (const f of newDriveFiles) {
    const newCell = {
      tabId: tabId,
      driveFileId: f.id,
      title: f.name,
      mimeType: f.mimeType,
      driveCreatedTime: f.createdTime,
      driveModifiedTime: f.modifiedTime,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
      labelIds: [], // 未分類（空配列）
      order: (merged.length + 1) * 100
    };
    const docRef = await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells")
      .add(newCell);
    merged.push({ id: docRef.id, ...newCell, registeredAt: new Date() });
  }

  // 削除済みのFirestoreデータをクリーンアップ
  const deletedFsCells = fsCells.filter((c) => !driveFileIds.has(c.driveFileId));
  for (const c of deletedFsCells) {
    try {
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(c.id).delete();
    } catch (e) {
      console.warn("[cleanup] 削除失敗:", e);
    }
  }

  merged.sort((a, b) => (a.order || 0) - (b.order || 0));
  return merged;
}

// ============================================================
// セクション描画（ラベル別）
// ============================================================
function renderSections() {
  const wrap = $("sections");
  wrap.innerHTML = "";

  const tabDef = getCurrentTabDef();

  // 未分類セル
  const uncategorizedCells = cellsData.filter((c) => !c.labelIds || c.labelIds.length === 0);

  // 未分類セクション（あれば表示）
  if (uncategorizedCells.length > 0) {
    wrap.appendChild(buildSection({
      id: "__uncategorized__",
      name: "⚠ 未分類（新規追加）",
      color: UNCATEGORIZED_COLOR,
      cells: uncategorizedCells,
      tabDef: tabDef,
      isUncategorized: true,
      defaultPad: true
    }));
  }

  // ラベルごとのセクション
  labelsData.forEach((label) => {
    const labelCells = cellsData.filter((c) => c.labelIds && c.labelIds.includes(label.id));
    wrap.appendChild(buildSection({
      id: label.id,
      name: label.name,
      color: label.color || LABEL_COLOR_PRESETS[0],
      cells: labelCells,
      tabDef: tabDef,
      label: label,
      defaultPad: false
    }));
  });

  // ラベルが0個＆未分類0個の場合の初期表示
  if (labelsData.length === 0 && uncategorizedCells.length === 0) {
    // 全セルを"全て"として通常表示
    wrap.appendChild(buildSection({
      id: "__all__",
      name: "ファイル（ラベル未作成）",
      color: { bg: "#F5F5F0", border: "#D3D1C7", text: "#5F5E5A" },
      cells: cellsData,
      tabDef: tabDef,
      isAll: true,
      defaultPad: true
    }));
  }
}

function buildSection({ id, name, color, cells, tabDef, isUncategorized, isAll, label, defaultPad }) {
  const section = document.createElement("div");
  section.className = "section";
  section.dataset.labelId = id;

  // ヘッダー
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

  // ラベル編集ボタン（通常ラベルのみ）
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

  // グリッド
  const grid = document.createElement("div");
  grid.className = "grid";
  grid.dataset.labelId = id;

  // セル数の決定
  const totalCells = isAll ? Math.max(DEFAULT_CELL_COUNT, cells.length) : cells.length;
  const showEmpty = isAll || cells.length === 0;
  const minCells = isAll ? DEFAULT_CELL_COUNT : (cells.length < 5 ? 5 : cells.length);
  const renderCount = Math.max(cells.length, minCells);

  for (let i = 0; i < renderCount; i++) {
    if (cells[i]) {
      grid.appendChild(buildFilledCell(cells[i], tabDef));
    } else {
      grid.appendChild(buildEmptyCell(id));
    }
  }

  // ドロップターゲット設定（セクション全体）
  setupDropTarget(grid, id);

  section.appendChild(grid);
  return section;
}

function buildFilledCell(cell, tabDef) {
  const el = document.createElement("div");
  el.className = "cell";
  el.title = cell.title;
  el.draggable = true;
  el.dataset.cellId = cell.id;
  
  const dateStr = formatDate(
    cell.driveCreatedTime || 
    (cell.registeredAt && cell.registeredAt.toDate ? cell.registeredAt.toDate() : null)
  );

  // ラベルドット（複数ラベル表示）
  const labelDotsHtml = (cell.labelIds || [])
    .map((labelId) => {
      const lbl = labelsData.find((l) => l.id === labelId);
      if (!lbl) return "";
      return `<span class="cell-label-dot" style="background: ${lbl.color.border};" title="${escapeHtml(lbl.name)}"></span>`;
    })
    .join("");

  el.innerHTML = `
    <div class="cell-content">
      <span class="cell-icon" style="background: ${tabDef.color};">${tabDef.letter}</span>
      <span class="cell-title">${escapeHtml(cell.title)}</span>
    </div>
    <div class="cell-bottom">
      <span class="cell-date">${dateStr}</span>
      <span class="cell-label-dots">${labelDotsHtml}</span>
    </div>
    <button class="cell-menu-btn" title="操作">⋮</button>
  `;

  // クリック → Drive 別タブ
  el.addEventListener("click", (e) => {
    if (e.target.closest(".cell-menu-btn")) return;
    openInDrive(cell);
  });

  // メニューボタン → 操作モーダル
  el.querySelector(".cell-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openCellActionModal(cell);
  });

  // ドラッグイベント
  setupCellDrag(el, cell);

  return el;
}

function buildEmptyCell(labelId) {
  const el = document.createElement("div");
  el.className = "cell cell-empty";
  el.dataset.empty = "true";
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
    document.querySelectorAll(".drag-over").forEach((d) => d.classList.remove("drag-over"));
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
    
    const dropCell = draggedCell;
    
    // セクションIDから新しいラベル設定を決定
    let newLabelIds;
    if (sectionId === "__uncategorized__") {
      newLabelIds = []; // 未分類に移動
    } else if (sectionId === "__all__") {
      return; // 「全て」セクションでは何もしない
    } else {
      // 通常ラベルへの移動
      // 既存のラベルセットから該当ラベル以外を保持しつつ、ターゲットラベルを追加
      // ただし「ドラッグして移動」は単一ラベルへの所属移動として扱う
      newLabelIds = [sectionId];
    }
    
    if (JSON.stringify((dropCell.labelIds || []).sort()) === JSON.stringify(newLabelIds.sort())) {
      return; // 変化なし
    }
    
    try {
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(dropCell.id)
        .update({ labelIds: newLabelIds });
      
      // ローカルデータも更新
      const target = cellsData.find((c) => c.id === dropCell.id);
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
  LABEL_COLOR_PRESETS.forEach((c, idx) => {
    const opt = document.createElement("div");
    opt.className = "color-option";
    opt.style.background = c.bg;
    opt.style.color = c.text;
    opt.style.borderColor = c.border;
    if (selectedColor && selectedColor.bg === c.bg) {
      opt.classList.add("selected");
    }
    opt.textContent = "あ";
    opt.addEventListener("click", () => {
      selectedColor = c;
      renderColorPicker();
    });
    wrap.appendChild(opt);
  });
}

async function saveLabelFromModal() {
  const name = $("label-name-input").value.trim();
  if (!name) {
    alert("ラベル名を入力してください");
    return;
  }
  if (!selectedColor) {
    alert("色を選択してください");
    return;
  }

  showLoading("保存中...");
  try {
    if (editingLabel) {
      // 更新
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("labels").doc(editingLabel.id)
        .update({ name: name, color: selectedColor });
    } else {
      // 新規作成
      const order = labelsData.length > 0 
        ? Math.max(...labelsData.map((l) => l.order || 0)) + 100 
        : 100;
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("labels")
        .add({
          tabId: currentTab,
          name: name,
          color: selectedColor,
          order: order,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }
    closeLabelModal();
    showToast("保存しました", "success");
    await loadCells();
  } catch (e) {
    console.error(e);
    showToast("保存に失敗しました", "error");
  } finally {
    hideLoading();
  }
}

async function deleteLabelFromModal() {
  if (!editingLabel) return;
  if (!confirm(`ラベル「${editingLabel.name}」を削除しますか？\n\n※このラベルが付いているファイルは未分類になります（ファイルは削除されません）`)) return;

  showLoading("削除中...");
  try {
    // このラベルが付いているセルからラベルを除去
    const affectedCells = cellsData.filter((c) => 
      c.labelIds && c.labelIds.includes(editingLabel.id)
    );
    
    const batch = firebase.firestore().batch();
    affectedCells.forEach((cell) => {
      const ref = firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(cell.id);
      const newLabelIds = cell.labelIds.filter((id) => id !== editingLabel.id);
      batch.update(ref, { labelIds: newLabelIds });
    });
    await batch.commit();

    // ラベル本体を削除
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("labels").doc(editingLabel.id)
      .delete();

    closeLabelModal();
    showToast("削除しました", "success");
    await loadCells();
  } catch (e) {
    console.error(e);
    showToast("削除に失敗しました", "error");
  } finally {
    hideLoading();
  }
}

// ============================================================
// セル操作モーダル（モバイル/PC共通）
// ============================================================
function openCellActionModal(cell) {
  actionTargetCell = cell;
  $("cell-action-title").textContent = cell.title;
  $("cell-action-modal").style.display = "flex";
}

function closeCellActionModal() {
  $("cell-action-modal").style.display = "none";
  actionTargetCell = null;
}

// ============================================================
// ラベル選択モーダル（複数ラベル付け）
// ============================================================
function openLabelSelectModal(cell) {
  labelSelectTargetCell = cell;
  const list = $("label-select-list");
  list.innerHTML = "";
  
  if (labelsData.length === 0) {
    list.innerHTML = '<p style="color:#888780; font-size:13px; padding:8px 0;">ラベルがありません。先にラベルを追加してください。</p>';
  } else {
    labelsData.forEach((label) => {
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
  checks.forEach((cb) => {
    if (cb.checked) newLabelIds.push(cb.dataset.labelId);
  });
  
  showLoading("保存中...");
  try {
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(labelSelectTargetCell.id)
      .update({ labelIds: newLabelIds });
    
    const target = cellsData.find((c) => c.id === labelSelectTargetCell.id);
    if (target) target.labelIds = newLabelIds;
    
    closeLabelSelectModal();
    renderSections();
    showToast("ラベルを更新しました", "success");
  } catch (e) {
    console.error(e);
    showToast("更新に失敗しました", "error");
  } finally {
    hideLoading();
  }
}

// ============================================================
// セル操作
// ============================================================
function openInDrive(cell) {
  const url = `https://drive.google.com/file/d/${cell.driveFileId}/view`;
  window.open(url, "_blank");
}

async function deleteCell(cell) {
  if (!confirm(`「${cell.title}」を削除しますか？\n\nGoogle Drive上のファイルも削除されます。`)) return;

  showLoading("削除中...");
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${cell.driveFileId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + googleAccessToken }
    });
    if (!res.ok && res.status !== 404) {
      throw new Error("Driveからの削除に失敗: " + res.status);
    }

    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(cell.id).delete();

    showToast("削除しました", "success");
    await loadCells();
  } catch (e) {
    console.error("[delete] エラー:", e);
    showToast("削除に失敗しました: " + (e.message || e), "error");
  } finally {
    hideLoading();
  }
}

// ============================================================
// ファイル追加
// ============================================================
async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = "";
  
  showLoading(`「${file.name}」をアップロード中...`);
  try {
    const tabDef = getCurrentTabDef();
    await uploadToDrive(file, tabDef.folderId);
    showToast("アップロード完了", "success");
    await loadCells();
  } catch (e) {
    console.error("[upload] エラー:", e);
    showToast("アップロード失敗: " + (e.message || e), "error");
  } finally {
    hideLoading();
  }
}

async function uploadToDrive(file, folderId) {
  const metadata = {
    name: file.name,
    parents: [folderId]
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { Authorization: "Bearer " + googleAccessToken },
    body: form
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Driveアップロード失敗: " + err);
  }
  return await res.json();
}

// ============================================================
// UI ヘルパー
// ============================================================
function showLoading(text) {
  $("loading-text").textContent = text || "処理中...";
  $("loading").style.display = "flex";
}

function hideLoading() {
  $("loading").style.display = "none";
}

function showToast(message, type = "") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = "toast" + (type ? " " + type : "");
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 3500);
}

function setStatusText(text) {
  $("status-text").textContent = text || "";
}

function updateFooter() {
  const cellCount = cellsData.length;
  const labelCount = labelsData.length;
  $("footer-info").textContent = 
    `ファイル ${cellCount}件 ・ ラベル ${labelCount}個`;
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
