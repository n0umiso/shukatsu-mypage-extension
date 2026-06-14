# 自動入力 開発マニュアル

新しいサイトや項目に対応するときの手順書。

---

## 全体アーキテクチャ

```
profile.html (プロフィール登録)
    ↓ chrome.storage.local に保存
    ↓
popup.js → AUTOFILL_NOW メッセージ → content.js
                                         ↓
                               activeRule() でサイト判定
                                         ↓
                              AUTOFILLERS[rule.name](profile)
                                         ↓
                            ┌─ autofillIweb(p)     ← i-web 互換
                            │   ├─ name→value 直接マッピング
                            │   ├─ selectByLabel() ラジオ選択
                            │   ├─ textRules[] 質問文マッチ
                            │   └─ fillEnqFields() enq 汎用
                            │
                            └─ (将来) autofillAxol(p) 等
```

### 登場ファイル

| ファイル | 役割 |
|---------|------|
| `src/profile.html` | プロフィール入力フォーム。`data-profile="xxx"` 属性でキー名を定義 |
| `src/profile.js` | profile.html の読み書き |
| `src/lib/store.js` | `chrome.storage.local` への CRUD |
| `src/content.js` | 自動入力の本体。サイト検出・フォーム入力・締切抽出 |
| `src/popup.js` | ポップアップの「自動入力」ボタン → content.js へ `AUTOFILL_NOW` 送信 |
| `src/background.js` | メッセージルーター (`GET_PROFILE` / `SET_PROFILE` 等) |

---

## プロフィールのキー一覧

profile.html の `data-profile` 属性で定義。content.js では `p.xxx` でアクセス。

### 基本情報
| キー | 内容 | 例 |
|------|------|-----|
| `lastNameKanji` | 姓（漢字） | 田中 |
| `firstNameKanji` | 名（漢字） | 太郎 |
| `lastNameKana` | セイ（カナ） | タナカ |
| `firstNameKana` | メイ（カナ） | タロウ |
| `lastNameRoman` | 姓（ローマ字） | Tanaka |
| `firstNameRoman` | 名（ローマ字） | Taro |
| `gender` | 性別 | 男性 / 女性 / 回答しない |
| `birthYear` / `birthMonth` / `birthDay` | 生年月日 | 2003 / 06 / 15 |
| `email` | メールアドレス | tanaka@example.com |
| `email2` | 携帯メール（任意） | tanaka@docomo.ne.jp |

### 連絡先・住所
| キー | 内容 |
|------|------|
| `curPostal1` / `curPostal2` | 現住所郵便番号 (3桁 / 4桁) |
| `curPref` | 都道府県名 (例: 東京都) |
| `curAddr1` / `curAddr2` | 住所1 (市区町村) / 住所2 (建物) |
| `curTel1` / `curTel2` / `curTel3` | 固定電話 (3分割) |
| `mobile1` / `mobile2` / `mobile3` | 携帯番号 (3分割) |
| `homeSameAsCurrent` | 帰省先=現住所 (boolean) |
| `homePostal1` 〜 `homeTel3` | 帰省先（curXxx と同構造） |

### 学歴
| キー | 内容 |
|------|------|
| `schoolType` | 学校区分 (大学 / 大学院（修士） / 短期大学 等) |
| `uniPref` | 大学所在地（都道府県） |
| `university` | 大学名 |
| `scienceType` | 文理 (文系 / 理系) |
| `faculty` | 学部 |
| `department` | 学科 |
| `highSchool` | 高校名 |
| `highSchoolPref` | 高校所在地（都道府県） |
| `gradYear` / `gradMonth` | 卒業（見込み）年月 |
| `gradKbn` | 卒業区分 ("0"=見込み, "1"=卒業) |

### 学歴タイムライン（自動計算）

`fillEnqFields()` 内で `gradYear` と `schoolType` から逆算:

```
大学入学年 = gradYear - 在学年数
  大学: 4年 / 大学院(修士): 2年 / 短期大学: 2年
高校卒業年 = 大学入学年
高校入学年 = 高校卒業年 - 3
```

明示的に制御したい場合はプロフィールにフィールドを追加する。

---

## 自動入力の3層構造

### Layer 1: name→value 直接マッピング

フィールドの `name` 属性がわかっている場合。最も確実。

```javascript
const map = {
  kname1: p.lastNameKanji,
  kname2: p.firstNameKanji,
  // ...
};
for (const [name, val] of Object.entries(map)) {
  if (setField(name, val)) n++;
}
```

`setField(name, value)` は `document.getElementsByName(name)` で要素を見つけ、値をセットして `input` / `change` イベントを発火する。

**使う場面:** i-web の基本情報欄（`kname1`, `yname1`, `gyubin1` 等）のように、フィールド名が全サイト共通のとき。

### Layer 2: selectByLabel() ラジオ/チェックボックス選択

ラジオボタンのラベルテキストで一致するものをクリック。

```javascript
selectByLabel('gkbn', p.schoolType);  // name="gkbn" のラジオからラベルが一致するものを選択
```

**使う場面:** i-web の学校選択ウィザード（大学名・学部・学科がラジオ一覧で表示される）。

### Layer 3: 質問文キーワードマッチ（汎用）

フィールドの `name` が企業ごとに異なる（`enq33`, `enq50` 等）場合。
近辺のテキスト（ラベル、見出し、前の行）を読んでキーワードで判定する。

```javascript
// テキスト入力
const textRules = [
  { re: /大学名|大学院名|学校名/, val: p.university },
  { re: /学部/, val: p.faculty },
];

// ラジオ（fillEnqFields 内）
if (/学校|在学|課程/.test(sectionContext)) { ... }

// 日付セレクトグループ（enqXX[0], enqXX[1], ...）
if (/高校|高等学校/.test(ctx)) {
  vals = [hsEnterY, '04', hsGradY, '03', '0'];
}
```

**使う場面:** 企業固有の質問票（enq 系フィールド）。

---

## 新しいサイトに対応する手順

### Step 1: フォーム構造を調査

対象サイトのフォームを開き、DevTools のコンソールで以下を実行:

```javascript
// 全フォーム要素をダンプ
[...document.querySelectorAll('input, select, textarea')].map(el => {
  const type = el.tagName === 'SELECT' ? 'select-one' : el.type;
  const opts = el.tagName === 'SELECT'
    ? [...el.options].slice(0, 6).map(o => `${o.value}=${o.textContent}`).join(', ')
    : '';
  return `${el.tagName} ${type} name=${el.name} id=${el.id} «${(el.value || el.textContent || '').slice(0, 40)}»${opts ? ' OPTS[' + opts + ',…]' : ''}`;
}).join('\n');
```

### Step 2: 既存の i-web 互換かどうか判定

i-web 互換のフィールド名（`kname1`, `yname1`, `gyubin1` 等）が使われていれば、`SITE_RULES` の `test()` に検出条件を追加するだけで動く。

```javascript
// content.js の SITE_RULES[0].test
test: () =>
  /i-webs?\.jp$/.test(location.hostname) ||
  !!document.querySelector('input[name="gksid"], input[name="gkspw"]') ||
  !!document.querySelector('input[name="kname1"], input[name="yname1"]') ||
  /新しいホスト名/.test(location.hostname),  // ← 追加
```

### Step 3: 独自フィールド名のサイトの場合

#### 3a. SITE_RULES にルールを追加

```javascript
const SITE_RULES = [
  { name: 'i-web', test: () => ..., idSelector: '...', pwSelector: '...' },
  {
    name: 'axol',
    test: () => /axol\.jp$/.test(location.hostname),
    idSelector: 'input[name="login_id"]',
    pwSelector: 'input[name="login_pw"]',
  },
];
```

#### 3b. AUTOFILLERS に入力関数を追加

```javascript
function autofillAxol(p) {
  let n = 0;

  // Layer 1: 直接マッピング
  const map = {
    sei: p.lastNameKanji,
    mei: p.firstNameKanji,
    // ... サイト固有のフィールド名
  };
  for (const [name, val] of Object.entries(map)) {
    if (setField(name, val)) n++;
  }

  // Layer 3: 質問文マッチ（enq 系があれば）
  const knownNames = new Set(Object.keys(map));
  n += fillEnqFields(p, knownNames);

  return n;
}

const AUTOFILLERS = {
  'i-web': autofillIweb,
  'axol': autofillAxol,  // ← 追加
};
```

#### 3c. hasEntryForm() を更新

```javascript
function hasEntryForm() {
  return !!document.querySelector(
    'input[name="kname1"], ..., ' +
    'input[name="sei"]'  // ← axol のフィールドを追加
  );
}
```

### Step 4: 新しいプロフィール項目が必要な場合

1. `src/profile.html` にフィールドを追加:
   ```html
   <label>新しい項目<input data-profile="newField" /></label>
   ```

2. `src/content.js` のマッピングで使う:
   ```javascript
   map.site_field_name = p.newField;
   ```

`store.js` や `background.js` の変更は不要（profile は自由なキーバリューオブジェクト）。

---

## 質問文マッチの拡張方法

### テキスト入力の追加

`autofillIweb()` 内の `textRules` 配列に追加:

```javascript
const textRules = [
  { re: /(出身)?高校(名|学校名)?|出身校/, val: p.highSchool },
  { re: /大学名|大学院名|学校名/, val: p.university },
  { re: /学部/, val: p.faculty },
  { re: /学科|専攻|コース/, val: p.department },
  { re: /趣味/, val: p.hobby },  // ← 新規追加（プロフィール項目も追加が必要）
];
```

### ラジオの追加

`fillEnqFields()` 内のラジオ判定ブロックに条件を追加:

```javascript
// 文理
if (p.scienceType && /文理|文系.*理系/.test(q)) {
  const hit = radios.find((r) => clean(radioLabelText(r)).includes(clean(p.scienceType)));
  if (hit) { hit.click(); n++; continue; }
}
```

### 日付セレクトグループの追加

`fillEnqFields()` 内のセレクトグループ判定に条件を追加:

```javascript
// 中学校（もし出てきたら）
if (/中学/.test(ctx) && hsEnterY > 0) {
  vals = [String(hsEnterY - 3), '04', String(hsEnterY), '03', '0'];
}
```

---

## ユーティリティ関数リファレンス

| 関数 | 説明 |
|------|------|
| `setField(name, value)` | name 属性で要素を見つけて値をセット + イベント発火 |
| `selectByLabel(name, target)` | name のラジオ群からラベルが target に一致するものをクリック |
| `radioLabelText(el)` | ラジオ/チェックボックスのラベルテキストを取得 |
| `questionText(el)` | 入力欄の近接コンテナからテキストを取得 |
| `sectionContext(el)` | 近辺の行・見出しからキーワードを広く収集（fillEnqFields 内） |
| `prefCode(name)` | 都道府県名 → i-web コード ("01"〜"47") |
| `splitEmail(email)` | メールアドレス → [アカウント, ドメイン] |
| `pad2(v)` | 数値を2桁ゼロ埋め |
| `clean(s)` | 空白を除去 |
| `fire(el)` | input + change イベントを発火（サイト側の onchange をトリガー） |

---

## デバッグ方法

### content.js のログ

content.js 内に `console.log()` を追加し、対象サイトの DevTools コンソールで確認。

```javascript
// 例: sectionContext が何を返しているか確認
console.log('ctx:', sectionContext(items[0].el));
```

### 自動入力のドライラン

DevTools コンソールで直接テスト:

```javascript
// content script のスコープには入れないが、DOM 操作は確認可能
document.getElementsByName('enq34')[0].value = 'テスト大学';
```

### よくある問題

| 症状 | 原因 | 対処 |
|------|------|------|
| 自動入力ボタンが出ない | `activeRule()` が null | SITE_RULES の test を拡張 |
| ボタンは出るが入力されない | フィールド名が不一致 | Layer 1 の map にマッピング追加 or Layer 3 の textRules 追加 |
| select が変わらない | option の value が不一致 | DevTools で option の value を確認し、セットする値を調整 |
| イベントが発火しない | サイト側が独自イベントを使用 | `fire()` に `blur` や `focusout` を追加 |
| 質問文マッチが誤爆 | 正規表現が広すぎる | 正規表現を限定的にする or `knownNames` に追加 |
