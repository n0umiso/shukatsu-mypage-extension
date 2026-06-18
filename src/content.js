// 就活マイページ上で動く content script。
// 1) ログイン時に ID/PW を自動キャプチャ（submit / ボタンclick / Enter を網羅）
// 2) ページ内から締切らしき日付を抽出
// 3) popup からの「今のページを取り込む」要求に応答

(() => {
  'use strict';
  if (window.__shukatsuMypageContentLoaded) return;
  window.__shukatsuMypageContentLoaded = true;

  // ---- サイト別ルール ---------------------------------------------------
  // i-web 等、サイト固有のフィールド名・キー構造に対応する。
  const SITE_RULES = [
    {
      // ヒューマネージ i-web 互換 (i-webs.jp + 同じフィールド名を使うサイト全般)
      name: 'i-web',
      test: () =>
        /i-webs?\.jp$/.test(location.hostname) ||
        !!document.querySelector('input[name="gksid"], input[name="gkspw"]') ||
        !!document.querySelector('input[name="kname1"], input[name="yname1"]'),
      idSelector: '#gksid, input[name="gksid"]',
      pwSelector: 'input[name="gkspw"]',
    },
    {
      // kanji_sei / kana_sei 系フォーム（マイナビ等）
      name: 'mynaviStyle',
      test: () =>
        !!document.querySelector('input[name="kanji_sei"], input[name="kana_sei"]'),
      idSelector: 'input[name="email"]',
      pwSelector: 'input[type="password"]',
    },
  ];

  function activeRule() {
    return SITE_RULES.find((r) => {
      try {
        return r.test();
      } catch {
        return false;
      }
    });
  }

  // ---- 重複判定キー -----------------------------------------------------
  // i-web は同一ホストに複数企業が先頭パスで同居するため、host + 先頭パスをキーにする。
  function siteKey() {
    const seg = location.pathname.split('/').filter(Boolean)[0] || '';
    return location.hostname + (seg ? '/' + seg : '');
  }

  // 全角スペースも除去する trim
  function trimJp(s) {
    return (s || '').replace(/^[\s　]+|[\s　]+$/g, '');
  }

  // ---- 締切抽出 ---------------------------------------------------------
  const DEADLINE_KEYWORDS = [
    '締切', '〆切', '〆', '締め切り', '期限', '期日', 'まで',
    'エントリー', 'ES', 'エントリーシート', '提出', '応募',
    '説明会', 'セミナー', '面接', '選考', 'テスト', 'Webテスト', '適性検査',
  ];

  // 2026/6/13・2026年6月13日・6/13・6月13日 などにマッチ
  const DATE_RE =
    /(\d{4})\s*[\/年\-.]\s*(\d{1,2})\s*[\/月\-.]\s*(\d{1,2})\s*日?|(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?/g;

  function normalizeDate(m) {
    if (m[1]) {
      const y = m[1], mo = String(m[2]).padStart(2, '0'), d = String(m[3]).padStart(2, '0');
      return `${y}/${mo}/${d}`;
    }
    let y = new Date().getFullYear();
    const mo = String(m[4]).padStart(2, '0'), d = String(m[5]).padStart(2, '0');
    const candidate = new Date(`${y}-${mo}-${d}`);
    if (candidate < new Date()) y += 1;
    return `${y}/${mo}/${d}`;
  }

  function guessType(line) {
    if (/エントリーシート|ES|提出|応募/.test(line)) return 'ES/エントリー';
    if (/説明会|セミナー/.test(line)) return '説明会';
    if (/面接/.test(line)) return '面接';
    if (/テスト|適性|Webテスト/.test(line)) return 'テスト';
    if (/選考/.test(line)) return '選考';
    if (/エントリー/.test(line)) return 'エントリー';
    return '締切';
  }

  // 行テキストから日付・時刻・括弧を除去し、締切の種別ラベルを取り出す
  const DATE_STRIP_RE =
    /(\d{4})\s*[\/年\-.\s]\s*(\d{1,2})\s*[\/月\-.\s]\s*(\d{1,2})\s*日?|(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*日?/g;
  function cleanLineLabel(line) {
    let s = line
      .replace(DATE_STRIP_RE, '')                        // 日付を除去
      .replace(/[（(][^）)]*[）)]/g, '')                  // 括弧内の補足を除去
      .replace(/正午|午前|午後|\d{1,2}時(\d{1,2}分)?/g, '') // 時刻表現を除去
      .replace(/[：:・|｜→▶▷►]/g, ' ')                   // 区切り文字をスペースに
      .replace(/^[\s　\-─―–]+|[\s　\-─―–]+$/g, '')   // 前後の装飾・空白除去
      .replace(/\s{2,}/g, ' ')                           // 連続スペースを1つに
      .trim();
    // 1〜2文字だけ残る場合はノイズと見なす（例: "まで"）
    if (s.length <= 2) return '';
    return s;
  }

  // 締切行より前を遡り、イベント名と●行の補足情報を探す
  const BOILERPLATE_RE =
    /こちら|ください|ありがとう|STEP\d|回答して|アップロード|入力|申込受付|ログイン|メッセージ|チェック|未読|既読|動画を|アンケート|バナー|ご視聴|ご確認|ご了承/;
  function findContext(lines, idx) {
    let subContext = '';          // ●エントリー締切 などの補足
    let heading = '';            // イベント名
    let headingIdx = -1;         // 最初に見つけた見出しの行番号
    for (let i = idx - 1; i >= Math.max(0, idx - 10); i--) {
      const l = lines[i];
      if (!l || l.length > 80 || l.length < 2) continue;
      // ● 行は締切の種別を表す補足情報
      if (/^[●▶▷■□◆◇★☆►]/.test(l)) {
        if (!subContext) subContext = l.replace(/^[●▶▷■□◆◇★☆►]\s*/, '').trim();
        continue;
      }
      if (/^※/.test(l)) continue;                   // 注記
      if (BOILERPLATE_RE.test(l)) continue;          // 定型文
      if (/^[ー\-─―–=＝]+$/.test(l)) continue;     // 装飾行
      // 日付を含む行はスキップ（開催日程など）
      DATE_RE.lastIndex = 0;
      const hasDate = DATE_RE.test(l);
      DATE_RE.lastIndex = 0;
      if (hasDate) continue;
      if (!heading) {
        // 最初の見出し候補
        heading = l;
        headingIdx = i;
      } else if (headingIdx - i <= 1) {
        // 直前の行も見出し（複数行のイベント名）→ 先頭に結合
        heading = l + ' ' + heading;
        break;
      } else {
        // 離れた行は無関係な UI 要素とみなす
        break;
      }
    }
    return { heading: heading.trim(), subContext };
  }

  function buildLabel(heading, lineLabel, subContext, type) {
    const parts = [];
    if (heading) parts.push(heading);
    // 行ラベルがあればそれを、なければ●行の補足を使う
    const detail = lineLabel || subContext || '';
    // heading と重複しないなら追加
    if (detail && !heading.includes(detail) && !detail.includes(heading)) {
      parts.push(detail);
    }
    let label = parts.join(' ');
    if (label.length > 50) label = label.slice(0, 48) + '…';
    return label || type;
  }

  function extractDeadlines() {
    const text = document.body ? document.body.innerText : '';
    const allLines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const found = [];
    const seen = new Set();
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i];
      if (line.length > 120) continue;
      if (!DEADLINE_KEYWORDS.some((k) => line.includes(k))) continue;
      // 日付があるか確認
      DATE_RE.lastIndex = 0;
      if (!DATE_RE.test(line)) continue;
      DATE_RE.lastIndex = 0;

      const type = guessType(line);
      const lineLabel = cleanLineLabel(line);
      const { heading, subContext } = findContext(allLines, i);
      const label = buildLabel(heading, lineLabel, subContext, type);

      let m;
      DATE_RE.lastIndex = 0;
      while ((m = DATE_RE.exec(line)) !== null) {
        const date = normalizeDate(m);
        const key = `${type}|${date}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ type, date, label });
      }
    }
    return found;
  }

  // ---- ログイン情報の推定 ----------------------------------------------
  function findCredentials() {
    const rule = activeRule();

    // パスワード欄: サイトルール優先、無ければ汎用
    const pw =
      (rule && document.querySelector(rule.pwSelector)) ||
      document.querySelector('input[type="password"]');
    if (!pw) return null;

    // ID欄: サイトルール優先
    let idInput = rule && document.querySelector(rule.idSelector);
    if (!idInput) {
      // 汎用: password より前にある text/email/tel 入力の直前のもの
      const inputs = Array.from(
        document.querySelectorAll(
          'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
        )
      );
      for (const inp of inputs) {
        if (pw.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_PRECEDING) {
          idInput = inp;
        }
      }
    }
    return {
      loginId: idInput ? idInput.value : '',
      password: pw.value || '',
    };
  }

  function companyGuess() {
    let t = trimJp(document.title);
    t = t.replace(/[|｜<>‹›«»].*$/, '');
    t = t.replace(/(マイページ|ログイン|採用|エントリー|新卒|MyPage|Login).*/gi, '');
    t = trimJp(t);
    return t || location.hostname;
  }

  function buildPayload(creds) {
    return {
      host: siteKey(),
      mypageUrl: location.href,
      companyName: companyGuess(),
      loginId: creds ? creds.loginId : '',
      password: creds ? creds.password : '',
      deadlines: extractDeadlines(),
    };
  }

  // ---- popup からの手動取り込み要求 ------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CAPTURE_NOW') {
      const creds = findCredentials();
      sendResponse({ ok: true, payload: buildPayload(creds) });
    } else if (msg.type === 'AUTOFILL_NOW') {
      const rule = activeRule();
      const filler = rule && AUTOFILLERS[rule.name];
      if (!filler) {
        sendResponse({ ok: false, error: 'unsupported', hasForm: false });
      } else if (!hasEntryForm()) {
        sendResponse({ ok: false, error: 'no_form', hasForm: false });
      } else {
        const profile = msg.profile || {};
        const n = filler(profile);
        sendResponse({ ok: true, filled: n });
      }
    }
    return true;
  });

  // =====================================================================
  //  自動入力（プロフィール → フォーム）
  // =====================================================================
  const PREFS = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
  ];
  function prefCode(name) {
    const i = PREFS.indexOf((name || '').trim());
    return i < 0 ? '' : String(i + 1).padStart(2, '0');
  }
  const pad2 = (v) => (v === '' || v == null ? '' : String(v).padStart(2, '0'));

  // 1つの name に値を入れ、input/change/blur を発火（サイト側のバリデーションを起動）
  function setField(name, value) {
    if (value == null || value === '') return false;
    const els = document.getElementsByName(name);
    let touched = false;
    for (const el of els) {
      if (el.type === 'radio' || (el.type === 'checkbox' && typeof value === 'boolean')) {
        el.checked = !!value;
      } else if (el.type === 'checkbox') {
        el.checked = !!value;
      } else {
        el.value = String(value);
      }
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      touched = true;
    }
    return touched;
  }

  function splitEmail(email) {
    const at = (email || '').indexOf('@');
    return at > 0 ? [email.slice(0, at), email.slice(at + 1)] : ['', ''];
  }

  // select の options が読み込まれるのを待つ（検索ボタン押下後の非同期用）
  // expectRefresh=true のとき、既存 options が一度クリアされて再読込されるのを待つ
  function waitForOptions(selectName, timeoutMs = 4000, expectRefresh = false) {
    return new Promise((resolve) => {
      const el = document.querySelector(`select[name="${selectName}"]`);
      if (!el) { resolve(false); return; }
      const hasReal = () => [...el.options].some((o) => o.value && o.value !== '');
      if (!expectRefresh && hasReal()) { resolve(true); return; }
      let cleared = !expectRefresh;
      const observer = new MutationObserver(() => {
        if (expectRefresh && !cleared) { cleared = true; return; }
        if (hasReal()) { observer.disconnect(); resolve(true); }
      });
      observer.observe(el, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(hasReal());
      }, timeoutMs);
    });
  }

  // フィールド近傍のボタンをテキストで探してクリック
  function clickButtonNear(fieldName, buttonText) {
    const field = document.querySelector(`[name="${fieldName}"]`);
    if (!field) return false;
    // 1) 親を辿って探す
    let cur = field.parentElement;
    for (let i = 0; i < 8 && cur; i++) {
      const btns = [...cur.querySelectorAll('input[type="button"], input[type="submit"], button')];
      const btn = btns.find((b) => (b.value || b.textContent || '').includes(buttonText));
      if (btn) { btn.click(); return true; }
      cur = cur.parentElement;
    }
    // 2) ページ全体から該当テキストのボタンを探す（フォールバック）
    const allBtns = [...document.querySelectorAll('input[type="button"], input[type="submit"], button')];
    const btn = allBtns.find((b) => (b.value || b.textContent || '').includes(buttonText));
    if (btn) { btn.click(); return true; }
    return false;
  }

  // 短いディレイ
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // select から名前でマッチする option を選択（部分一致対応）
  function selectOptionByText(selectName, text) {
    if (!text) return false;
    const el = document.querySelector(`select[name="${selectName}"]`);
    if (!el) return false;
    const t = text.trim();
    const opts = [...el.options].filter((o) => o.value && o.value !== '');
    const exact = opts.find((o) => o.textContent.trim() === t);
    const partial = !exact && opts.find((o) => o.textContent.includes(t) || t.includes(o.textContent.trim()));
    const hit = exact || partial;
    if (!hit) return false;
    el.value = hit.value;
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  // ラジオ/チェックの「ラベル文字」を取得（i-web は value でなくラベルで選ぶ）
  function radioLabelText(el) {
    if (el.labels && el.labels.length) return el.labels[0].textContent || '';
    const p = el.closest('label, td, li, dd, div, span');
    return p ? p.textContent : '';
  }
  const clean = (s) => (s || '').replace(/\s+/g, '');

  // テキスト入力の「質問文」を取得（近接コンテナのテキスト）
  function questionText(el) {
    const p = el.closest('td, dd, li, label, p, tr, div, fieldset');
    if (!p) return '';
    // テーブルレイアウト: td 内の input だとラベルが隣の td にあるので行全体を見る
    if (p.tagName === 'TD') {
      const row = p.closest('tr');
      if (row) return row.textContent;
    }
    return p.textContent;
  }

  // 指定 name のラジオ群から、ラベルが target に一致するものを選択（クリック）
  function selectByLabel(name, target) {
    if (!target) return false;
    const t = clean(target);
    const els = [...document.getElementsByName(name)].filter(
      (e) => e.type === 'radio' || e.type === 'checkbox'
    );
    const el =
      els.find((e) => clean(radioLabelText(e)) === t) ||
      els.find((e) => clean(radioLabelText(e)).includes(t));
    if (el) { el.click(); return true; }
    return false;
  }

  // 電話番号文字列 "03-1234-5678" → ["03","1234","5678"]、統合/旧分割両対応
  function splitPhone(unified, part1, part2, part3) {
    if (unified) {
      const parts = unified.split(/[-ー－]/);
      if (parts.length >= 3) return parts.slice(0, 3);
      if (parts.length === 2 && parts[1].length > 0) return [parts[0], parts[1], ''];
      // ハイフンなし: 数字列から日本の電話番号パターンで分割
      const d = unified.replace(/\D/g, '');
      if (/^0[5789]0/.test(d) && d.length === 11) return [d.slice(0, 3), d.slice(3, 7), d.slice(7)];
      if (/^0120/.test(d) && d.length === 10) return [d.slice(0, 4), d.slice(4, 7), d.slice(7)];
      if (/^0\d/.test(d) && d.length === 10) return [d.slice(0, 2), d.slice(2, 6), d.slice(6)];
      if (/^0\d/.test(d) && d.length === 11) return [d.slice(0, 3), d.slice(3, 7), d.slice(7)];
      return [unified, '', ''];
    }
    if (part1 || part2 || part3) return [part1 || '', part2 || '', part3 || ''];
    return null;
  }

  // 郵便番号を分割欄 or 一括欄に流す
  function fillPostal(curPostal, homePostal, curName1, curName2, homeName1, homeName2) {
    let n = 0;
    const fill = (postal, name1, name2) => {
      if (!postal) return;
      const digits = postal.replace(/[-\s　ー－]/g, '');
      const el1 = document.getElementsByName(name1)[0];
      const el2 = document.getElementsByName(name2)[0];
      if (el1 && el2) {
        // 分割欄: 日本の7桁なら3+4、それ以外は全部name1に入れる
        if (/^\d{7}$/.test(digits)) {
          if (setField(name1, digits.slice(0, 3))) n++;
          if (setField(name2, digits.slice(3))) n++;
        } else {
          if (setField(name1, postal)) n++;
        }
      } else if (el1) {
        // 一括欄（name1だけ存在）
        if (setField(name1, /^\d{7}$/.test(digits) ? digits : postal)) n++;
      }
    };
    fill(curPostal, curName1, curName2);
    fill(homePostal, homeName1, homeName2);
    return n;
  }

  // i-web 専用マッピング
  function autofillIweb(p) {
    const map = {
      kname1: p.lastNameKanji, kname2: p.firstNameKanji,
      yname1: p.lastNameKana, yname2: p.firstNameKana,
      ybirth: p.birthYear, mbirth: pad2(p.birthMonth), dbirth: pad2(p.birthDay),
      myIDdate: p.birthYear && p.birthMonth && p.birthDay
        ? `${p.birthYear}/${pad2(p.birthMonth)}/${pad2(p.birthDay)}` : undefined,
      syear: p.gradYear, smonth: pad2(p.gradMonth), shikbn: p.gradKbn,
      // 現住所（郵便番号は後で分割/一括判定して流す）
      gken: prefCode(p.curPref),
      gadrs1: p.curAddr1, gadrs2: p.curAddr2,
      gtel1: (splitPhone(p.curTel, p.curTel1, p.curTel2, p.curTel3) ?? [])[0],
      gtel2: (splitPhone(p.curTel, p.curTel1, p.curTel2, p.curTel3) ?? [])[1],
      gtel3: (splitPhone(p.curTel, p.curTel1, p.curTel2, p.curTel3) ?? [])[2],
      kttel1: (splitPhone(p.mobile, p.mobile1, p.mobile2, p.mobile3) ?? [])[0],
      kttel2: (splitPhone(p.mobile, p.mobile1, p.mobile2, p.mobile3) ?? [])[1],
      kttel3: (splitPhone(p.mobile, p.mobile1, p.mobile2, p.mobile3) ?? [])[2],
      bikoa: p.seminarLab, bikob: p.clubCircle,
    };
    // 帰省先: 「現住所と同じ」チェックボックス（adch）があればクリック、入力は省略
    const same = p.homeSameAsCurrent;
    const adchEl = document.querySelector('input[name="adch"]');
    if (same && adchEl && !adchEl.checked) {
      adchEl.click();
    }
    if (!same) {
      map.kken = prefCode(p.homePref);
      map.kadrs1 = p.homeAddr1;
      map.kadrs2 = p.homeAddr2;
      const ht = splitPhone(p.homeTel, p.homeTel1, p.homeTel2, p.homeTel3);
      if (ht) { map.ktel1 = ht[0]; map.ktel2 = ht[1]; map.ktel3 = ht[2]; }
    }
    // メール（本文 + 確認欄に同じ値）
    if (p.email) {
      const [a, d] = splitEmail(p.email);
      map.account1 = a; map.domain1 = d; map.account2 = a; map.domain2 = d;
    }
    if (p.email2) {
      const [a, d] = splitEmail(p.email2);
      map.account3 = a; map.domain3 = d; map.account4 = a; map.domain4 = d;
    }
    let n = 0;
    for (const [name, val] of Object.entries(map)) if (setField(name, val)) n++;

    // 郵便番号: 分割欄(name1+name2)があればそちらへ、なければ一括欄へ
    // 帰省先が「現住所と同じ」のときは adch チェックに任せるので帰省先郵便番号は省略
    n += fillPostal(p.curPostal, same ? null : p.homePostal,
                    'gyubin1', 'gyubin2', 'kyubin1', 'kyubin2');

    // 学校選択ウィザード（2〜5ページ目）。各ページに該当する group だけ反応する。
    // ラジオはラベル文字で選択するため、プロフィールは正式名称に合わせる必要がある。
    const radioGroups = [
      ['gkbn', p.schoolType],     // 学校区分
      ['dken', p.uniPref],        // 学校所在地（都道府県）
      ['daicd', p.university],    // 大学名
      ['gkbcd', p.faculty],       // 学部
      ['gkkcd', p.department],    // 学科
      ['s_brkbn', p.scienceType], // 文理
    ];
    for (const [name, val] of radioGroups) if (selectByLabel(name, val)) n++;

    // 五十音（gon）: 大学名ふりがなの先頭文字で選択
    if (p.universityKana) {
      const first = (p.universityKana || '').charAt(0);
      if (first && selectByLabel('gon', first)) n++;
    }

    // 性別: プロフィールの「男性」→フォーム上の「男」等の短縮にも対応
    if (p.gender) {
      const g = clean(p.gender);
      const gShort = g.replace(/性$/, '');
      const allRadios = [...document.querySelectorAll('input[type="radio"]')];
      const hit = allRadios.find((e) => {
        const l = clean(radioLabelText(e));
        return l === g || l === gShort;
      });
      if (hit) { hit.click(); n++; }
    }

    // 就業経験 (enq10 等): ラベル「有り」「無し」で選択
    if (p.workExperience) {
      const w = clean(p.workExperience);
      const allRadios = [...document.querySelectorAll('input[type="radio"]')];
      const hit = allRadios.find((e) => {
        const l = clean(radioLabelText(e));
        return l === w && /enq/.test(e.name);
      });
      if (hit) { hit.click(); n++; }
    }

    // 企業をまたいで繰り返し出る自由記述を、質問文のキーワードで補完する
    const knownNames = new Set(Object.keys(map));
    const combinedSchool = [p.university, p.faculty, p.department].filter(Boolean).join(' ');
    const textRules = [
      { re: /(出身)?高校(名|学校名)?|出身校/, val: p.highSchool },
      { re: /学校名.*学部|学部名.*学科/, val: combinedSchool || p.university },
      { re: /大学名|大学院名|学校名/, val: p.university },
      { re: /学部/, val: p.faculty },
      { re: /学科|専攻|コース/, val: p.department },
    ];
    const fire = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const el of document.querySelectorAll('input[type="text"], textarea')) {
      if (el.value || (el.name && knownNames.has(el.name))) continue;
      const q = clean(questionText(el));
      for (const r of textRules) {
        if (r.val && r.re.test(q)) {
          el.value = r.val;
          fire(el);
          n++;
          break;
        }
      }
    }

    // --- enq: 質問文ベースの汎用自動入力 ---
    n += fillEnqFields(p, knownNames);

    return n;
  }

  // enq フィールド (企業固有の質問票) を質問文から推定して自動入力
  function fillEnqFields(p, knownNames) {
    let n = 0;
    const fire = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // 学歴タイムライン計算
    const gradY = parseInt(p.gradYear) || 0;
    const isGrad = (p.schoolType || '').includes('大学院');
    const uniLen = isGrad ? 2 : (p.schoolType || '').includes('短期') ? 2 : 4;
    const uniEnterY = gradY > 0 ? gradY - uniLen : 0;
    const hsGradY = uniEnterY > 0 ? uniEnterY : 0;
    const hsEnterY = hsGradY > 0 ? hsGradY - 3 : 0;

    // 近辺のテキストからセクションのキーワードを取得
    function sectionContext(el) {
      const texts = [];
      const row = el.closest('tr, dd, li, div.form-group, fieldset');
      if (row) {
        texts.push(row.textContent);
        let prev = row.previousElementSibling;
        for (let i = 0; i < 5 && prev; i++) {
          texts.push(prev.textContent);
          prev = prev.previousElementSibling;
        }
      }
      const parent = row?.parentElement?.closest('table, fieldset, section, div');
      if (parent) {
        const h = parent.querySelector('h2, h3, h4, caption, legend, th[colspan]');
        if (h) texts.push(h.textContent);
      }
      return clean(texts.join(' '));
    }

    // 1. ラジオグループ (学校区分・学年)
    const radioMap = {};
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (!r.name || knownNames.has(r.name)) continue;
      (radioMap[r.name] = radioMap[r.name] || []).push(r);
    }
    for (const [, radios] of Object.entries(radioMap)) {
      if (radios.some((r) => r.checked)) continue;
      const q = sectionContext(radios[0]);

      if (p.schoolType && /学校|在学|課程|所属/.test(q)) {
        const target = isGrad ? '大学院' : '大学';
        const hit = radios.find((r) => clean(radioLabelText(r)) === target) ||
                    radios.find((r) => clean(radioLabelText(r)).includes(target));
        if (hit) { hit.click(); n++; continue; }
      }

      if (gradY > 0 && /学年|年次|年生/.test(q)) {
        const now = new Date();
        const acadY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        const yr = acadY - uniEnterY + 1;
        if (yr >= 1 && yr <= 6) {
          const hit = radios.find((r) => clean(radioLabelText(r)).startsWith(`${yr}年`));
          if (hit) { hit.click(); n++; continue; }
        }
      }
    }

    // 2. 日付セレクトグループ (name[0], name[1], ...)
    const selGroups = {};
    for (const sel of document.querySelectorAll('select')) {
      const m = sel.name.match(/^(.+)\[(\d+)\]$/);
      if (!m || knownNames.has(sel.name)) continue;
      if (!selGroups[m[1]]) selGroups[m[1]] = [];
      selGroups[m[1]].push({ idx: parseInt(m[2]), el: sel });
    }
    const filledGroups = new Set();
    for (const [groupName, items] of Object.entries(selGroups)) {
      items.sort((a, b) => a.idx - b.idx);
      if (items.some((i) => i.el.value && i.el.value !== '')) continue;
      if (items.length < 2) continue;

      const ctx = sectionContext(items[0].el);
      let vals = null;

      if (/高校|高等学校/.test(ctx) && hsEnterY > 0) {
        vals = [String(hsEnterY), '04', String(hsGradY), '03', '0'];
      } else if (/大学院/.test(ctx) && isGrad && uniEnterY > 0) {
        vals = [String(uniEnterY), '04', String(gradY), pad2(p.gradMonth) || '03', p.gradKbn || '1'];
      } else if ((/大学|学部|学校/.test(ctx) || /入学.*卒業/.test(ctx)) && uniEnterY > 0) {
        if (isGrad) {
          vals = [String(uniEnterY - 4), '04', String(uniEnterY), '03', '0'];
        } else {
          vals = [String(uniEnterY), '04', String(gradY), pad2(p.gradMonth) || '03', p.gradKbn || '1'];
        }
      }

      if (vals) {
        for (let i = 0; i < items.length && i < vals.length; i++) {
          if (vals[i] != null) {
            items[i].el.value = vals[i];
            fire(items[i].el);
            n++;
          }
        }
        filledGroups.add(groupName);
      }
    }

    // 3. 学歴日付の構造ベースフォールバック（コンテキストで判別できなかった場合）
    // セレクト数で分類: 4個=高校（入学年月〜卒業年月）、5個=大学以上（＋卒業区分）
    const uf4 = [], uf5 = [];
    for (const [gn, rawItems] of Object.entries(selGroups)) {
      if (filledGroups.has(gn)) continue;
      const sorted = [...rawItems].sort((a, b) => a.idx - b.idx);
      if (sorted.some((i) => i.el.value && i.el.value !== '')) continue;
      if (sorted.length === 4) uf4.push(sorted);
      else if (sorted.length >= 5) uf5.push(sorted);
    }
    const byDom = (a, b) =>
      (a[0].el.compareDocumentPosition(b[0].el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    uf4.sort(byDom);
    uf5.sort(byDom);

    const usedText = new Set();
    const fillGrp = (items, vals, schoolName) => {
      for (let i = 0; i < items.length && i < vals.length; i++) {
        items[i].el.value = vals[i]; fire(items[i].el); n++;
      }
      if (!schoolName) return;
      const all = [...document.querySelectorAll('input[type="text"], textarea')];
      for (let j = all.length - 1; j >= 0; j--) {
        const inp = all[j];
        if (usedText.has(inp) || inp.value || !/^enq/.test(inp.name)) continue;
        if (items[0].el.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_PRECEDING) {
          inp.value = schoolName; fire(inp); n++; usedText.add(inp); break;
        }
      }
    };

    if (uf4[0] && hsEnterY > 0)
      fillGrp(uf4[0], [String(hsEnterY), '04', String(hsGradY), '03'], p.highSchool);
    if (uf5.length > 0 && uniEnterY > 0) {
      if (isGrad && uf5.length >= 2) {
        fillGrp(uf5[0], [String(uniEnterY - 4), '04', String(uniEnterY), '03', '0'], p.university);
        fillGrp(uf5[1], [String(uniEnterY), '04', String(gradY), pad2(p.gradMonth) || '03', p.gradKbn || '1'], null);
      } else {
        fillGrp(uf5[0], [String(uniEnterY), '04', String(gradY), pad2(p.gradMonth) || '03', p.gradKbn || '1'], p.university);
      }
    }

    return n;
  }

  // kanji_sei / kana_sei 系フォーム（マイナビ等）の自動入力
  function autofillMynaviStyle(p) {
    let n = 0;
    const fire = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // select に値をセットし change を発火
    function setSelect(name, value) {
      if (value == null || value === '') return false;
      const el = document.querySelector(`select[name="${name}"]`);
      if (!el) return false;
      const v = String(value);
      for (const opt of el.options) {
        if (opt.value === v || opt.textContent.trim() === v) {
          el.value = opt.value;
          fire(el);
          return true;
        }
      }
      return false;
    }

    // テキスト入力
    const textMap = {
      kanji_sei: p.lastNameKanji,
      kanji_na: p.firstNameKanji,
      kana_sei: p.lastNameKana,
      kana_na: p.firstNameKana,
      roma_sei: p.lastNameRoman,
      roma_na: p.firstNameRoman,
      jushog1: p.curAddr1,
      jushog2: p.curAddr2,
      jushog3: p.curAddr3,
      email: p.email,
      email2: p.email,
      kmail: p.email2,
      kmail2: p.email2,
      zemi: p.seminarLab,
      club: p.clubCircle,
      dname: p.university,
      bname: p.faculty,
      kname: p.department,
      koko_name: p.highSchool,
    };
    for (const [name, val] of Object.entries(textMap)) if (setField(name, val)) n++;

    // 性別（ラジオ）
    if (p.gender) {
      if (selectByLabel('sex', p.gender)) n++;
    }

    // 生年月日（セレクト）
    if (setSelect('birth_Y', p.birthYear)) n++;
    if (setSelect('birth_m', pad2(p.birthMonth))) n++;
    if (setSelect('birth_d', pad2(p.birthDay))) n++;

    // 国外チェック
    if (p.isOverseas) {
      const kaigaiEl = document.querySelector('input[name="kaigaig"]');
      if (kaigaiEl && !kaigaiEl.checked) { kaigaiEl.click(); n++; }
    }

    // 郵便番号（現住所: yubing_h + yubing_l / 国外: yubing_kaigai）
    if (p.curPostal) {
      const digits = p.curPostal.replace(/[-\s　ー－]/g, '');
      if (!p.isOverseas && /^\d{7}$/.test(digits)) {
        if (setField('yubing_h', digits.slice(0, 3))) n++;
        if (setField('yubing_l', digits.slice(3))) n++;
      } else {
        if (setField('yubing_kaigai', p.curPostal)) n++;
      }
    }

    // 都道府県（現住所）
    if (p.curPref && !p.isOverseas) {
      const code = PREFS.indexOf(p.curPref.trim()) + 1;
      if (code > 0 && setSelect('keng', String(code))) n++;
    }

    // 電話番号（現住所: 国内3分割 / 国外1欄）
    const ct = splitPhone(p.curTel, p.curTel1, p.curTel2, p.curTel3);
    if (ct) {
      if (p.isOverseas) {
        if (setField('telg_kaigai', ct.join('-'))) n++;
      } else {
        if (setField('telg_h', ct[0])) n++;
        if (setField('telg_m', ct[1])) n++;
        if (setField('telg_l', ct[2])) n++;
      }
    }

    // 携帯（国内3分割 / 国外1欄）
    const mb = splitPhone(p.mobile, p.mobile1, p.mobile2, p.mobile3);
    if (mb) {
      if (p.isOverseas) {
        if (setField('keitai_kaigai', mb.join('-'))) n++;
      } else {
        if (setField('keitai_h', mb[0])) n++;
        if (setField('keitai_m', mb[1])) n++;
        if (setField('keitai_l', mb[2])) n++;
      }
    }

    // 帰省先: 「現住所と同じ」チェックボックス
    const same = p.homeSameAsCurrent;
    const sameEl = document.querySelector('input[name="jushosame"]');
    if (same && sameEl && !sameEl.checked) {
      sameEl.click();
      n++;
    }
    if (!same) {
      // 帰省先郵便番号
      if (p.homePostal) {
        const digits = p.homePostal.replace(/[-\s　ー－]/g, '');
        if (/^\d{7}$/.test(digits)) {
          if (setField('yubink_h', digits.slice(0, 3))) n++;
          if (setField('yubink_l', digits.slice(3))) n++;
        } else {
          if (setField('yubink_kaigai', p.homePostal)) n++;
        }
      }
      // 帰省先都道府県
      if (p.homePref) {
        const code = PREFS.indexOf(p.homePref.trim()) + 1;
        if (code > 0 && setSelect('kenk', String(code))) n++;
      }
      if (setField('jushok1', p.homeAddr1)) n++;
      if (setField('jushok2', p.homeAddr2)) n++;
      if (setField('jushok3', p.homeAddr3)) n++;
      const ht = splitPhone(p.homeTel, p.homeTel1, p.homeTel2, p.homeTel3);
      if (ht) {
        if (setField('telk_h', ht[0])) n++;
        if (setField('telk_m', ht[1])) n++;
        if (setField('telk_l', ht[2])) n++;
      }
    }

    // 学校区分（大学院 / 大学 / 短期大学 / 高等専門学校 / 専門学校）
    const isGrad = (p.schoolType || '').includes('大学院');
    if (p.schoolType) {
      const st = p.schoolType;
      const kubunLabel = isGrad ? '大学院'
        : st.includes('短期') ? '短期大学'
        : st.includes('高等専門') ? '高等専門学校'
        : st.includes('専門学校') ? '専門学校'
        : '大学';
      if (selectByLabel('kubun', kubunLabel)) n++;
    }

    // 修士/博士
    if (isGrad) {
      if ((p.schoolType || '').includes('博士')) {
        selectByLabel('degree', '博士') && n++;
      } else {
        selectByLabel('degree', '修士') && n++;
      }
    }

    // 国公私立
    if (p.uniType) {
      if (selectByLabel('kokushi', p.uniType)) n++;
    }

    // 学歴タイムライン
    const gradY = parseInt(p.gradYear) || 0;
    const uniLen = isGrad ? 2 : (p.schoolType || '').includes('短期') ? 2 : 4;
    const uniEnterY = gradY > 0 ? gradY - uniLen : 0;
    const hsGradY = uniEnterY > 0 ? uniEnterY : 0;
    const hsEnterY = hsGradY > 0 ? hsGradY - 3 : 0;

    // 大学入学〜卒業年月
    if (uniEnterY > 0) {
      if (setSelect('school_from_Y', String(uniEnterY))) n++;
      if (setSelect('school_from_m', '04')) n++;
    }
    if (gradY > 0) {
      if (setSelect('school_to_Y', String(gradY))) n++;
      if (setSelect('school_to_m', pad2(p.gradMonth) || '03')) n++;
    }

    // 高校所在地
    if (p.highSchoolPref) {
      const code = PREFS.indexOf(p.highSchoolPref.trim()) + 1;
      if (code > 0 && setSelect('koko_ken', String(code))) n++;
    }

    // 高校入学〜卒業年月
    if (hsEnterY > 0) {
      if (setSelect('koko_from_Y', String(hsEnterY))) n++;
      if (setSelect('koko_from_m', '04')) n++;
    }
    if (hsGradY > 0) {
      if (setSelect('koko_to_Y', String(hsGradY))) n++;
      if (setSelect('koko_to_m', '03')) n++;
    }

    // 学校名の頭文字（ひらがな→カタカナ変換して先頭1文字）
    if (p.universityKana) {
      const kata = p.universityKana.replace(/[ぁ-ゖ]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) + 0x60));
      const first = kata.charAt(0);
      if (first && setField('initial', first)) n++;
    }

    // 高校名の一部（検索キーワード: 「高等学校」「高校」を除いた短縮名で検索）
    if (p.highSchool) {
      const hsShort = p.highSchool.replace(/(高等学校|高校)$/, '').trim();
      if (hsShort && setField('koko_word', hsShort)) n++;
    }

    // memo フィールド（企業固有の追加質問）を質問文から推定入力
    n += fillMemoFieldsAxol(p, setSelect, isGrad, gradY, uniEnterY, hsEnterY, hsGradY);

    // 非同期: 学校検索→選択→学部→学科の連鎖
    asyncSchoolSearch(p);

    return n;
  }

  // axol 系 memo フィールドを質問文キーワードで推定入力
  function fillMemoFieldsAxol(p, setSelect, isGrad, gradY, uniEnterY, hsEnterY, hsGradY) {
    let n = 0;
    const fire = (el) => {
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    };

    // フィールドの質問文を取得
    function qText(el) {
      let q = el.placeholder || '';
      const row = el.closest('tr, div, td, dd, li, fieldset, section');
      if (row) q += ' ' + row.textContent;
      return q;
    }

    // --- テキスト/テキストエリア ---
    for (const el of document.querySelectorAll('input[type="text"][name^="memo"], textarea[name^="memo"]')) {
      if (el.value) continue;
      const q = qText(el);
      let val = null;
      if (/高校名|高校.*正式名称/.test(q)) val = p.highSchool;
      else if (/コース|課程/.test(q) && /高校/.test(q)) val = p.highSchoolCourse || '';
      else if (/ゼミ|研究室/.test(q) && !/教授|テーマ/.test(q)) val = p.seminarLab;
      else if (/教授|指導教員|担当/.test(q)) val = p.labProfessor;
      else if (/研究テーマ|研究内容|研究概要/.test(q)) val = p.researchTheme;
      else if (/GPA|成績/.test(q)) val = p.gpa;
      else if (/TOEIC|トーイック/.test(q) && !/TOEFL/.test(q)) val = p.toeicScore;
      else if (/TOEFL.*スコア|TOEFL.*点/.test(q)) val = p.toeflScore;
      else if (/TOEFL.*種類|TOEFL.*種別/.test(q)) val = p.toeflType;
      else if (/英語.*資格|英検|語学.*資格/.test(q)) val = p.englishQual;
      else if (/資格|免許/.test(q) && !/英語|語学|TOEIC|TOEFL/.test(q)) val = p.qualifications;
      else if (/クラブ|サークル|部活/.test(q)) val = p.clubCircle;
      if (val) { el.value = val; fire(el); n++; }
    }

    // --- 日付セレクト (memo*_Y / memo*_m) ---
    const dateGroups = {};
    for (const sel of document.querySelectorAll('select[name^="memo"]')) {
      const m = sel.name.match(/^(memo\d+)_(Y|m)$/);
      if (!m) continue;
      if (!dateGroups[m[1]]) dateGroups[m[1]] = {};
      dateGroups[m[1]][m[2]] = sel;
    }
    for (const [, sels] of Object.entries(dateGroups)) {
      if (!sels.Y || !sels.m) continue;
      if (sels.Y.value && sels.Y.value !== '' && sels.Y.value !== '--') continue;
      const q = qText(sels.Y);
      let year = null, month = null;
      if (/高校.*入学/.test(q) && hsEnterY > 0) { year = hsEnterY; month = '04'; }
      else if (/高校.*卒業/.test(q) && hsGradY > 0) { year = hsGradY; month = '03'; }
      else if (/①.*入学|①上記.*入学/.test(q) && isGrad && uniEnterY > 0) {
        year = uniEnterY - 4; month = '04';
      }
      else if (/①.*卒業|①上記.*卒業/.test(q) && isGrad && uniEnterY > 0) {
        year = uniEnterY; month = '03';
      }
      if (year != null) {
        sels.Y.value = String(year); fire(sels.Y);
        sels.m.value = String(parseInt(month)); fire(sels.m);
        n += 2;
      }
    }

    // --- ラジオ ---
    const memoRadioNames = new Set();
    for (const r of document.querySelectorAll('input[type="radio"][name^="memo"]')) {
      memoRadioNames.add(r.name);
    }
    for (const name of memoRadioNames) {
      const radios = [...document.querySelectorAll(`input[type="radio"][name="${name}"]`)];
      if (radios.some((r) => r.checked)) continue;
      const q = qText(radios[0]);
      let target = null;
      if (/学位/.test(q)) {
        target = isGrad ? ((p.schoolType || '').includes('博士') ? '博士' : '修士') : '学士';
      } else if (/就業経験|正規雇用/.test(q)) {
        if (p.workExperience === '有り') target = 'ある';
        else if (p.workExperience === '無し') target = 'ない';
      } else if (/中間.*学歴|高校卒業後.*卒業/.test(q)) {
        target = isGrad ? 'あり' : 'なし';
      }
      if (target) {
        const hit = radios.find((r) => clean(radioLabelText(r)).includes(clean(target)));
        if (hit) { hit.click(); n++; }
      }
    }

    return n;
  }

  async function asyncSchoolSearch(p) {
    let asyncN = 0;

    // --- 大学検索 ---
    const initialEl = document.querySelector('input[name="initial"]');
    if (initialEl && initialEl.value && p.university) {
      clickButtonNear('initial', '学校検索') || clickButtonNear('initial', '検索');
      await delay(500);
      if (await waitForOptions('dcd', 5000)) {
        if (selectOptionByText('dcd', p.university)) {
          asyncN++;
          await delay(300);
          if (p.faculty && await waitForOptions('bcd', 5000, true)) {
            if (selectOptionByText('bcd', p.faculty)) {
              asyncN++;
              await delay(300);
              if (p.department && await waitForOptions('paxcd', 5000, true)) {
                if (selectOptionByText('paxcd', p.department)) {
                  asyncN++;
                }
              }
            }
          }
        }
      }
    }

    // --- 高校検索（koko_word 方式） ---
    const kokoWordEl = document.querySelector('input[name="koko_word"]');
    if (kokoWordEl && kokoWordEl.value && p.highSchool) {
      clickButtonNear('koko_word', '高校検索') || clickButtonNear('koko_word', '検索');
      await delay(500);
      if (await waitForOptions('kokocd', 5000)) {
        if (selectOptionByText('kokocd', p.highSchool)) {
          asyncN++;
        }
      }
    }

    if (asyncN > 0) {
      toast(`追加で${asyncN}項目を自動選択しました`);
    }
  }

  const AUTOFILLERS = { 'i-web': autofillIweb, 'mynaviStyle': autofillMynaviStyle };

  // entry フォームか（自動入力ボタンを出すか）の判定
  function hasEntryForm() {
    // 基本情報ページ + 学校選択ウィザード + アンケートページのいずれか
    return !!document.querySelector(
      'input[name="kname1"], input[name="yname1"], input[name="gkbn"], input[name="dken"], ' +
      'input[name="daicd"], input[name="gkbcd"], input[name="gkkcd"], input[name="s_brkbn"], input[name^="enq"], ' +
      'input[name="kanji_sei"], input[name="kana_sei"]'
    );
  }

  // ---- ページ内ボタン注入 ----------------------------------------------
  function toast(text) {
    const t = document.createElement('div');
    t.textContent = text;
    t.style.cssText =
      'position:fixed;bottom:90px;right:24px;z-index:2147483647;background:#223049;color:#fff;' +
      'padding:10px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.3);' +
      'font-family:-apple-system,sans-serif;opacity:0;transition:opacity .2s;';
    document.body.appendChild(t);
    requestAnimationFrame(() => (t.style.opacity = '1'));
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
  }

  const FAB_ICONS = {
    zap: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    calendar: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>',
  };
  function makeFab(iconName, label, bg, onClick) {
    const b = document.createElement('button');
    b.innerHTML = `${FAB_ICONS[iconName] || ''}<span>${label}</span>`;
    b.style.cssText =
      `display:flex;align-items:center;gap:8px;margin-top:10px;background:${bg};color:#fff;border:none;border-radius:24px;` +
      'padding:11px 20px;font-size:14px;font-weight:500;cursor:pointer;box-shadow:0 4px 14px rgba(34,48,73,.28);' +
      'font-family:-apple-system,sans-serif;';
    b.onclick = onClick;
    return b;
  }

  async function injectButtons(rule) {
    if (document.getElementById('amp-fab')) return;
    const settings = await new Promise((r) =>
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (res) => r((res && res.settings) || {}))
    );

    const box = document.createElement('div');
    box.id = 'amp-fab';
    box.style.cssText =
      'position:fixed;bottom:24px;right:24px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;';

    // 自動入力（entry フォームがあり、対応サイトで、設定ONのとき）
    if (settings.showAutofillButton !== false && AUTOFILLERS[rule.name] && hasEntryForm()) {
      box.appendChild(
        makeFab('zap', '自動入力', '#223049', async () => {
          const profile = await new Promise((r) =>
            chrome.runtime.sendMessage({ type: 'GET_PROFILE' }, (res) => r((res && res.profile) || {}))
          );
          if (!profile || !Object.keys(profile).length) {
            toast('プロフィール未登録です。拡張機能の「情報入力・設定」で登録してください');
            return;
          }
          const n = AUTOFILLERS[rule.name](profile);
          toast(`${n}項目を自動入力しました`);
        })
      );
    }

    // 締切抽出（選択式ピッカー）
    box.appendChild(
      makeFab('calendar', '締切抽出', '#c76b4a', () => {
        const deadlines = extractDeadlines();
        if (!deadlines.length) {
          toast('締切は見つかりませんでした');
          return;
        }
        showDeadlinePicker(deadlines);
      })
    );

    document.body.appendChild(box);
  }

  // 締切選択ピッカー
  function showDeadlinePicker(deadlines) {
    const existing = document.getElementById('amp-dl-picker');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'amp-dl-picker';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.4);' +
      'display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;';

    const card = document.createElement('div');
    card.style.cssText =
      'background:#fff;border-radius:14px;padding:20px 24px;max-width:380px;width:90%;' +
      'box-shadow:0 12px 40px rgba(0,0,0,.25);max-height:70vh;display:flex;flex-direction:column;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:14px;color:#23262b;';
    title.textContent = `締切を選択（${deadlines.length}件）`;
    card.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;';
    for (let i = 0; i < deadlines.length; i++) {
      const d = deadlines[i];
      const row = document.createElement('label');
      row.style.cssText =
        'display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #eee;cursor:pointer;font-size:14px;color:#23262b;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.dataset.dlIdx = i;
      cb.style.cssText = 'width:18px;height:18px;accent-color:#c76b4a;';
      row.appendChild(cb);

      const label = document.createElement('span');
      label.style.flex = '1';
      const bold = document.createElement('b');
      bold.textContent = d.label || d.type || '締切';
      label.appendChild(bold);
      row.appendChild(label);

      const date = document.createElement('span');
      date.style.cssText = 'color:#6e7178;font-size:13px;';
      date.textContent = d.date;
      row.appendChild(date);
      list.appendChild(row);
    }
    card.appendChild(list);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:14px;';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '保存';
    saveBtn.style.cssText =
      'flex:1;padding:10px;background:#c76b4a;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.style.cssText =
      'flex:1;padding:10px;background:#f4f3f0;color:#23262b;border:1px solid #e5e2dc;border-radius:8px;font-size:14px;cursor:pointer;';

    saveBtn.onclick = () => {
      const selected = [];
      for (const cb of overlay.querySelectorAll('input[type="checkbox"]:checked')) {
        selected.push(deadlines[parseInt(cb.dataset.dlIdx)]);
      }
      const payload = buildPayload(null);
      payload.deadlines = selected;
      chrome.runtime.sendMessage({ type: 'CAPTURE', payload });
      overlay.remove();
      toast(selected.length ? `締切${selected.length}件を保存しました` : 'ページ情報のみ保存しました');
    };
    cancelBtn.onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ログインフォームへ資格情報を流し込む（ホームの「ログイン」起点）
  function fillLoginForm(creds) {
    if (!creds) return false;
    const rule = activeRule();
    const pw =
      (rule && document.querySelector(rule.pwSelector)) ||
      document.querySelector('input[type="password"]');
    if (!pw) return false;
    let idInput = rule && document.querySelector(rule.idSelector);
    if (!idInput) {
      const inputs = [...document.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], input:not([type])'
      )];
      for (const inp of inputs) {
        if (pw.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_PRECEDING) idInput = inp;
      }
    }
    const fire = (el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (idInput && creds.loginId) { idInput.value = creds.loginId; fire(idInput); }
    if (creds.password) { pw.value = creds.password; fire(pw); }
    return true;
  }

  // 対応サイトならボタンを出す
  const rule = activeRule();
  if (rule) {
    if (document.body) injectButtons(rule);
    else window.addEventListener('DOMContentLoaded', () => injectButtons(rule));

    // ホームから「ログイン」で開かれた場合のみ、ID/PW を自動入力（自動送信はしない）
    chrome.runtime.sendMessage({ type: 'CONSUME_LOGIN', host: siteKey() }, (res) => {
      if (res && res.creds) fillLoginForm(res.creds);
    });
  }
})();
