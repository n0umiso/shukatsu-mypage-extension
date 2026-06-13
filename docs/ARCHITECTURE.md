# アーキテクチャ

就活マイページ マネージャーの構成・データフロー・拡張ポイントをまとめる。

## 全体像

```
┌────────────┐   message   ┌──────────────┐   storage   ┌─────────────────┐
│ content.js │ ──────────▶ │ background.js │ ──────────▶ │ chrome.storage  │
│ (各サイト)  │ ◀────────── │ (単一窓口)     │ ◀────────── │ .local (一次)    │
└────────────┘             └──────┬───────┘             └─────────────────┘
   ▲   │ 自動入力/締切抽出/        │ sync.js (fetch POST)
   │   │ ログイン検知              ▼
┌──┴───────────┐          ┌──────────────┐
│ popup / dashboard /     │ GAS Web アプリ │ → Google スプレッドシート
│ profile (UI)            │ (gas/Code.gs) │   (バックアップ/同期)
└─────────────┘          └──────────────┘
```

- **一次データソースは `chrome.storage.local`**。スプレッドシートは同期先（バックアップ）。
- **すべての書き込みは background.js 経由**（単一窓口）にして、保存と同期の整合を保つ。

## ストレージのキー

| キー | 内容 |
|------|------|
| `entries` | `{ [id]: Entry }` マイページ一覧 |
| `profile` | 自動入力用の個人データ（氏名・住所・学歴など） |
| `settings` | `gasUrl` / `autoSync` / `syncPassword` / `showAutofillButton` |
| `lastSync` | 最終同期日時（ISO） |

### Entry の形

```js
{
  id, host,              // host = hostname + 先頭パス（i-web の企業区別用）
  companyName, industry,
  mypageUrl, loginId, password,
  deadlines: [{ type, date }],
  stage, memo, updatedAt, deleted?   // stage は STAGES の8段 or OUTCOMES（お祈り/辞退）
}
```

選考ステージは `src/lib/stages.js` の `STAGES`（気になる→…→内定の8段）で定義。
ホームと選考管理は同じ `stage`/`deadlines` を別ビューで表示する（二重管理なし）。

ダッシュボードのビュー: ホーム / マイページ / 選考管理（進捗・カンバン） / 締切 / 設定。
「ログイン」押下時は `chrome.storage.session` に `pendingLogin` を置き、開いたタブの
content.js が `CONSUME_LOGIN` で受け取って ID/PW を自動入力する（自動送信はしない）。

## メッセージ API（background.js）

| type | 用途 |
|------|------|
| `LIST` | 有効な Entry 一覧を返す |
| `UPSERT` { entry } | 保存 + 自動同期 |
| `DELETE` { id } | 論理削除 + 同期 |
| `CAPTURE` { payload } | content からの自動取り込み（host で重複判定し統合） |
| `SYNC_ALL` | 全件をスプレッドシートへ手動同期 |
| `GET/SET_SETTINGS` | 設定の読み書き |
| `GET/SET_PROFILE` | プロフィールの読み書き |
| `CAPTURE_NOW`(→content) | popup「今のページ」取り込み要求 |

## ファイル責務

| ファイル | 責務 |
|----------|------|
| `src/background.js` | データ更新の単一窓口・同期トリガ・重複統合 |
| `src/content.js` | ログイン検知 / 締切抽出 / **自動入力** / ページ内ボタン注入 |
| `src/popup.*` | クイック操作（取り込み・同期・一覧へ） |
| `src/dashboard.*` | 全画面の一覧（カード・検索・ソート・締切カレンダー） |
| `src/profile.*` | 情報入力・設定（プロフィール + 同期/機能設定） |
| `src/lib/store.js` | storage ヘルパー |
| `src/lib/sync.js` | GAS への同期 |
| `gas/Code.gs` | スプレッドシート側 upsert |

## 拡張ポイント

- **対応サイト追加**: `content.js` の `SITE_RULES`（ログイン欄）と `AUTOFILLERS`（自動入力）に追記。詳細は [SITE-MAPPING.md](SITE-MAPPING.md)。
- **記録項目追加**: Entry に項目追加 → `sync.js` の `toPayload` と `gas/Code.gs` の `HEADERS`/`rowFromEntry_` を合わせる。
