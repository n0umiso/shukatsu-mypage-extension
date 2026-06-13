// 全画面ダッシュボード。すべての更新は background 経由。

const INDUSTRIES = [
  '業界未設定', 'メーカー', '商社', '金融', 'コンサル', 'IT・通信',
  'インフラ・エネルギー', '広告・マスコミ', '不動産・建設', '人材・サービス', '小売・消費財', 'その他',
];

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
let all = [];
let editingId = null;
let editingHost = '';

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
const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'];
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

// ---- カード生成 ----
function makeLogo(entry) {
  const name = entry.companyName || entry.host || '?';
  const fallback = document.createElement('div');
  fallback.className = 'logo logo-fallback';
  fallback.style.background = avatarColor(name);
  fallback.textContent = name.trim().charAt(0) || '?';
  const fav = faviconUrl(entry.mypageUrl);
  if (!fav) return fallback;
  const img = document.createElement('img');
  img.className = 'logo';
  img.src = fav;
  img.alt = '';
  img.onerror = () => img.replaceWith(fallback);
  return img;
}

function makeField(value, masked) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const input = document.createElement('input');
  input.value = value || '';
  input.readOnly = true;
  input.type = masked ? 'password' : 'text';
  if (!value) input.placeholder = masked ? 'パスワード' : 'マイページID';
  wrap.appendChild(input);
  if (masked) {
    const eye = document.createElement('button');
    eye.textContent = '👁';
    eye.title = '表示';
    eye.onclick = () => { input.type = input.type === 'password' ? 'text' : 'password'; };
    wrap.appendChild(eye);
  }
  const copy = document.createElement('button');
  copy.textContent = '⧉';
  copy.title = 'コピー';
  copy.onclick = async () => {
    await navigator.clipboard.writeText(value || '');
    copy.textContent = '✓';
    setTimeout(() => (copy.textContent = '⧉'), 1200);
  };
  wrap.appendChild(copy);
  return wrap;
}

function makeCard(e) {
  const card = document.createElement('div');
  card.className = 'card';

  // ヘッダ（ロゴ・企業名リンク・削除）
  const head = document.createElement('div');
  head.className = 'card-head';
  head.appendChild(makeLogo(e));

  const title = document.createElement('div');
  title.className = 'card-title';
  const link = document.createElement('a');
  link.href = e.mypageUrl || '#';
  link.target = '_blank';
  link.rel = 'noopener';
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
    url.className = 'card-url';
    url.href = e.mypageUrl;
    url.target = '_blank';
    url.rel = 'noopener';
    url.textContent = e.mypageUrl;
    title.appendChild(url);
  }
  head.appendChild(title);

  const del = document.createElement('button');
  del.className = 'card-del';
  del.textContent = '🗑';
  del.title = '削除';
  del.onclick = () => removeEntry(e);
  head.appendChild(del);
  card.appendChild(head);

  // 業界（インラインで変更可）
  const indSel = document.createElement('select');
  indSel.className = 'card-industry';
  for (const ind of INDUSTRIES) {
    const o = document.createElement('option');
    o.value = ind; o.textContent = ind;
    if ((e.industry || '業界未設定') === ind) o.selected = true;
    indSel.appendChild(o);
  }
  indSel.onchange = async () => {
    await send({ type: 'UPSERT', entry: { ...e, industry: indSel.value } });
    await refresh();
  };
  card.appendChild(indSel);

  // ID / PW
  const row = document.createElement('div');
  row.className = 'card-row';
  row.appendChild(makeField(e.loginId, false));
  row.appendChild(makeField(e.password, true));
  card.appendChild(row);

  // 締切
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

  // フッタ（ステータス・編集）
  const foot = document.createElement('div');
  foot.className = 'card-foot';
  const st = document.createElement('span');
  st.className = 'status-pill';
  st.textContent = e.status ? `● ${e.status}` : '';
  foot.appendChild(st);
  const edit = document.createElement('button');
  edit.className = 'edit-link';
  edit.textContent = '編集';
  edit.onclick = () => openModal(e);
  foot.appendChild(edit);
  card.appendChild(foot);

  return card;
}

// ---- 描画 ----
function renderGrid() {
  const q = $('#search').value.trim().toLowerCase();
  const filterInd = $('#filter-industry').value;
  const sort = $('#sort').value;

  let items = all.filter((e) => {
    if (filterInd && (e.industry || '業界未設定') !== filterInd) return false;
    if (!q) return true;
    return [e.companyName, e.host, e.loginId, e.mypageUrl]
      .some((v) => (v || '').toLowerCase().includes(q));
  });

  items.sort((a, b) => {
    if (sort === 'name') return (a.companyName || '').localeCompare(b.companyName || '', 'ja');
    if (sort === 'industry') return (a.industry || 'んん').localeCompare(b.industry || 'んん', 'ja');
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = '<div class="empty">該当するマイページがありません。<br>「＋ マイページを追加」または対象サイトでログインして登録してください。</div>';
    return;
  }
  for (const e of items) grid.appendChild(makeCard(e));
}

function renderDeadlines() {
  const list = $('#deadline-list');
  const rows = [];
  for (const e of all) {
    for (const d of e.deadlines || []) {
      rows.push({ company: e.companyName || e.host, type: d.type || '締切', date: d.date, n: daysUntil(d.date) });
    }
  }
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

async function refresh() {
  const res = await send({ type: 'LIST' });
  all = res.entries || [];
  renderGrid();
  renderDeadlines();
}

async function removeEntry(e) {
  if (!confirm(`「${e.companyName || e.host}」を削除しますか?`)) return;
  await send({ type: 'DELETE', id: e.id });
  await refresh();
}

// ---- モーダル ----
function fillIndustrySelect(sel, value) {
  sel.innerHTML = '';
  for (const ind of INDUSTRIES) {
    const o = document.createElement('option');
    o.value = ind; o.textContent = ind;
    if ((value || '業界未設定') === ind) o.selected = true;
    sel.appendChild(o);
  }
}
function openModal(entry) {
  editingId = entry ? entry.id : null;
  editingHost = entry ? entry.host || '' : '';
  $('#modal-title').textContent = entry ? 'マイページを編集' : 'マイページを追加';
  $('#f-company').value = entry?.companyName || '';
  fillIndustrySelect($('#f-industry'), entry?.industry);
  $('#f-url').value = entry?.mypageUrl || '';
  $('#f-id').value = entry?.loginId || '';
  $('#f-pw').value = entry?.password || '';
  $('#f-pw').type = 'password';
  $('#f-deadlines').value = deadlinesToText(entry?.deadlines);
  $('#f-status').value = entry?.status || '';
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
    status: $('#f-status').value,
    memo: $('#f-memo').value.trim(),
  };
  await send({ type: 'UPSERT', entry });
  closeModal();
  await refresh();
}

// ---- ビュー切替 ----
function switchView(view) {
  document.querySelectorAll('.nav[data-view]').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view));
  $('#view-list').classList.toggle('hidden', view !== 'list');
  $('#view-deadlines').classList.toggle('hidden', view !== 'deadlines');
}

// ---- 初期化 ----
function init() {
  fillIndustrySelect($('#f-industry'));
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
  $('#pw-toggle').onclick = () => {
    const f = $('#f-pw'); f.type = f.type === 'password' ? 'text' : 'password';
  };
  document.querySelectorAll('.nav[data-view]').forEach((b) => {
    b.onclick = () => switchView(b.dataset.view);
  });
  $('#nav-options').onclick = () => chrome.runtime.openOptionsPage();
  $('#sync').onclick = async () => {
    $('#sync-info').textContent = '同期中…';
    const res = await send({ type: 'SYNC_ALL' });
    $('#sync-info').textContent = res.sync?.ok
      ? `同期完了（${res.sync.count}件）`
      : `失敗: ${res.sync?.error || ''}`;
  };
  refresh();
}
init();
