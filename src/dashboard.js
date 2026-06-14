// 全画面ダッシュボード。ホーム / マイページ / 選考管理 / 締切 / 設定。
import { STAGES, ALL_STATES, stageProgress, stageLabel, isActive, isOutcome } from './lib/stages.js';
import { icon, applyIcons } from './lib/icons.js';

const INDUSTRIES = [
  '業界未設定', 'メーカー', '商社', '金融', 'コンサル', 'IT・通信',
  'インフラ・エネルギー', '広告・マスコミ', '不動産・建設', '人材・サービス', '小売・消費財', 'その他',
];

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
let all = [];
let profile = {};
let editingId = null;
let editingHost = '';
let senkoMode = 'progress';

const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

// ---- ユーティリティ ----
function daysUntil(dateStr) {
  const d = new Date(String(dateStr).replace(/\//g, '-'));
  if (isNaN(d)) return null;
  return Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
}
function faviconUrl(url) {
  try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`; }
  catch { return ''; }
}
const AVATAR_COLORS = ['#223049', '#c76b4a', '#5a6b7b', '#6e7c5e', '#8a6d5a', '#4e6374', '#7a5c6e'];
function avatarColor(name) {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function deadlinesToText(dls = []) {
  return dls.map((d) => (d.type ? `${d.type}:${d.date}` : d.date)).join('\n');
}
function textToDeadlines(text) {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.lastIndexOf(':');
    return i > 0 ? { type: l.slice(0, i).trim(), date: l.slice(i + 1).trim() } : { type: '', date: l };
  });
}
const stageOf = (e) => e.stage || '気になる';
function nearestUpcoming(entry) {
  const ds = (entry.deadlines || []).map((d) => ({ ...d, n: daysUntil(d.date) })).filter((d) => d.n !== null);
  const up = ds.filter((d) => d.n >= 0).sort((a, b) => a.n - b.n);
  return up[0] || ds.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}
function whenClass(n) {
  if (n === null) return 'muted';
  if (n <= 2) return 'danger';
  if (n <= 7) return 'warn';
  return 'muted';
}
function whenColor(n) {
  if (n === null) return '#9ca3af';
  if (n <= 2) return '#dc2626';
  if (n <= 7) return '#b45309';
  return '#223049';
}
function whenText(n) {
  if (n === null) return '';
  return n < 0 ? '終了' : n === 0 ? '今日' : `あと${n}日`;
}

// ---- ログイン（開く＋自動入力の予約） ----
async function openLogin(e) {
  if (!e.mypageUrl) return;
  await send({ type: 'PENDING_LOGIN', host: e.host });
  chrome.tabs.create({ url: e.mypageUrl });
}

// ---- ロゴ ----
function makeLogo(entry, cls = 'logo') {
  const name = entry.companyName || entry.host || '?';
  const fallback = document.createElement('div');
  fallback.className = `${cls} logo-fallback`;
  fallback.style.background = avatarColor(name);
  fallback.textContent = (name.trim().charAt(0) || '?');
  const fav = faviconUrl(entry.mypageUrl);
  if (!fav) return fallback;
  const img = document.createElement('img');
  img.className = cls;
  img.src = fav; img.alt = '';
  img.onerror = () => img.replaceWith(fallback);
  return img;
}

// =====================================================================
//  ホーム
// =====================================================================
function renderHome() {
  const name = profile.lastNameKanji ? `${profile.lastNameKanji}さん` : 'ようこそ';
  $('#greeting').textContent = `こんにちは、${name}`;
  $('#today').textContent = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const rows = [];
  for (const e of all) for (const d of e.deadlines || []) rows.push({ e, type: d.type || '締切', n: daysUntil(d.date), date: d.date });
  const week = rows.filter((r) => r.n !== null && r.n >= 0 && r.n <= 7).length;

  $('#m-total').textContent = all.length;
  $('#m-active').textContent = all.filter((e) => isActive(stageOf(e))).length;
  $('#m-week').textContent = week;

  // 締切が近い（14日以内 / 未来 / 近い順）
  const near = rows.filter((r) => r.n !== null && r.n >= 0 && r.n <= 14).sort((a, b) => a.n - b.n).slice(0, 6);
  const dl = $('#home-deadlines');
  dl.innerHTML = '';
  if (!near.length) dl.innerHTML = '<div class="home-empty">直近2週間の締切はありません。</div>';
  for (const r of near) {
    const row = document.createElement('div');
    row.className = 'home-row';
    row.innerHTML = `<span class="dot"></span><div class="body"><div class="r-name"></div><div class="r-sub"></div></div><span class="r-when"></span><button>${icon('external', 14)}開く</button>`;
    row.querySelector('.dot').style.background = whenColor(r.n);
    row.querySelector('.r-name').textContent = r.e.companyName || r.e.host;
    row.querySelector('.r-sub').textContent = `${r.type}・${r.date}`;
    const w = row.querySelector('.r-when'); w.textContent = whenText(r.n); w.style.color = whenColor(r.n);
    row.querySelector('button').onclick = () => openLogin(r.e);
    dl.appendChild(row);
  }

  // クイックログイン（更新が新しい順）
  const quick = [...all].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 6);
  const q = $('#home-quick');
  q.innerHTML = '';
  if (!quick.length) q.innerHTML = '<div class="home-empty">まだ登録がありません。</div>';
  for (const e of quick) {
    const row = document.createElement('div');
    row.className = 'home-row';
    row.appendChild(makeLogo(e));
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = `<div class="r-name"></div><div class="r-sub"></div>`;
    body.querySelector('.r-name').textContent = e.companyName || e.host;
    body.querySelector('.r-sub').textContent = stageLabel(stageOf(e));
    row.appendChild(body);
    const btn = document.createElement('button');
    btn.innerHTML = `${icon('login', 14)}ログイン`;
    btn.onclick = () => openLogin(e);
    row.appendChild(btn);
    q.appendChild(row);
  }
}

// =====================================================================
//  選考管理
// =====================================================================
function nextActionEl(e) {
  const nd = nearestUpcoming(e);
  const el = document.createElement('div');
  if (nd) {
    el.className = `s-next ${whenClass(nd.n)}`;
    el.textContent = `${nd.type || '締切'} ${whenText(nd.n)}`;
  } else {
    el.className = 's-next muted';
    el.textContent = stageOf(e) === '内定' ? '結果待ち' : '次の予定なし';
  }
  return el;
}

function renderSenko() {
  $('#stage-flow').textContent = STAGES.join(' › ');
  const list = $('#senko-list');
  const kanban = $('#senko-kanban');
  list.classList.toggle('hidden', senkoMode !== 'progress');
  kanban.classList.toggle('hidden', senkoMode !== 'board');
  $('#senko-progress').classList.toggle('active', senkoMode === 'progress');
  $('#senko-board').classList.toggle('active', senkoMode === 'board');

  if (senkoMode === 'progress') {
    const sorted = [...all].sort((a, b) => STAGES.indexOf(stageOf(b)) - STAGES.indexOf(stageOf(a)));
    list.innerHTML = '';
    if (!sorted.length) { list.innerHTML = '<div class="home-empty">登録がありません。</div>'; return; }
    for (const e of sorted) {
      const stage = stageOf(e);
      const pct = stageProgress(stage);
      const barCls = stage === '内定' ? 'bar done' : isOutcome(stage) ? 'bar out' : 'bar';
      const row = document.createElement('div');
      row.className = 'senko-row';
      row.innerHTML =
        `<div><div class="s-name"></div><div class="s-ind"></div></div>` +
        `<div><div class="${barCls}"><span style="width:${pct}%"></span></div><div class="s-stage${stage === '内定' ? ' done' : ''}"></div></div>` +
        `<div class="cell-next"></div>`;
      row.querySelector('.s-name').textContent = e.companyName || e.host;
      row.querySelector('.s-ind').textContent = e.industry && e.industry !== '業界未設定' ? e.industry : '';
      row.querySelector('.s-stage').textContent = stageLabel(stage);
      row.querySelector('.cell-next').appendChild(nextActionEl(e));
      row.onclick = () => openModal(e);
      list.appendChild(row);
    }
  } else {
    kanban.innerHTML = '';
    for (const stage of STAGES) {
      const items = all.filter((e) => stageOf(e) === stage);
      const col = document.createElement('div');
      col.className = 'kan-col';
      const head = document.createElement('div');
      head.className = 'kan-head';
      head.innerHTML = `<span></span><span class="cnt">${items.length}</span>`;
      head.querySelector('span').textContent = stage;
      col.appendChild(head);
      for (const e of items) {
        const card = document.createElement('div');
        card.className = 'kan-card';
        const nd = nearestUpcoming(e);
        card.innerHTML = `<div class="k-name"></div><div class="k-next"></div>`;
        card.querySelector('.k-name').textContent = e.companyName || e.host;
        card.querySelector('.k-next').textContent = nd ? `${nd.type || '締切'} ${whenText(nd.n)}` : '';
        card.onclick = () => openModal(e);
        col.appendChild(card);
      }
      kanban.appendChild(col);
    }
  }
}

// =====================================================================
//  マイページ一覧（カード）
// =====================================================================
function makeField(value, masked) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const input = document.createElement('input');
  input.value = value || ''; input.readOnly = true;
  input.type = masked ? 'password' : 'text';
  if (!value) input.placeholder = masked ? 'パスワード' : 'マイページID';
  wrap.appendChild(input);
  if (masked) {
    const eye = document.createElement('button');
    eye.innerHTML = icon('eye', 15); eye.title = '表示';
    eye.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; };
    wrap.appendChild(eye);
  }
  const copy = document.createElement('button');
  copy.innerHTML = icon('copy', 15); copy.title = 'コピー';
  copy.onclick = async () => {
    await navigator.clipboard.writeText(value || '');
    copy.innerHTML = icon('done', 15); setTimeout(() => (copy.innerHTML = icon('copy', 15)), 1200);
  };
  wrap.appendChild(copy);
  return wrap;
}

function makeCard(e) {
  const card = document.createElement('div');
  card.className = 'card';
  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(makeLogo(e));
  const title = document.createElement('div');
  title.className = 'card-title';
  const link = document.createElement('a');
  link.href = e.mypageUrl || '#'; link.target = '_blank'; link.rel = 'noopener';
  link.textContent = e.companyName || e.host || '(無題)';
  title.appendChild(link);
  const tag = document.createElement('span');
  const unset = !e.industry || e.industry === '業界未設定';
  tag.className = 'tag' + (unset ? ' unset' : '');
  tag.textContent = unset ? '業界未設定' : e.industry;
  title.appendChild(document.createElement('br'));
  title.appendChild(tag);
  if (e.mypageUrl) {
    const url = document.createElement('a');
    url.className = 'card-url'; url.href = e.mypageUrl; url.target = '_blank'; url.rel = 'noopener';
    url.textContent = e.mypageUrl;
    title.appendChild(url);
  }
  head.appendChild(title);
  const del = document.createElement('button');
  del.className = 'card-del'; del.innerHTML = icon('trash', 16); del.title = '削除';
  del.onclick = () => removeEntry(e);
  head.appendChild(del);
  card.appendChild(head);

  const indSel = document.createElement('select');
  indSel.className = 'card-industry';
  for (const ind of INDUSTRIES) {
    const o = document.createElement('option');
    o.value = ind; o.textContent = ind;
    if ((e.industry || '業界未設定') === ind) o.selected = true;
    indSel.appendChild(o);
  }
  indSel.onchange = async () => { await send({ type: 'UPSERT', entry: { ...e, industry: indSel.value } }); await refresh(); };
  card.appendChild(indSel);

  const row = document.createElement('div');
  row.className = 'card-row';
  row.appendChild(makeField(e.loginId, false));
  row.appendChild(makeField(e.password, true));
  card.appendChild(row);

  if (e.deadlines && e.deadlines.length) {
    const dls = document.createElement('div');
    dls.className = 'card-deadlines';
    for (const d of e.deadlines) {
      const n = daysUntil(d.date);
      const span = document.createElement('span');
      span.className = 'dl' + (n !== null && n <= 7 ? ' soon' : '');
      span.textContent = `${d.type ? d.type + ' ' : ''}${d.date}${n !== null && n >= 0 ? `（あと${n}日）` : ''}`;
      dls.appendChild(span);
    }
    card.appendChild(dls);
  }

  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const st = document.createElement('span');
  st.className = 'status-pill';
  st.innerHTML = `<span class="pip"></span>${stageOf(e)}`;
  foot.appendChild(st);
  const edit = document.createElement('button');
  edit.className = 'edit-link'; edit.innerHTML = `${icon('pencil', 13)}編集`;
  edit.onclick = () => openModal(e);
  foot.appendChild(edit);
  card.appendChild(foot);
  return card;
}

function renderGrid() {
  const q = $('#search').value.trim().toLowerCase();
  const filterInd = $('#filter-industry').value;
  const sort = $('#sort').value;
  let items = all.filter((e) => {
    if (filterInd && (e.industry || '業界未設定') !== filterInd) return false;
    if (!q) return true;
    return [e.companyName, e.host, e.loginId, e.mypageUrl].some((v) => (v || '').toLowerCase().includes(q));
  });
  items.sort((a, b) => {
    if (sort === 'name') return (a.companyName || '').localeCompare(b.companyName || '', 'ja');
    if (sort === 'industry') return (a.industry || 'んん').localeCompare(b.industry || 'んん', 'ja');
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<div class="empty">該当するマイページがありません。<br>「マイページを追加」または対象サイトでログインして登録してください。</div>';
    return;
  }
  for (const e of items) grid.appendChild(makeCard(e));
}

function renderDeadlines() {
  const list = $('#deadline-list');
  const rows = [];
  for (const e of all) for (const d of e.deadlines || []) rows.push({ company: e.companyName || e.host, type: d.type || '締切', date: d.date, n: daysUntil(d.date) });
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  list.innerHTML = rows.length ? '' : '<li class="empty">締切の登録がありません。</li>';
  for (const r of rows) {
    const li = document.createElement('li');
    const left = r.n === null ? '' : r.n < 0 ? '終了' : `あと${r.n}日`;
    li.innerHTML = `<span class="d-date"></span><span class="d-left">${left}</span><span class="d-type"></span><span class="d-company"></span>`;
    li.querySelector('.d-date').textContent = r.date;
    li.querySelector('.d-type').textContent = r.type;
    li.querySelector('.d-company').textContent = r.company;
    list.appendChild(li);
  }
}

// ---- データ取得・再描画 ----
async function refresh() {
  const [listRes, profRes] = await Promise.all([send({ type: 'LIST' }), send({ type: 'GET_PROFILE' })]);
  all = listRes.entries || [];
  profile = profRes.profile || {};
  renderHome();
  renderGrid();
  renderSenko();
  renderDeadlines();
}

async function removeEntry(e) {
  if (!confirm(`「${e.companyName || e.host}」を削除しますか?`)) return;
  await send({ type: 'DELETE', id: e.id });
  await refresh();
}

// ---- モーダル ----
function fillSelect(sel, values, value) {
  sel.innerHTML = '';
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    if ((value || values[0]) === v) o.selected = true;
    sel.appendChild(o);
  }
}
function openModal(entry) {
  editingId = entry ? entry.id : null;
  editingHost = entry ? entry.host || '' : '';
  $('#modal-title').textContent = entry ? 'マイページを編集' : 'マイページを追加';
  $('#f-company').value = entry?.companyName || '';
  fillSelect($('#f-industry'), INDUSTRIES, entry?.industry);
  $('#f-url').value = entry?.mypageUrl || '';
  $('#f-id').value = entry?.loginId || '';
  $('#f-pw').value = entry?.password || '';
  $('#f-pw').type = 'password';
  $('#f-deadlines').value = deadlinesToText(entry?.deadlines);
  fillSelect($('#f-stage'), ALL_STATES, entry?.stage || '気になる');
  $('#f-memo').value = entry?.memo || '';
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

async function saveModal() {
  let host = editingHost;
  if (!host) { try { host = new URL($('#f-url').value).hostname; } catch { host = ''; } }
  const entry = {
    id: editingId || undefined,
    host,
    companyName: $('#f-company').value.trim(),
    industry: $('#f-industry').value,
    mypageUrl: $('#f-url').value.trim(),
    loginId: $('#f-id').value.trim(),
    password: $('#f-pw').value,
    deadlines: textToDeadlines($('#f-deadlines').value),
    stage: $('#f-stage').value,
    memo: $('#f-memo').value.trim(),
  };
  await send({ type: 'UPSERT', entry });
  closeModal();
  await refresh();
}

// ---- ビュー切替 ----
function switchView(view) {
  document.querySelectorAll('.nav[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  for (const v of ['home', 'list', 'senko', 'deadlines']) $('#view-' + v).classList.toggle('hidden', v !== view);
  if (location.hash.slice(1) !== view) location.hash = view;
}

// ---- 初期化 ----
function init() {
  applyIcons(document);
  for (const ind of INDUSTRIES) {
    const o = document.createElement('option');
    o.value = ind; o.textContent = ind;
    $('#filter-industry').appendChild(o);
  }
  $('#search').oninput = renderGrid;
  $('#filter-industry').onchange = renderGrid;
  $('#sort').onchange = renderGrid;
  $('#add').onclick = () => openModal(null);
  $('#save').onclick = saveModal;
  $('#cancel').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  $('#pw-toggle').onclick = () => { const f = $('#f-pw'); f.type = f.type === 'password' ? 'text' : 'password'; };
  document.querySelectorAll('.nav[data-view]').forEach((b) => { b.onclick = () => switchView(b.dataset.view); });
  $('#nav-options').onclick = () => { location.href = 'profile.html'; };
  const initial = (location.hash || '#home').slice(1);
  if (['home', 'list', 'senko', 'deadlines'].includes(initial)) switchView(initial);
  $('#senko-progress').onclick = () => { senkoMode = 'progress'; renderSenko(); };
  $('#senko-board').onclick = () => { senkoMode = 'board'; renderSenko(); };
  $('#sync').onclick = async () => {
    $('#sync-info').textContent = '同期中…';
    const res = await send({ type: 'SYNC_ALL' });
    $('#sync-info').textContent = res.sync?.ok ? `同期完了（${res.sync.count}件）` : `失敗: ${res.sync?.error || ''}`;
  };
  refresh();
}
init();
