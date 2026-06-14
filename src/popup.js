// ツールバーのポップアップ。素早い起動に特化（編集・全管理はダッシュボード）。
import { stageLabel } from './lib/stages.js';
import { icon, applyIcons } from './lib/icons.js';
import { daysUntil, faviconUrl, whenColor, whenText, siteKeyFromUrl } from './lib/utils.js';

const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

let entries = [];
let activeTab = null;
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  if (text) setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, 3500);
}

async function sendToActiveTab(msg) {
  if (!activeTab?.id) throw new Error('no active tab');
  try {
    return await chrome.tabs.sendMessage(activeTab.id, msg);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      files: ['src/content.js'],
    });
    return chrome.tabs.sendMessage(activeTab.id, msg);
  }
}

async function openLogin(e) {
  if (!e.mypageUrl) return;
  await send({ type: 'PENDING_LOGIN', host: e.host });
  chrome.tabs.create({ url: e.mypageUrl });
  window.close();
}

function logoEl(e) {
  const fav = faviconUrl(e.mypageUrl);
  if (fav) {
    const img = document.createElement('img');
    img.className = 'logo'; img.src = fav; img.alt = '';
    return img;
  }
  const d = document.createElement('div');
  d.className = 'logo';
  d.style.cssText = 'background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:11px';
  d.textContent = (e.companyName || e.host || '?').charAt(0);
  return d;
}

// ---- 現在のページ ----
function renderCurrent() {
  const key = siteKeyFromUrl(activeTab?.url || '');
  const cur = entries.find((e) => e.host === key);
  const sec = $('#current');
  if (!cur) { sec.classList.add('hidden'); return; }
  sec.classList.remove('hidden');
  $('#cur-name').textContent = cur.companyName || cur.host;
  $('#cur-stage').textContent = stageLabel(cur.stage || '気になる');
  $('#cur-login').onclick = () => openLogin(cur);
  $('#cur-id').onclick = async () => { await navigator.clipboard.writeText(cur.loginId || ''); setStatus('IDをコピーしました', 'ok'); };
  $('#cur-pw').onclick = async () => { await navigator.clipboard.writeText(cur.password || ''); setStatus('パスワードをコピーしました', 'ok'); };
  $('#cur-capture').onclick = captureCurrent;
}

// ---- 締切が近い（done/delete 対応） ----
function renderDeadlines() {
  const rows = [];
  for (const e of entries) {
    for (const d of e.deadlines || []) {
      rows.push({
        e,
        type: d.label || d.type || '締切',
        n: daysUntil(d.date),
        date: d.date,
        done: !!d.done,
        entryId: e.id,
        dlType: d.type || '',
      });
    }
  }
  // 未完了で14日以内のものを表示（完了済は除外）
  const near = rows
    .filter((r) => !r.done && r.n !== null && r.n >= 0 && r.n <= 14)
    .sort((a, b) => a.n - b.n)
    .slice(0, 5);
  const box = $('#pop-deadlines');
  box.innerHTML = '';
  if (!near.length) { box.innerHTML = '<div class="empty">直近の締切はありません</div>'; return; }
  for (const r of near) {
    const row = document.createElement('div');
    row.className = 'row';

    // dot
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = whenColor(r.n);
    row.appendChild(dot);

    // body
    const body = document.createElement('div');
    body.className = 'body';
    const rName = document.createElement('div');
    rName.className = 'r-name';
    rName.textContent = r.e.companyName || r.e.host;
    body.appendChild(rName);
    const rSub = document.createElement('div');
    rSub.className = 'r-sub';
    rSub.textContent = `${r.type}・${r.date}`;
    body.appendChild(rSub);
    row.appendChild(body);

    // when
    const w = document.createElement('span');
    w.className = 'r-when';
    w.textContent = whenText(r.n);
    w.style.color = whenColor(r.n);
    row.appendChild(w);

    // action buttons
    const acts = document.createElement('div');
    acts.className = 'dl-acts';

    const doneBtn = document.createElement('button');
    doneBtn.className = 'dl-act';
    doneBtn.title = '完了';
    doneBtn.innerHTML = icon('done', 13);
    doneBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await send({ type: 'TOGGLE_DEADLINE', entryId: r.entryId, date: r.date, dlType: r.dlType });
      await refresh();
      setStatus('完了にしました', 'ok');
    };
    acts.appendChild(doneBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'dl-act del';
    delBtn.title = '削除';
    delBtn.innerHTML = icon('trash', 13);
    delBtn.onclick = async (ev) => {
      ev.stopPropagation();
      await send({ type: 'REMOVE_DEADLINE', entryId: r.entryId, date: r.date, dlType: r.dlType });
      await refresh();
      setStatus('締切を削除しました', 'ok');
    };
    acts.appendChild(delBtn);

    row.appendChild(acts);

    const goBtn = document.createElement('button');
    goBtn.className = 'go';
    goBtn.innerHTML = `${icon('external', 13)}`;
    goBtn.onclick = () => openLogin(r.e);
    row.appendChild(goBtn);

    box.appendChild(row);
  }
}

// ---- クイックログイン ----
function renderQuick() {
  const quick = [...entries].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 5);
  const box = $('#pop-quick');
  box.innerHTML = '';
  if (!quick.length) { box.innerHTML = '<div class="empty">対象サイトでログインすると自動で登録されます</div>'; return; }
  for (const e of quick) {
    const row = document.createElement('div');
    row.className = 'row';
    row.appendChild(logoEl(e));
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = `<div class="r-name"></div>`;
    body.querySelector('.r-name').textContent = e.companyName || e.host;
    row.appendChild(body);
    const btn = document.createElement('button');
    btn.className = 'go'; btn.innerHTML = `${icon('login', 13)}ログイン`;
    btn.onclick = () => openLogin(e);
    row.appendChild(btn);
    box.appendChild(row);
  }
}

// ---- 締切抽出ピッカー ----
function showDeadlinePicker(deadlines, payload) {
  const existing = document.querySelector('.dl-picker');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'dl-picker';

  const card = document.createElement('div');
  card.className = 'dl-picker-card';

  if (!deadlines.length) {
    card.innerHTML = '<h4>締切を抽出</h4><div class="dl-empty-msg">このページから締切は見つかりませんでした</div>';
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '閉じる';
    closeBtn.className = 'cancel';
    closeBtn.style.cssText = 'margin-top:10px;width:100%;padding:8px;border-radius:8px;cursor:pointer;background:var(--surface-2);border:1px solid var(--line);';
    closeBtn.onclick = () => overlay.remove();
    card.appendChild(closeBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return;
  }

  const h4 = document.createElement('h4');
  h4.textContent = `締切を抽出（${deadlines.length}件）`;
  card.appendChild(h4);

  const list = document.createElement('div');
  list.className = 'dl-picker-list';
  for (let i = 0; i < deadlines.length; i++) {
    const d = deadlines[i];
    const row = document.createElement('label');
    row.className = 'dl-picker-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.dataset.idx = i;
    row.appendChild(cb);
    const lbl = document.createElement('span');
    lbl.className = 'lbl'; lbl.textContent = d.label || d.type || '締切';
    row.appendChild(lbl);
    const dt = document.createElement('span');
    dt.className = 'dt'; dt.textContent = d.date;
    row.appendChild(dt);
    list.appendChild(row);
  }
  card.appendChild(list);

  const acts = document.createElement('div');
  acts.className = 'dl-picker-acts';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'save'; saveBtn.textContent = '保存';
  saveBtn.onclick = async () => {
    const selected = [];
    for (const cb of card.querySelectorAll('input[type="checkbox"]:checked')) {
      selected.push(deadlines[parseInt(cb.dataset.idx)]);
    }
    payload.deadlines = selected;
    await send({ type: 'CAPTURE', payload });
    overlay.remove();
    await refresh();
    setStatus(selected.length ? `締切${selected.length}件を保存しました` : 'ページ情報のみ保存しました', 'ok');
  };
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel'; cancelBtn.textContent = 'キャンセル';
  cancelBtn.onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  acts.appendChild(saveBtn);
  acts.appendChild(cancelBtn);
  card.appendChild(acts);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

async function extractDeadlines() {
  if (!activeTab?.id) return setStatus('タブが取得できません', 'err');
  let resp;
  try { resp = await sendToActiveTab({ type: 'CAPTURE_NOW' }); }
  catch { return setStatus('このページからは抽出できません', 'err'); }
  if (!resp?.payload) return setStatus('抽出に失敗しました', 'err');
  showDeadlinePicker(resp.payload.deadlines || [], resp.payload);
}

async function captureCurrent() {
  if (!activeTab?.id) return;
  let resp;
  try { resp = await sendToActiveTab({ type: 'CAPTURE_NOW' }); }
  catch { return setStatus('このページからは取り込めません', 'err'); }
  if (!resp?.payload) return setStatus('取り込みに失敗しました', 'err');
  const res = await send({ type: 'CAPTURE', payload: resp.payload });
  await refresh();
  const base = res.isNew ? '新規に保存しました' : '更新しました';
  const syncNote = res.sync?.ok && !res.sync?.skipped ? '（同期済）' : '';
  setStatus(base + syncNote, 'ok');
}

async function refresh() {
  const r = await send({ type: 'LIST' });
  entries = r.entries || [];
  renderCurrent();
  renderDeadlines();
  renderQuick();
}

// ---- イベント ----
$('#sync').onclick = async () => {
  setStatus('同期中…');
  const res = await send({ type: 'SYNC_ALL' });
  if (!res || !res.sync) {
    setStatus('同期に失敗しました（応答なし）', 'err');
  } else if (res.sync.skipped) {
    setStatus('自動同期はOFFです', '');
  } else if (res.sync.ok) {
    setStatus(`同期しました（${res.sync.count}件）`, 'ok');
  } else if ((res.sync.error || '').includes('未設定')) {
    setStatus('GAS URLが未設定です（設定画面へ）', 'err');
  } else if ((res.sync.error || '').includes('unauthorized')) {
    setStatus('トークンが一致しません', 'err');
  } else {
    setStatus(`同期失敗: ${res.sync.error || '不明なエラー'}`, 'err');
  }
};
$('#autofill').onclick = async () => {
  if (!activeTab?.id) return setStatus('タブが取得できません', 'err');
  const profileRes = await send({ type: 'GET_PROFILE' });
  const profile = profileRes?.profile;
  if (!profile || !Object.keys(profile).length) {
    setStatus('プロフィール未登録です', 'err');
    chrome.tabs.create({ url: chrome.runtime.getURL('src/profile.html') });
    window.close();
    return;
  }
  let resp;
  try { resp = await sendToActiveTab({ type: 'AUTOFILL_NOW', profile }); }
  catch { return setStatus('このページでは自動入力できません', 'err'); }
  if (!resp?.ok) {
    if (resp?.error === 'no_form') setStatus('入力フォームが見つかりません', 'err');
    else setStatus('このサイトは未対応です', 'err');
    return;
  }
  setStatus(`${resp.filled}項目を自動入力しました`, 'ok');
};
$('#extract-dl').onclick = extractDeadlines;
$('#settings').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/profile.html') }); window.close(); };
$('#dashboard').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') }); window.close(); };
$('#capture').onclick = captureCurrent;

(async () => {
  applyIcons(document);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refresh();
})();
