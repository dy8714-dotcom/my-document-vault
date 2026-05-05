// =============================================================
// マイドキュメント保管庫 設定ファイル
// =============================================================
// このファイルに、設定値メモの内容を記入してください。
// すべての【ここに〇〇〇】の部分を、ご自身の値に書き換えてください。
// =============================================================

// 【1】Firebase 設定情報
// Firebase Console → プロジェクト設定 → 全般 → マイアプリ から取得した値
const firebaseConfig = {
  apiKey: "AIzaSyAyb8E1PP2V0xNE2DZr2lXnzBpIzEJKWYw",
  authDomain: "【ここにauthDomain】",
  projectId: "【ここにprojectId】",
  storageBucket: "【ここにstorageBucket】",
  messagingSenderId: "【ここにmessagingSenderId】",
  appId: "【ここにappId】"
};

// 【2】OAuth クライアントID
// Google Cloud Console → クライアント → 作成したクライアント から取得
const GOOGLE_CLIENT_ID = "【ここにOAuthクライアントID】";

// 【3】Google Drive フォルダID（5つ）
// 各フォルダのURLから取得した、folders/の後ろの長い文字列
const DRIVE_FOLDERS = {
  root: "【ここに親フォルダID】",
  pdf: "【ここにPDFフォルダID】",
  excel: "【ここにExcel・スプレッドシートフォルダID】",
  word: "【ここにWord・GoogleドキュメントフォルダID】",
  other: "【ここにその他フォルダID】"
};

// =============================================================
// 以下は変更不要です
// =============================================================

// タブの定義（タブ名とDriveフォルダの対応）
const TAB_DEFINITIONS = [
  { id: "pdf", name: "PDF", folderId: DRIVE_FOLDERS.pdf, color: "#A32D2D", letter: "P" },
  { id: "excel", name: "Excel・スプレッドシート", folderId: DRIVE_FOLDERS.excel, color: "#3B6D11", letter: "E" },
  { id: "word", name: "Word・Googleドキュメント", folderId: DRIVE_FOLDERS.word, color: "#185FA5", letter: "W" },
  { id: "other", name: "その他", folderId: DRIVE_FOLDERS.other, color: "#5F5E5A", letter: "O" }
];

// Google API スコープ
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";

// デフォルトセル数
const DEFAULT_CELL_COUNT = 100;
