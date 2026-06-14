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

// ---- 締切が近い ----
function renderDeadlines() {
  const rows = [];
  for (const e of entries) for (const d of e.deadlines || []) rows.push({ e, type: d.type || '締切', n: daysUntil(d.date), date: d.date });
  const near = rows.filter((r) => r.n !== null && r.n >= 0 && r.n <= 14).sort((a, b) => a.n - b.n).slice(0, 3);
  const box = $('#pop-deadlines');
  box.innerHTML = '';
  if (!near.length) { box.innerHTML = '<div class="empty">直近の締切はありません</div>'; return; }
  for (const r of near) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="dot"></span><div class="body"><div class="r-name"></div><div class="r-sub"></div></div><span class="r-when"></span><button class="go">${icon('external', 13)}開く</button>`;
    row.querySelector('.dot').style.background = whenColor(r.n);
    row.querySelector('.r-name').textContent = r.e.companyName || r.e.host;
    row.querySelector('.r-sub').textContent = `${r.type}・${r.date}`;
    const w = row.querySelector('.r-when'); w.textContent = whenText(r.n); w.style.color = whenColor(r.n);
    row.querySelector('.go').onclick = () => openLogin(r.e);
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

async function captureCurrent() {
  if (!activeTab?.id) return;
  let resp;
  try { resp = await chrome.tabs.sendMessage(activeTab.id, { type: 'CAPTURE_NOW' }); }
  catch { return setStatus('このページからは取り込めません', 'err'); }
  if (!resp?.payload) return setStatus('取り込みに失敗しました', 'err');
  const res = await send({ type: 'CAPTURE', payload: resp.payload });
  await refresh();
  setStatus(res.isNew ? '新規に保存しました' : '更新しました', 'ok');
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
  if (res.sync?.ok) setStatus(`同期しました（${res.sync.count}件）`, 'ok');
  else setStatus(`同期失敗: ${res.sync?.error || ''}`, 'err');
};
$('#settings').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/profile.html') }); window.close(); };
$('#dashboard').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') }); window.close(); };
$('#capture').onclick = captureCurrent;

(async () => {
  applyIcons(document);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refresh();
})();
