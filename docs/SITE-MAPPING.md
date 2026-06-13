# 対応サイトと自動入力マッピング

各就活マイページのフォーム構造と、プロフィール項目との対応表。新サイト追加時の手順もここに。

## フォーム構造の調べ方

対象ページの DevTools Console（`Cmd+Option+J`、警告が出たら `allow pasting`）で実行:

```js
copy([...document.querySelectorAll('input,select,textarea')]
  .filter(e=>!['hidden','button','submit','image'].includes(e.type))
  .map(e=>{
    const label=(e.closest('tr,dl,li,div')?.innerText||'').replace(/\s+/g,' ').trim().slice(0,28);
    const opts=e.tagName==='SELECT'?' OPTS['+[...e.options].slice(0,6).map(o=>o.value+'='+o.text.trim()).join(', ')+(e.options.length>6?',…':'')+']':'';
    return `${e.tagName} ${e.type||''} name=${e.name} id=${e.id} «${label}»${opts}`;
  }).join('\n'))
```

→ クリップボードに各欄の `name`/`id`・ラベル・select選択肢が入る。

---

## i-web（ヒューマネージ / `*.i-webs.jp`）

- ログイン: ID=`gksid` / PW=`gkspw`。ログインは `onclick→form.submit()` のため **click イベント**で検知。
- 重複キー: `hostname + 先頭パス`（例 `mypage.3010.i-webs.jp/sojitz_group2028`）。同一ホストに複数企業が同居するため。
- 都道府県 select は `01`(北海道)〜`47`(沖縄) のコード。`content.js` の `PREFS` で名称→コード変換。

### 新規登録フォームのマッピング（`autofillIweb`）

| プロフィール | name | 備考 |
|---|---|---|
| 漢字 姓 / 名 | `kname1` / `kname2` | |
| カナ 姓 / 名 | `yname1` / `yname2` | 全角カナ |
| 生年月日 年/月/日 | `ybirth` / `mbirth` / `dbirth` | 月日はゼロ埋め |
| 卒業 年/月/区分 | `syear` / `smonth` / `shikbn` | 区分 `0`見込み / `1`卒業 |
| 現住所 〒 | `gyubin1`(3) / `gyubin2`(4) | |
| 現住所 都道府県 | `gken` | 名称→コード変換 |
| 現住所 住所1/2 | `gadrs1` / `gadrs2` | |
| 現住所 電話 | `gtel1/2/3` | |
| 携帯電話 | `kttel1/2/3` | |
| 帰省先 〒/県/住所/電話 | `kyubin1/2` `kken` `kadrs1/2` `ktel1/2/3` | 「現住所と同じ」でコピー |
| メール（本文+確認） | `account1`@`domain1` / `account2`@`domain2` | @で分割 |
| 携帯メール（本文+確認） | `account3`@`domain3` / `account4`@`domain4` | ※割り当ては要検証 |
| 備考 | `bikoa` / `bikob` | 入力しない |

> 1ページ目には **性別・ローマ字・大学名/学部/学科** の欄は無い（卒業年月のみ）。学校情報は2ページ目以降のウィザードで選択する。

### 学校選択ウィザード（2〜5ページ目）

valueコードではなく **ラベル文字でラジオを選択**する方式。`selectByLabel(name, ラベル)` がラベル一致で `.click()`。
各ページに該当 group だけ存在するため、ページごとに ⚡自動入力 を押すと該当項目が選択される。

| ページ | 項目 | name | プロフィール |
|---|---|---|---|
| 2 | 学校区分 | `gkbn` | `schoolType`（大学 等） |
| 2 | 学校所在地 | `dken` | `uniPref`（都道府県名） |
| 2 | 五十音検索 | `gon` | 未使用（所在地で代替） |
| 3 | 大学名 | `daicd` | `university`（正式名称） |
| 4 | 学部 | `gkbcd` | `faculty` |
| 5 | 学科 | `gkkcd` | `department` |
| 5 | 文理 | `s_brkbn` | `scienceType`（文系/理系） |

### 最終アンケート（`enq1`〜`enq64`）— 企業ごとに異なる

質問内容が企業依存のため**機械的マッピングはしない**。性別のみ、ラベル一致する radio を汎用検索して選択
（例: `enq1` の「男性」に `profile.gender` が一致すれば選択）。それ以外は手動。

### 未確定 / TODO
- [ ] メール欄 `account1〜4` の正確な役割（メイン/確認/携帯）の実機検証
- [ ] 学校名の表記ゆれ（正式名称 vs 略称）対策
- [ ] ログイン後ページ（お知らせ・選考状況）の締切抽出精度の専用化
- [ ] アンケートで個別に自動化したい設問があれば `autofillIweb` に追記

---

## axol（`axol.jp`） — 未対応

- [ ] ログイン欄の `name` 調査
- [ ] 登録フォームの `name` 調査 → `AUTOFILLERS['axol']` 追加

## e2r（`portal.e2r.jp`） — 未対応

- [ ] ログイン欄の `name` 調査
- [ ] 登録フォームの `name` 調査 → `AUTOFILLERS['e2r']` 追加

---

## 新サイト追加の手順

1. 上記スニペットでフォーム構造を取得
2. `content.js` の `SITE_RULES` に `{ name, test, idSelector, pwSelector }` を追加（ログイン検知）
3. `autofillXxx(profile)` を実装し `AUTOFILLERS` に登録（自動入力）
4. このファイルにマッピング表を追記
