# Contributing to ROMたん

コントリビューションありがとうございます！バグ報告・機能提案・プルリクエストを歓迎しています。

---

## バグ報告・機能提案

[Issues](https://github.com/cypress-sticker/romtan/issues) からお気軽にどうぞ。

- **バグ報告**: 再現手順、期待する動作、実際の動作、環境（OSバージョン、アプリバージョン）
- **機能提案**: やりたいこと、なぜ欲しいか

---

## プルリクエスト

### 事前準備

1. リポジトリをフォーク
2. 開発環境をセットアップ（[README.md](README.md) の「開発環境のセットアップ」参照）
3. 自分のTwitch Appを用意して `.env` に `TWITCH_CLIENT_ID` を設定

### ブランチ運用

```
main        ← 安定版
feature/*   ← 新機能
fix/*       ← バグ修正
```

### PRを出す前に

- `npm start` で動作確認
- ポップアップ通知・オーバーレイ・ログウィンドウの動作を確認

---

## コードの方針

- フレームワークを増やさない方向で（現状 Electron + tmi.js + ws のみ）
- UIは `renderer/` 以下の素のHTML/CSS/JSで完結させる
- Twitch Chatters API のポーリング間隔（5秒）は Twitch API の利用規約の範囲内で維持する

---

## ライセンス

コントリビューションは [MIT License](LICENSE) のもとで公開されます。
