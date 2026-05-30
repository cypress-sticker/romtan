# ROMたん

**Twitchの入室者（ROM専）をリアルタイムで通知するデスクトップアプリ**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)](https://github.com/cypress-sticker/romtan/releases)
[![Version](https://img.shields.io/badge/Version-2.0.1-green.svg)](https://github.com/cypress-sticker/romtan/releases)

[English README](README.en.md)

ROMたんは、Twitchチャンネルに入室したユーザーをリアルタイムで検知し、デスクトップにポップアップ通知するツールです。チャットに書き込まないROM専の視聴者にも気づくことができます。

> ⚠️ 現在 **Windows のみ** 対応しています。  
> Twitch API の仕様上、入室検知に **1〜2分程度のディレイ** が発生します。

---

## 機能

- **入室ポップアップ通知** — 視聴者がチャンネルに入室すると画面上にポップアップ表示
- **クリックスルーオーバーレイ** — 配信画面の上に重ねて表示、マウス操作を邪魔しない
- **通知音** — 入室時に効果音を再生（オン/オフ切り替え可能）
- **表示位置カスタマイズ** — 画面の四隅・中央から選択
- **ダーク / ライトモード**
- **入室ログ** — 入室履歴を別ウィンドウで確認

---

## ダウンロード

[Releases](https://github.com/cypress-sticker/romtan/releases) から最新の `.zip` をダウンロードしてください。

> **初回起動時の警告について**  
> 「WindowsによってPCが保護されました」と表示される場合は、「詳細情報」→「実行」でご利用いただけます。コード署名に未対応のため表示される警告です。

---

## 使い方

1. `.zip` を展開し、`ROMたん.exe` を起動
2. **「Twitchでログイン」** をクリックして認証
3. 通知の位置・音などを設定して **「接続」**
4. 視聴者が入室するとポップアップが表示されます

---

## 開発環境のセットアップ

### 必要なもの
- [Node.js](https://nodejs.org/) 18以上
- Twitch Developer Application（[dev.twitch.tv/console](https://dev.twitch.tv/console) で作成）

### 手順

```bash
git clone https://github.com/cypress-sticker/romtan.git
cd romtan
npm install
```

`.env.example` をコピーして `.env` を作成し、自分のTwitch Client IDを設定します。

```bash
cp .env.example .env
# .env を編集して TWITCH_CLIENT_ID を入力
```

Twitch Developer Consoleで以下を設定してください：
- **OAuth Redirect URL**: `http://localhost:3000`

```bash
npm start
```

### ビルド

```bash
npm run build
```

`release/` フォルダにポータブル版（`.zip`）が生成されます。

---

## アーキテクチャ

```
main.js              ← Electron メインプロセス（OAuth・API ポーリング・IPC）
preload.js           ← IPC ブリッジ（context bridge）
renderer/
  control.html       ← コントロールパネル（設定・接続UI）
  overlay.html       ← オーバーレイ（ポップアップ通知）
  log.html           ← 入室ログウィンドウ
  manual.html        ← 使い方マニュアル
  assets/            ← CSS・JS・効果音
```

**動作の流れ：**
1. `main.js` が Twitch Chatters API を5秒間隔でポーリング
2. 新規入室者を検知 → `control.html` にイベントを送信
3. `control.html` → `main.js` → `overlay.html` へ IPC で通知
4. `overlay.html` がポップアップを表示

---

## バージョン履歴

### v2.0.1（2026-05-30）
- アプリを閉じた後に再起動できなくなるバグを修正

### v2.0.0（2026-05-30）
- **フォロー管理ウィンドウを追加**（メイン機能）
  - 「フォロワー」「フォロー中」のモード切替
  - フォロワーモード：全員 / 配信に来た人 / 片思われ / 相互さん のフィルター
  - フォロー中モード：全員 / 配信に来た人 / 片思い / 相互さん のフィルター
  - 新しい順 / 古い順 / アルファベット順 のソート
  - 名前クリックで Twitch プロフィールを開く
- **来場者履歴の自動蓄積** — 配信ごとに来場者を記録し「配信に来た人」フィルターに活用
- CSVエクスポート機能を追加
- 認証トークン期限切れ時の案内表示を追加

### v1.0.5（2026-04-21）
- 初回リリース
- Twitch 入室通知のポップアップ表示
- クリックスルーオーバーレイ
- 通知音・表示位置カスタマイズ
- 入室ログウィンドウ
- ダーク / ライトモード

---

## コントリビューション

バグ報告・機能提案・プルリクエスト、いずれも歓迎です。  
詳しくは [CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

---

## ライセンス

[MIT](LICENSE) © cypress_sticker
