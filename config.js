// =============================================================
// マイドキュメント保管庫 設定ファイル (v3.0 - 第3段階)
// =============================================================

// 【1】Firebase 設定情報
const firebaseConfig = {
  apiKey: "AIzaSyAyb8E1PP2V0xNE2DZr2lXnzBpIzEJKWYw",
  authDomain: "my-document-vault-84c99.firebaseapp.com",
  projectId: "my-document-vault-84c99",
  storageBucket: "my-document-vault-84c99.firebasestorage.app",
  messagingSenderId: "705838323505",
  appId: "1:705838323505:web:8be7d3b71490314fecc210"
};

// 【2】OAuth クライアントID
const GOOGLE_CLIENT_ID = "705838323505-70a7vcqtous7hvpmh23t8arimevkj58j.apps.googleusercontent.com";

// 【3】Google Drive フォルダID（5つ）
const DRIVE_FOLDERS = {
  root: "1rcVTPe5oSl2d2Q-sH6pMOQW8w1TGr1I0",
  pdf: "1aVGu1jafqpT3LjGzjPAfsQPU9_QHkfQc",
  excel: "1yTGlRfRAhHIZv151PhQfM_qSR0TyMU0y",
  word: "1br795jTA1Ygfg_s1v2zMfJxUEEqNCJ8Y",
  other: "1YKy727Iy_AmPssNBByUgeb2RoT_Fd7nd"
};

// =============================================================
// 以下は変更不要です
// =============================================================

const TAB_DEFINITIONS = [
  { id: "pdf", name: "PDF", folderId: DRIVE_FOLDERS.pdf, color: "#A32D2D", letter: "P" },
  { id: "excel", name: "Excel・スプレッドシート", folderId: DRIVE_FOLDERS.excel, color: "#3B6D11", letter: "E" },
  { id: "word", name: "Word・Googleドキュメント", folderId: DRIVE_FOLDERS.word, color: "#185FA5", letter: "W" },
  { id: "other", name: "その他", folderId: DRIVE_FOLDERS.other, color: "#5F5E5A", letter: "O" }
];

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive";

const DEFAULT_CELL_COUNT = 100;

// ラベル用カラーパレット
const LABEL_COLOR_PRESETS = [
  { bg: "#EEEDFE", border: "#7F77DD", text: "#3C3489" },
  { bg: "#E1F5EE", border: "#1D9E75", text: "#085041" },
  { bg: "#FBEAF0", border: "#D4537E", text: "#72243E" },
  { bg: "#FAEEDA", border: "#BA7517", text: "#633806" },
  { bg: "#DBEEFB", border: "#378ADD", text: "#0C447C" },
  { bg: "#FCEBEB", border: "#E24B4A", text: "#7F1A1A" },
  { bg: "#FFF8C5", border: "#D4A72C", text: "#5C4112" },
  { bg: "#E8E5DA", border: "#888780", text: "#3F3E3D" },
  { bg: "#E1F4F4", border: "#1A9EA0", text: "#0A4F50" },
  { bg: "#F4DDF6", border: "#A347B5", text: "#5C2068" }
];

const UNCATEGORIZED_COLOR = { bg: "#FAEEDA", border: "#BA7517", text: "#633806" };
const FAVORITE_COLOR = { bg: "#FBEAF0", border: "#D4537E", text: "#72243E" };

// 第3段階：定数
const HISTORY_MAX_ITEMS = 100;    // 履歴の最大件数
const MEMO_MAX_LENGTH = 200;       // メモの最大文字数
