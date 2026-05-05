# マイドキュメント保管庫 セットアップ手順書（第1段階）

このZIPには、マイドキュメント保管庫の第1段階（基本機能）のコード一式が入っています。

## 含まれるファイル

```
my-document-vault/
├── index.html          ← メイン画面
├── style.css           ← デザイン
├── app.js              ← アプリのロジック
├── config.js           ← 【ここに設定値を記入】
├── firestore.rules     ← Firestoreセキュリティルール
└── README.md           ← このファイル
```

## セットアップ手順

### 【1】config.js に設定値を記入する

ZIP解凍後、`config.js` をメモ帳などで開いて、設定値メモの内容を記入してください。

**変更が必要な箇所：**

```javascript
const firebaseConfig = {
  apiKey: "【ここにapiKey】",         ← 設定値メモのapiKeyを貼り付け
  authDomain: "【ここにauthDomain】",  ← 同様に
  projectId: "【ここにprojectId】",    ← 同様に
  storageBucket: "【ここにstorageBucket】",
  messagingSenderId: "【ここにmessagingSenderId】",
  appId: "【ここにappId】"
};

const GOOGLE_CLIENT_ID = "【ここにOAuthクライアントID】";

const DRIVE_FOLDERS = {
  root: "【ここに親フォルダID】",
  pdf: "【ここにPDFフォルダID】",
  excel: "【ここにExcel・スプレッドシートフォルダID】",
  word: "【ここにWord・GoogleドキュメントフォルダID】",
  other: "【ここにその他フォルダID】"
};
```

**【】を含めて、すべて自分の値に置き換えてください。** 二重引用符 `"` は残してください。

### 【2】Firestoreセキュリティルールを設定する

セキュリティルールは、誰がデータを読み書きできるかを定義します。
今のテストモードのままだと30日後に書き込みができなくなるので、必ず設定してください。

1. Firebase Console を開く: https://console.firebase.google.com
2. `my-document-vault` プロジェクトを開く
3. 左メニュー → Firestore → 「ルール」タブ
4. 既存のルールを全て消して、`firestore.rules` の内容をコピー＆貼り付け
5. 「公開」ボタンをクリック

### 【3】GitHubにファイルをアップロードする

1. https://github.com/dy8714-dotcom/my-document-vault を開く
2. ZIPを解凍したフォルダを開いておく
3. GitHubのページで「Add file」→「Upload files」をクリック
4. 解凍したフォルダの中身（index.html, style.css, app.js, config.js, firestore.rules, README.md）を**全部**ドラッグ&ドロップ
   - **重要**：フォルダごとではなく、フォルダの「中身」をアップロード
5. 下にある「Commit changes」のボタンをクリック

### 【4】GitHub Pagesでアクセスする

数分待ってから、以下のURLを開いてください：

**https://dy8714-dotcom.github.io/my-document-vault/**

### 【5】初回ログイン

1. 「Googleアカウントでログイン」ボタンをクリック
2. テストユーザーに登録したGoogleアカウントを選択
3. 「Google has not verified this app」のような警告画面が出たら：
   - 「詳細」または「Advanced」をクリック
   - 「（安全でない）に移動」または「Go to my-document-vault (unsafe)」をクリック
   - これは、テストモードのアプリで自分自身がログインする際に表示される正常な警告です
4. Driveアクセス許可の画面が出るので、「許可」をクリック
5. メイン画面が表示されれば成功！

## 使い方

### ファイル追加
- 「+ ファイル追加」ボタン → ファイルを選択 → 自動でDriveにアップロードされ、セルとして表示される

### ファイル閲覧
- セルをクリック → Driveのプレビュー画面が別タブで開く

### ファイル削除
- セルにマウスを乗せる → 右上の「×」ボタン → 確認ダイアログ → OK
- **注意**：Drive上のファイルも一緒に削除されます

### Drive直接追加
- DriveでPDFフォルダ等に直接ファイルを置く
- アプリで「↻ 更新」ボタンを押すと、新しいファイルが自動でセルになる

### タブ切替
- PDF / Excel・スプレッドシート / Word・Googleドキュメント / その他

## トラブルシューティング

### ログイン画面で「ログインに失敗しました」と出る
- config.jsの値が正しいか確認
- Firebase Console → Authentication → 「Google」が有効になっているか確認

### 「Driveに接続中...」のまま動かない
- ブラウザのポップアップがブロックされていないか確認
- 一度ログアウトして再度ログインを試す

### ファイルアップロードでエラー
- Driveの容量が足りているか確認
- 大きなファイル（数百MB以上）は時間がかかります

### 認証エラー（401）が出る
- アクセストークンの期限切れの可能性
- ページをリロード（F5）して再ログイン

### 7日経ったらログインできなくなった
- これはOAuthテストモードの仕様です。再度ログインすれば使えます

## 第1段階で実装されている機能

- ✅ Googleログイン
- ✅ 4タブ構成
- ✅ 5×20の100セルグリッド
- ✅ Webアプリからのファイル追加
- ✅ Drive直接追加の自動認識
- ✅ セルクリックで別タブ閲覧
- ✅ セル削除（Drive側も削除）
- ✅ 100セル自動拡張（ファイルが増えたら）

## 次の段階で追加予定の機能

- 第2段階：ラベル管理、ドラッグ並び替え、複数ラベル、未分類自動振り分け
- 第3段階：検索、お気に入り、メモ、登録日/更新日切替
- 第4段階：プレビュー、サムネイル、期限、ファイル差し替え、エクスポート

第1段階が動作確認できたら、お知らせください。第2段階に進みます。
