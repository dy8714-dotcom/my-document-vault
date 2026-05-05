// ============================================================
// マイドキュメント保管庫 アプリケーションロジック (v2)
// drive フルアクセススコープ対応 + エラー診断強化版
// ============================================================

// ----- グローバル状態 -----
let currentTab = "pdf";
let firebaseUser = null;
let googleAccessToken = null;
let tokenClient = null;
let cellsData = [];

// ----- DOM 要素 -----
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

  $("login-btn").addEventListener("click", handleLogin);
  $("logout-btn").addEventListener("click", handleLogout);
  $("add-file-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", handleFileSelect);
  $("refresh-btn").addEventListener("click", () => loadCells());

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
    await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    console.error("[Login] エラー:", e);
    setLoginStatus("ログインに失敗しました: " + (e.message || e));
  }
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
      console.log("[OAuth] トークンレスポンス:", tokenResponse);
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
// セルの読み込み
// ============================================================
async function loadCells() {
  if (!googleAccessToken) {
    showLoading("Google Driveに接続中...");
    return;
  }

  showLoading("ファイル一覧を読み込み中...");
  setStatusText("");

  try {
    const tabDef = getCurrentTabDef();
    console.log(`[loadCells] タブ: ${tabDef.id}, フォルダID: ${tabDef.folderId}`);

    if (!tabDef.folderId || tabDef.folderId.includes("【")) {
      throw new Error(`フォルダIDが設定されていません (タブ: ${tabDef.name})`);
    }

    const fsCells = await loadFirestoreCells(tabDef.id);
    console.log(`[loadCells] Firestore取得: ${fsCells.length}件`);

    const driveFiles = await loadDriveFiles(tabDef.folderId);
    console.log(`[loadCells] Drive取得: ${driveFiles.length}件`);

    cellsData = await mergeCellsAndFiles(fsCells, driveFiles, tabDef.id);

    renderGrid();
    updateFooter();
  } catch (e) {
    console.error("[loadCells] エラー:", e);
    showToast("読み込みエラー: " + (e.message || e), "error");
    cellsData = [];
    renderGrid();
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

async function loadDriveFiles(folderId) {
  // クエリパラメータをencodeURIComponentで安全に
  const q = `'${folderId}' in parents and trashed=false`;
  const url = "https://www.googleapis.com/drive/v3/files"
    + "?q=" + encodeURIComponent(q)
    + "&fields=" + encodeURIComponent("files(id,name,mimeType,modifiedTime,createdTime)")
    + "&pageSize=200"
    + "&supportsAllDrives=true";
  
  console.log("[Drive API] リクエストURL:", url);
  
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + googleAccessToken }
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error("[Drive API] エラーレスポンス:", res.status, errorText);
    if (res.status === 401) {
      googleAccessToken = null;
      requestDriveToken();
      throw new Error("認証期限切れ。再ログインしてください。");
    }
    if (res.status === 404) {
      throw new Error(`フォルダが見つかりません (ID: ${folderId.substring(0, 10)}...)`);
    }
    throw new Error(`Drive APIエラー: ${res.status}`);
  }
  
  const data = await res.json();
  return data.files || [];
}

async function mergeCellsAndFiles(fsCells, driveFiles, tabId) {
  const fsFileIds = new Set(fsCells.map((c) => c.driveFileId).filter(Boolean));
  const driveFileIds = new Set(driveFiles.map((f) => f.id));

  // Firestoreにあって、Driveにもまだあるセル
  let merged = fsCells.filter((c) => driveFileIds.has(c.driveFileId));

  // Drive側のファイル情報でセル情報を更新（タイトル変更等の反映）
  merged = merged.map((cell) => {
    const driveFile = driveFiles.find((f) => f.id === cell.driveFileId);
    if (driveFile) {
      return {
        ...cell,
        title: driveFile.name,  // Drive側の最新名を反映
        mimeType: driveFile.mimeType,
        driveModifiedTime: driveFile.modifiedTime
      };
    }
    return cell;
  });

  // Firestoreにない新規ファイル
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
      order: (merged.length + 1) * 100
    };
    const docRef = await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells")
      .add(newCell);
    merged.push({ id: docRef.id, ...newCell, registeredAt: new Date() });
  }

  // 削除済みセルのFirestoreデータをクリーンアップ
  const deletedFsCells = fsCells.filter((c) => !driveFileIds.has(c.driveFileId));
  for (const c of deletedFsCells) {
    try {
      await firebase.firestore()
        .collection("users").doc(firebaseUser.uid)
        .collection("cells").doc(c.id).delete();
      console.log("[cleanup] Firestoreから削除:", c.title);
    } catch (e) {
      console.warn("[cleanup] 削除失敗:", e);
    }
  }

  merged.sort((a, b) => (a.order || 0) - (b.order || 0));
  return merged;
}

// ============================================================
// グリッド描画
// ============================================================
function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = "";

  const tabDef = getCurrentTabDef();
  const totalCells = Math.max(DEFAULT_CELL_COUNT, cellsData.length);

  for (let i = 0; i < totalCells; i++) {
    const cellData = cellsData[i];
    if (cellData) {
      grid.appendChild(buildFilledCell(cellData, tabDef));
    } else {
      grid.appendChild(buildEmptyCell());
    }
  }
}

function buildFilledCell(cell, tabDef) {
  const el = document.createElement("div");
  el.className = "cell";
  el.title = cell.title;
  
  const dateStr = formatDate(
    cell.driveCreatedTime || 
    (cell.registeredAt && cell.registeredAt.toDate ? cell.registeredAt.toDate() : null)
  );

  el.innerHTML = `
    <div class="cell-content">
      <span class="cell-icon" style="background: ${tabDef.color};">${tabDef.letter}</span>
      <span class="cell-title">${escapeHtml(cell.title)}</span>
    </div>
    <div class="cell-date">${dateStr}</div>
    <div class="cell-actions">
      <button class="cell-action-btn delete" title="削除">×</button>
    </div>
  `;

  el.addEventListener("click", (e) => {
    if (e.target.closest(".cell-action-btn")) return;
    openInDrive(cell);
  });

  el.querySelector(".cell-action-btn.delete").addEventListener("click", (e) => {
    e.stopPropagation();
    deleteCell(cell);
  });

  return el;
}

function buildEmptyCell() {
  const el = document.createElement("div");
  el.className = "cell cell-empty";
  return el;
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
  setTimeout(() => { toast.style.display = "none"; }, 4000);
}

function setStatusText(text) {
  $("status-text").textContent = text || "";
}

function updateFooter() {
  const cellCount = cellsData.length;
  const total = Math.max(DEFAULT_CELL_COUNT, cellCount);
  $("footer-info").textContent = `全 ${total} セル中 ${cellCount} 件登録済み`;
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
