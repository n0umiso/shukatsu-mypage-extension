// 管理画面のロジック。すべての更新は background 経由で行う。

import { ALL_STATES } from './lib/stages.js';

const INDUSTRIES = [
  '業界未設定', 'メーカー', '商社', '金融', 'コンサル', 'IT・通信',
  'インフラ・エネルギー', '広告・マスコミ', '不動産・建設', '人材・サービス', '小売・消費財', 'その他',
];

const $ = (sel) => document.querySelector(sel);
const listEl = $('#list');
const statusEl = $('#status');
const editorEl = $('#editor');
let editingId = null;

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
  if (text) setTimeout(() => { if (statusEl.textContent === text) statusEl.textContent = ''; }, 4000);
}

function daysUntil(dateStr) {
  const d = new Date(dateStr.replace(/\//g, '-'));
  if (isNaN(d)) return null;
  return Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

function deadlinesToText(deadlines = []) {
  return deadlines.map((d) => (d.type ? `${d.type}:${d.date}` : d.date)).join('\n');
}

function textToDeadlines(text) {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.lastIndexOf(':');
      if (i > 0) return { type: l.slice(0, i).trim(), date: l.slice(i + 1).trim() };
      return { type: '', date: l };
    });
}

function render(entries) {
  listEl.innerHTML = '';
  if (!entries.length) {
    listEl.innerHTML = '<li class="empty">まだ登録がありません。<br>マイページにログインするか「＋ 今のページ」で追加できます。</li>';
    return;
  }
  for (const e of entries) {
    const li = document.createElement('li');
    li.className = 'item';
    const dls = (e.deadlines || [])
      .map((d) => {
        const n = daysUntil(d.date);
        const soon = n !== null && n <= 7 ? ' soon' : '';
        const left = n !== null && n >= 0 ? `（あと${n}日）` : '';
        return `<span class="dl${soon}">${d.type ? d.type + ' ' : ''}${d.date}${left}</span>`;
      })
      .join('');
    li.innerHTML = `
      <div class="item-head">
        <span class="item-name"></span>
        <span class="item-status">${e.stage || ''}</span>
      </div>
      <div class="item-sub"></div>
      <div class="item-deadlines">${dls}</div>
      <div class="item-actions">
        <button class="open">開く</button>
        <button class="copy" data-v="id">ID</button>
        <button class="copy" data-v="pw">PW</button>
        <button class="edit">編集</button>
        <button class="del">削除</button>
      </div>`;
    li.querySelector('.item-name').textContent = e.companyName || e.host || '(無題)';
    li.querySelector('.item-sub').textContent = e.loginId ? `ID: ${e.loginId}` : e.mypageUrl;
    li.querySelector('.open').onclick = () => e.mypageUrl && chrome.tabs.create({ url: e.mypageUrl });
    li.querySelector('.edit').onclick = () => openEditor(e);
    li.querySelector('.del').onclick = () => removeEntry(e);
    li.querySelectorAll('.copy').forEach((btn) => {
      btn.onclick = async () => {
        const val = btn.dataset.v === 'id' ? e.loginId : e.password;
        await navigator.clipboard.writeText(val || '');
        setStatus(`${btn.dataset.v === 'id' ? 'ID' : 'パスワード'}をコピーしました`, 'ok');
      };
    });
    listEl.appendChild(li);
  }
}

async function refresh() {
  const res = await send({ type: 'LIST' });
  render(res.entries || []);
}

function fillSelect(sel, values, value, fallback) {
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if ((value || fallback) === v) o.selected = true;
    sel.appendChild(o);
  }
}
function fillIndustrySelect(value) {
  fillSelect($('#f-industry'), INDUSTRIES, value, '業界未設定');
}

function openEditor(entry) {
  editingId = entry ? entry.id : null;
  $('#editor-title').textContent = entry ? '編集' : '新規追加';
  $('#f-company').value = entry?.companyName || '';
  fillIndustrySelect(entry?.industry);
  $('#f-url').value = entry?.mypageUrl || '';
  $('#f-id').value = entry?.loginId || '';
  $('#f-pw').value = entry?.password || '';
  $('#f-pw').type = 'password';
  $('#f-deadlines').value = deadlinesToText(entry?.deadlines);
  fillSelect($('#f-stage'), ALL_STATES, entry?.stage, '気になる');
  $('#f-memo').value = entry?.memo || '';
  editorEl._host = entry?.host || '';
  editorEl.classList.remove('hidden');
}

function closeEditor() {
  editorEl.classList.add('hidden');
  editingId = null;
}

async function saveEditor() {
  const entry = {
    id: editingId || undefined,
    host: editorEl._host || (() => { try { return new URL($('#f-url').value).hostname; } catch { return ''; } })(),
    companyName: $('#f-company').value.trim(),
    industry: $('#f-industry').value,
    mypageUrl: $('#f-url').value.trim(),
    loginId: $('#f-id').value.trim(),
    password: $('#f-pw').value,
    deadlines: textToDeadlines($('#f-deadlines').value),
    stage: $('#f-stage').value,
    memo: $('#f-memo').value.trim(),
  };
  const res = await send({ type: 'UPSERT', entry });
  closeEditor();
  await refresh();
  reportSync(res.sync, '保存しました');
}

async function removeEntry(e) {
  if (!confirm(`「${e.companyName || e.host}」を削除しますか?`)) return;
  const res = await send({ type: 'DELETE', id: e.id });
  await refresh();
  reportSync(res.sync, '削除しました');
}

function reportSync(sync, base) {
  if (!sync || sync.skipped) return setStatus(base, 'ok');
  if (sync.ok) setStatus(`${base}（スプレッドシート同期済）`, 'ok');
  else setStatus(`${base} ／ 同期失敗: ${sync.error}`, 'err');
}

async function captureCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_NOW' });
  } catch {
    return setStatus('このページからは取り込めません（対応ページで開いてください）', 'err');
  }
  if (!resp?.payload) return setStatus('取り込みに失敗しました', 'err');
  const res = await send({ type: 'CAPTURE', payload: resp.payload });
  await refresh();
  reportSync(res.sync, res.isNew ? '新規に取り込みました' : '更新しました');
}

// ---- イベント ----
$('#capture').onclick = captureCurrent;
$('#dashboard').onclick = () =>
  chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard.html') });
$('#sync').onclick = async () => {
  setStatus('同期中…');
  const res = await send({ type: 'SYNC_ALL' });
  if (res.sync?.ok) setStatus(`同期しました（${res.sync.count}件）`, 'ok');
  else setStatus(`同期失敗: ${res.sync?.error}`, 'err');
};
$('#opts').onclick = () => chrome.runtime.openOptionsPage();
$('#save').onclick = saveEditor;
$('#cancel').onclick = closeEditor;
$('#pw-toggle').onclick = () => {
  const f = $('#f-pw');
  f.type = f.type === 'password' ? 'text' : 'password';
};

refresh();
