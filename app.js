// ============================================================
// マイドキュメント保管庫 アプリケーションロジック (第1段階)
// ============================================================

// ----- グローバル状態 -----
let currentTab = "pdf";              // 現在選択中のタブID
let firebaseUser = null;             // Firebase認証ユーザー
let googleAccessToken = null;        // Google Drive APIアクセストークン
let tokenClient = null;              // Google OAuth トークンクライアント
let cellsData = [];                  // 現在のタブのセルデータ

// ----- DOM 要素 -----
const $ = (id) => document.getElementById(id);

// ----- 起動 -----
window.addEventListener("DOMContentLoaded", () => {
  // Firebase 初期化
  firebase.initializeApp(firebaseConfig);
  
  // 認証状態の監視
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      firebaseUser = user;
      showMainScreen();
    } else {
      firebaseUser = null;
      showLoginScreen();
    }
  });

  // ログインボタン
  $("login-btn").addEventListener("click", handleLogin);

  // ログアウトボタン
  $("logout-btn").addEventListener("click", handleLogout);

  // ファイル追加ボタン
  $("add-file-btn").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", handleFileSelect);

  // 更新ボタン
  $("refresh-btn").addEventListener("click", () => loadCells());

  // タブ生成
  renderTabs();
});

// ============================================================
// ログイン処理
// ============================================================
async function handleLogin() {
  setLoginStatus("ログイン中...");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope("https://www.googleapis.com/auth/drive.file");
    await firebase.auth().signInWithPopup(provider);
    // onAuthStateChangedで自動的にメイン画面へ
  } catch (e) {
    console.error(e);
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

  // Google Identity Services のトークンクライアントを初期化
  initGoogleTokenClient();

  // Google Drive APIへのアクセストークンを取得
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
      if (tokenResponse && tokenResponse.access_token) {
        googleAccessToken = tokenResponse.access_token;
        // 初回トークン取得後にセル読み込み
        loadCells();
      }
    },
  });
}

function requestDriveToken() {
  if (!tokenClient) {
    setTimeout(requestDriveToken, 500);
    return;
  }
  // ユーザーにアクセス許可を求める（ヒントを渡してUIを最小化）
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
// セルの読み込み (Firestore + Drive)
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

    // 1. Firestoreから現タブのメタデータを取得
    const fsCells = await loadFirestoreCells(tabDef.id);

    // 2. Driveから現タブフォルダ内のファイル一覧を取得
    const driveFiles = await loadDriveFiles(tabDef.folderId);

    // 3. マージ：Firestoreにあるものはそのまま、Driveだけにあるものは新規作成
    cellsData = await mergeCellsAndFiles(fsCells, driveFiles, tabDef.id);

    renderGrid();
    updateFooter();
  } catch (e) {
    console.error(e);
    showToast("読み込みエラー: " + (e.message || e), "error");
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
  // order順でソート
  cells.sort((a, b) => (a.order || 0) - (b.order || 0));
  return cells;
}

async function loadDriveFiles(folderId) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,modifiedTime,createdTime)&pageSize=200`;
  const res = await fetch(url, {
    headers: { Authorization: "Bearer " + googleAccessToken }
  });
  if (!res.ok) {
    if (res.status === 401) {
      // トークン期限切れ → 再取得
      requestDriveToken();
      throw new Error("認証期限切れ。再ログインしてください。");
    }
    throw new Error("Drive APIエラー: " + res.status);
  }
  const data = await res.json();
  return data.files || [];
}

async function mergeCellsAndFiles(fsCells, driveFiles, tabId) {
  // FirestoreにあるDriveファイルIDのセット
  const fsFileIds = new Set(fsCells.map((c) => c.driveFileId).filter(Boolean));
  // DriveにあるファイルIDのセット
  const driveFileIds = new Set(driveFiles.map((f) => f.id));

  // 1. Firestoreにあって、Driveにもまだあるセル → そのまま残す
  let merged = fsCells.filter((c) => driveFileIds.has(c.driveFileId));

  // 2. Firestoreになくて、Driveにだけあるファイル → 新規セル作成
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

  // 3. orderで再ソート
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
  
  const dateStr = formatDate(cell.driveCreatedTime || (cell.registeredAt && cell.registeredAt.toDate ? cell.registeredAt.toDate() : null));

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

  // クリック → Driveプレビュー画面を別タブで開く
  el.addEventListener("click", (e) => {
    if (e.target.closest(".cell-action-btn")) return;
    openInDrive(cell);
  });

  // 削除ボタン
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
  // Driveのプレビューページを別タブで開く
  const url = `https://drive.google.com/file/d/${cell.driveFileId}/view`;
  window.open(url, "_blank");
}

async function deleteCell(cell) {
  if (!confirm(`「${cell.title}」を削除しますか？\n\nGoogle Drive上のファイルも削除されます。`)) return;

  showLoading("削除中...");
  try {
    // 1. Driveからファイルを削除
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${cell.driveFileId}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + googleAccessToken }
    });
    if (!res.ok && res.status !== 404) {
      throw new Error("Driveからの削除に失敗: " + res.status);
    }

    // 2. Firestoreからメタデータを削除
    await firebase.firestore()
      .collection("users").doc(firebaseUser.uid)
      .collection("cells").doc(cell.id).delete();

    showToast("削除しました", "success");
    await loadCells();
  } catch (e) {
    console.error(e);
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
  e.target.value = ""; // 同じファイルでも再選択できるように
  
  showLoading(`「${file.name}」をアップロード中...`);
  try {
    const tabDef = getCurrentTabDef();
    const driveFile = await uploadToDrive(file, tabDef.folderId);
    showToast("アップロード完了", "success");
    await loadCells();
  } catch (e) {
    console.error(e);
    showToast("アップロード失敗: " + (e.message || e), "error");
  } finally {
    hideLoading();
  }
}

async function uploadToDrive(file, folderId) {
  // Driveへのマルチパートアップロード
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
  setTimeout(() => { toast.style.display = "none"; }, 3000);
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
