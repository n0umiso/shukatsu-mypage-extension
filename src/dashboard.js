// 全画面ダッシュボード。ホーム / マイページ / 選考管理 / 締切 / 設定。
import { STAGES, ALL_STATES, stageProgress, stageLabel, isActive, isOutcome } from './lib/stages.js';
import { icon, applyIcons } from './lib/icons.js';
import { daysUntil, daysSince, faviconUrl, whenColor, whenText } from './lib/utils.js';

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
let dlViewMode = 'cal'; // 'cal' or 'list'
let calYear, calMonth, calSelectedDay;

const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));
try { if (!chrome.runtime?.id) location.reload(); } catch { location.reload(); }
const AVATAR_COLORS = ['#223049', '#c76b4a', '#5a6b7b', '#6e7c5e', '#8a6d5a', '#4e6374', '#7a5c6e'];
function avatarColor(name) {
  let h = 0;
  for (const c of name || '?') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function deadlinesToText(dls = []) {
  return dls.map((d) => { const t = d.label || d.type; return t ? `${t}:${d.date}` : d.date; }).join('\n');
}
function textToDeadlines(text) {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.lastIndexOf(':');
    if (i > 0) { const t = l.slice(0, i).trim(); return { type: t, date: l.slice(i + 1).trim(), label: t }; } return { type: '', date: l };
  });
}
const stageOf = (e) => e.stage || '気になる';
function nearestUpcoming(entry) {
  const ds = (entry.deadlines || []).map((d) => ({ ...d, n: daysUntil(d.date) })).filter((d) => d.n !== null && !d.done);
  const up = ds.filter((d) => d.n >= 0).sort((a, b) => a.n - b.n);
  return up[0] || ds.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}
function whenClass(n) {
  if (n === null) return 'muted';
  if (n <= 2) return 'danger';
  if (n <= 7) return 'warn';
  return 'muted';
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

// ---- 締切 done/delete ヘルパー ----
async function toggleDeadline(entryId, date, dlType) {
  await send({ type: 'TOGGLE_DEADLINE', entryId, date, dlType });
  await refresh();
}
async function removeDeadline(entryId, date, dlType) {
  await send({ type: 'REMOVE_DEADLINE', entryId, date, dlType });
  await refresh();
}

// =====================================================================
//  ホーム — 「今日やること」統合リスト + リンク集
// =====================================================================
let quickLinks = [];
let editingLinkIdx = null;

function buildActionItems() {
  const items = [];

  // 1) 締切が近い（14日以内・未完了）
  for (const e of all) {
    for (const d of e.deadlines || []) {
      if (d.done) continue;
      const n = daysUntil(d.date);
      if (n === null || n < 0 || n > 14) continue;
      items.push({
        kind: 'deadline',
        priority: n,
        e,
        type: d.label || d.type || '締切',
        date: d.date,
        n,
        entryId: e.id,
        dlType: d.type || '',
      });
    }
  }

  // 2) 長期間未確認の企業（選考中のみ、締切アイテムと重複しない企業）
  const deadlineEntryIds = new Set(items.map((i) => i.entryId));
  for (const e of all) {
    if (deadlineEntryIds.has(e.id)) continue;
    if (!isActive(stageOf(e))) continue;
    const ago = daysSince(e.lastVisitedAt || e.updatedAt);
    if (ago === null || ago < 3) continue;
    items.push({
      kind: 'unvisited',
      priority: 100 + (30 - Math.min(ago, 30)),
      e,
      ago,
    });
  }

  items.sort((a, b) => a.priority - b.priority);
  return items;
}

function renderHome() {
  $('#today').textContent = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  const items = buildActionItems();
  const container = $('#home-actions');
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<div class="home-empty">今日やることはありません。新しい企業を登録するか、締切を追加してください。</div>';
  }

  for (const item of items.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'home-row';

    if (item.kind === 'deadline') {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = whenColor(item.n);
      row.appendChild(dot);
      const body = document.createElement('div');
      body.className = 'body';
      const rName = document.createElement('div');
      rName.className = 'r-name';
      rName.textContent = item.e.companyName || item.e.host;
      body.appendChild(rName);
      const rSub = document.createElement('div');
      rSub.className = 'r-sub';
      rSub.textContent = `${item.type}・${item.date}`;
      body.appendChild(rSub);
      row.appendChild(body);
      const w = document.createElement('span');
      w.className = 'r-when';
      w.textContent = whenText(item.n);
      w.style.color = whenColor(item.n);
      row.appendChild(w);
      const acts = document.createElement('div');
      acts.className = 'd-actions';
      const doneBtn = document.createElement('button');
      doneBtn.title = '完了'; doneBtn.innerHTML = icon('done', 14);
      doneBtn.onclick = (ev) => { ev.stopPropagation(); toggleDeadline(item.entryId, item.date, item.dlType); };
      acts.appendChild(doneBtn);
      row.appendChild(acts);
      const btn = document.createElement('button');
      btn.innerHTML = `${icon('external', 14)}開く`;
      btn.onclick = () => openLogin(item.e);
      row.appendChild(btn);
    } else {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = '#8b5cf6';
      row.appendChild(dot);
      const body = document.createElement('div');
      body.className = 'body';
      const rName = document.createElement('div');
      rName.className = 'r-name';
      rName.textContent = item.e.companyName || item.e.host;
      body.appendChild(rName);
      const rSub = document.createElement('div');
      rSub.className = 'r-sub';
      rSub.textContent = `${item.ago}日間未確認`;
      rSub.style.color = '#8b5cf6';
      body.appendChild(rSub);
      row.appendChild(body);
      const checkBtn = document.createElement('button');
      checkBtn.innerHTML = `${icon('done', 14)}確認済み`;
      checkBtn.onclick = async (ev) => {
        ev.stopPropagation();
        await send({ type: 'MARK_VISITED', host: item.e.host });
        await refresh();
      };
      row.appendChild(checkBtn);
      const btn = document.createElement('button');
      btn.innerHTML = `${icon('login', 14)}開く`;
      btn.onclick = () => openLogin(item.e);
      row.appendChild(btn);
    }

    container.appendChild(row);
  }

  renderQuickLinks();
}

// ---- リンク集 ----
function renderQuickLinks() {
  const box = $('#quick-links');
  box.innerHTML = '';
  for (let i = 0; i < quickLinks.length; i++) {
    const lk = quickLinks[i];
    const a = document.createElement('a');
    a.className = 'qlink';
    a.href = lk.url;
    a.target = '_blank';
    a.rel = 'noopener';
    try {
      const fav = document.createElement('img');
      fav.src = `https://www.google.com/s2/favicons?sz=32&domain=${new URL(lk.url).hostname}`;
      fav.width = 16; fav.height = 16;
      fav.style.borderRadius = '3px';
      fav.onerror = () => fav.remove();
      a.appendChild(fav);
    } catch { /* invalid url */ }
    const span = document.createElement('span');
    span.textContent = lk.name;
    a.appendChild(span);
    box.appendChild(a);
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'qlink qlink-add';
  addBtn.innerHTML = `${icon('plus', 14)} 追加`;
  addBtn.onclick = () => openLinkModal(null);
  box.appendChild(addBtn);
}

function openLinkModal(idx) {
  editingLinkIdx = idx;
  const lk = idx !== null ? quickLinks[idx] : null;
  $('#link-modal-title').textContent = lk ? 'リンクを編集' : 'リンクを追加';
  $('#lf-name').value = lk?.name || '';
  $('#lf-url').value = lk?.url || '';
  $('#link-delete').style.display = lk ? '' : 'none';
  $('#link-modal').classList.remove('hidden');
}

function closeLinkModal() {
  $('#link-modal').classList.add('hidden');
}

async function saveLinkModal() {
  const name = $('#lf-name').value.trim();
  const url = $('#lf-url').value.trim();
  if (!name || !url) return;
  if (editingLinkIdx !== null) {
    quickLinks[editingLinkIdx] = { name, url };
  } else {
    quickLinks.push({ name, url });
  }
  await send({ type: 'SAVE_QUICK_LINKS', links: quickLinks });
  closeLinkModal();
  renderQuickLinks();
}

async function deleteLinkItem() {
  if (editingLinkIdx === null) return;
  quickLinks.splice(editingLinkIdx, 1);
  await send({ type: 'SAVE_QUICK_LINKS', links: quickLinks });
  closeLinkModal();
  renderQuickLinks();
}

let linkEditMode = false;
function toggleLinkEditMode() {
  linkEditMode = !linkEditMode;
  $('#edit-links').textContent = linkEditMode ? '完了' : '編集';
  const links = document.querySelectorAll('#quick-links .qlink:not(.qlink-add)');
  links.forEach((a, i) => {
    if (linkEditMode) {
      a.onclick = (ev) => { ev.preventDefault(); openLinkModal(i); };
      a.style.outline = '2px dashed var(--accent)';
      a.style.outlineOffset = '-2px';
    } else {
      a.onclick = null;
      a.style.outline = '';
      a.style.outlineOffset = '';
    }
  });
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
    el.textContent = `${nd.label || nd.type || '締切'} ${whenText(nd.n)}`;
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
        card.querySelector('.k-next').textContent = nd ? `${nd.label || nd.type || '締切'} ${whenText(nd.n)}` : '';
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
      const dlLabel = d.label || d.type;
      span.className = 'dl' + (d.done ? '' : n !== null && n <= 7 ? ' soon' : '');
      if (d.done) span.style.opacity = '0.45';
      span.textContent = `${dlLabel ? dlLabel + ' ' : ''}${d.date}${!d.done && n !== null && n >= 0 ? `（あと${n}日）` : ''}${d.done ? ' ✓' : ''}`;
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

// =====================================================================
//  締切カレンダー
// =====================================================================
function allDeadlineRows() {
  const rows = [];
  for (const e of all) {
    for (const d of e.deadlines || []) {
      rows.push({
        company: e.companyName || e.host,
        type: d.label || d.type || '締切',
        date: d.date,
        n: daysUntil(d.date),
        done: !!d.done,
        entryId: e.id,
        dlType: d.type || '',
      });
    }
  }
  return rows;
}

function dlMapForMonth(rows, y, m) {
  const map = {};
  for (const r of rows) {
    const dt = new Date(String(r.date).replace(/\//g, '-'));
    if (isNaN(dt)) continue;
    if (dt.getFullYear() === y && dt.getMonth() === m) {
      const day = dt.getDate();
      (map[day] = map[day] || []).push(r);
    }
  }
  return map;
}

function renderCalendar() {
  const rows = allDeadlineRows();
  const dlMap = dlMapForMonth(rows, calYear, calMonth);
  const gridEl = $('#cal-grid');
  const label = $('#cal-month');
  label.textContent = `${calYear}年${calMonth + 1}月`;
  gridEl.innerHTML = '';

  // DOW headers
  const dows = ['日', '月', '火', '水', '木', '金', '土'];
  for (const dow of dows) {
    const h = document.createElement('div');
    h.className = 'cal-dow';
    h.textContent = dow;
    gridEl.appendChild(h);
  }

  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calYear && today.getMonth() === calMonth;

  // Empty cells
  for (let i = 0; i < firstDow; i++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day empty';
    gridEl.appendChild(cell);
  }

  // Day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    const dls = dlMap[d] || [];
    const dow = (firstDow + d - 1) % 7;
    const isToday = isCurrentMonth && today.getDate() === d;
    const isSelected = calSelectedDay === d;
    cell.className = 'cal-day' +
      (isToday ? ' today' : '') +
      (isSelected ? ' selected' : '') +
      (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');

    const num = document.createElement('span');
    num.className = 'cal-num';
    num.textContent = d;
    cell.appendChild(num);

    if (dls.length) {
      const dots = document.createElement('div');
      dots.className = 'cal-dots';
      for (const dl of dls.slice(0, 4)) {
        const dot = document.createElement('span');
        dot.className = 'cal-dot' + (dl.done ? ' done-dot' : '');
        dots.appendChild(dot);
      }
      cell.appendChild(dots);
    }

    const day = d;
    cell.onclick = () => {
      calSelectedDay = calSelectedDay === day ? null : day;
      renderCalendar();
      renderCalendarDetail();
    };
    gridEl.appendChild(cell);
  }

  renderCalendarDetail();
}

function renderCalendarDetail() {
  const detail = $('#cal-detail');
  detail.innerHTML = '';
  const rows = allDeadlineRows();

  let filtered;
  if (calSelectedDay != null) {
    filtered = dlMapForMonth(rows, calYear, calMonth)[calSelectedDay] || [];
    const head = document.createElement('div');
    head.className = 'cal-detail-head';
    head.textContent = `${calMonth + 1}月${calSelectedDay}日の締切`;
    detail.appendChild(head);
  } else {
    // Show all deadlines in the month
    const monthDls = [];
    const map = dlMapForMonth(rows, calYear, calMonth);
    for (const day of Object.keys(map).sort((a, b) => a - b)) {
      monthDls.push(...map[day]);
    }
    filtered = monthDls;
    if (filtered.length) {
      const head = document.createElement('div');
      head.className = 'cal-detail-head';
      head.textContent = `${calMonth + 1}月の締切（${filtered.length}件）`;
      detail.appendChild(head);
    }
  }

  if (!filtered.length) {
    detail.innerHTML += '<div class="cal-detail-empty">締切はありません</div>';
    return;
  }

  for (const r of filtered) {
    const li = document.createElement('div');
    li.className = 'home-row' + (r.done ? ' dl-done' : '');
    li.style.gap = '10px';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = r.done ? 'var(--hint)' : whenColor(r.n);
    li.appendChild(dot);

    const body = document.createElement('div');
    body.className = 'body';
    const rName = document.createElement('div');
    rName.className = 'r-name';
    rName.textContent = r.company;
    body.appendChild(rName);
    const rSub = document.createElement('div');
    rSub.className = 'r-sub';
    rSub.textContent = `${r.type}・${r.date}`;
    body.appendChild(rSub);
    li.appendChild(body);

    if (!r.done && r.n !== null && r.n >= 0) {
      const w = document.createElement('span');
      w.className = 'r-when';
      w.textContent = whenText(r.n);
      w.style.color = whenColor(r.n);
      li.appendChild(w);
    }

    // action buttons
    const acts = document.createElement('div');
    acts.className = 'd-actions';

    const doneBtn = document.createElement('button');
    doneBtn.className = r.done ? 'd-done-btn is-done' : 'd-done-btn';
    doneBtn.title = r.done ? '未完了に戻す' : '完了';
    doneBtn.innerHTML = icon(r.done ? 'undo' : 'done', 14);
    doneBtn.onclick = (ev) => { ev.stopPropagation(); toggleDeadline(r.entryId, r.date, r.dlType); };
    acts.appendChild(doneBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'd-del-btn';
    delBtn.title = '削除';
    delBtn.innerHTML = icon('trash', 14);
    delBtn.onclick = (ev) => { ev.stopPropagation(); removeDeadline(r.entryId, r.date, r.dlType); };
    acts.appendChild(delBtn);

    li.appendChild(acts);
    detail.appendChild(li);
  }
}

function renderDeadlines() {
  const calWrap = $('#dl-cal-wrap');
  const listEl = $('#deadline-list');

  if (dlViewMode === 'cal') {
    calWrap.classList.remove('hidden');
    listEl.classList.add('hidden');
    renderCalendar();
    return;
  }

  calWrap.classList.add('hidden');
  listEl.classList.remove('hidden');

  const rows = allDeadlineRows();
  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  listEl.innerHTML = rows.length ? '' : '<li class="empty">締切の登録がありません。</li>';
  for (const r of rows) {
    const li = document.createElement('li');
    if (r.done) li.classList.add('dl-done');
    const left = r.n === null ? '' : r.n < 0 ? '終了' : `あと${r.n}日`;

    const dateEl = document.createElement('span');
    dateEl.className = 'd-date'; dateEl.textContent = r.date;
    li.appendChild(dateEl);

    const leftEl = document.createElement('span');
    leftEl.className = 'd-left'; leftEl.textContent = left;
    li.appendChild(leftEl);

    const typeEl = document.createElement('span');
    typeEl.className = 'd-type'; typeEl.textContent = r.type;
    li.appendChild(typeEl);

    const compEl = document.createElement('span');
    compEl.className = 'd-company'; compEl.textContent = r.company;
    li.appendChild(compEl);

    const acts = document.createElement('div');
    acts.className = 'd-actions';

    const doneBtn = document.createElement('button');
    doneBtn.className = r.done ? 'd-done-btn is-done' : 'd-done-btn';
    doneBtn.title = r.done ? '未完了に戻す' : '完了';
    doneBtn.innerHTML = icon(r.done ? 'undo' : 'done', 14);
    doneBtn.onclick = (ev) => { ev.stopPropagation(); toggleDeadline(r.entryId, r.date, r.dlType); };
    acts.appendChild(doneBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'd-del-btn';
    delBtn.title = '削除';
    delBtn.innerHTML = icon('trash', 14);
    delBtn.onclick = (ev) => { ev.stopPropagation(); removeDeadline(r.entryId, r.date, r.dlType); };
    acts.appendChild(delBtn);

    li.appendChild(acts);
    listEl.appendChild(li);
  }
}

// ---- データ取得・再描画 ----
async function refresh() {
  const [listRes, profRes, linksRes] = await Promise.all([
    send({ type: 'LIST' }),
    send({ type: 'GET_PROFILE' }),
    send({ type: 'GET_QUICK_LINKS' }),
  ]);
  all = listRes.entries || [];
  profile = profRes.profile || {};
  quickLinks = linksRes.links || [];
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

  // カレンダー初期値
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  calSelectedDay = null;

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

  // 締切ビュー切替
  $('#dl-view-cal').onclick = () => { dlViewMode = 'cal'; $('#dl-view-cal').classList.add('active'); $('#dl-view-list').classList.remove('active'); renderDeadlines(); };
  $('#dl-view-list').onclick = () => { dlViewMode = 'list'; $('#dl-view-list').classList.add('active'); $('#dl-view-cal').classList.remove('active'); renderDeadlines(); };

  // カレンダーナビ
  $('#cal-prev').onclick = () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } calSelectedDay = null; renderCalendar(); };
  $('#cal-next').onclick = () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } calSelectedDay = null; renderCalendar(); };
  $('#cal-today').onclick = () => { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); calSelectedDay = null; renderCalendar(); };

  $('#sync').onclick = async () => {
    $('#sync-info').textContent = '同期中…';
    const res = await send({ type: 'SYNC_ALL' });
    if (!res || !res.sync) {
      $('#sync-info').textContent = '同期失敗（応答なし）';
    } else if (res.sync.ok) {
      $('#sync-info').textContent = `同期完了（${res.sync.count}件）`;
    } else if ((res.sync.error || '').includes('未設定')) {
      $('#sync-info').textContent = 'GAS URL未設定 → 情報・設定で設定';
    } else if ((res.sync.error || '').includes('unauthorized')) {
      $('#sync-info').textContent = 'トークン不一致 → 設定を確認';
    } else {
      $('#sync-info').textContent = `失敗: ${res.sync.error || '不明'}`;
    }
  };

  // リンク集
  $('#edit-links').onclick = toggleLinkEditMode;
  $('#link-save').onclick = saveLinkModal;
  $('#link-cancel').onclick = closeLinkModal;
  $('#link-delete').onclick = deleteLinkItem;
  $('#link-modal').onclick = (e) => { if (e.target.id === 'link-modal') closeLinkModal(); };

  // エクスポート / インポート
  $('#export-btn').onclick = async () => {
    const r = await send({ type: 'LIST' });
    const blob = new Blob([JSON.stringify(r.entries || [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shukatsu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#import-btn').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const entries = JSON.parse(text);
      if (!Array.isArray(entries)) throw new Error('invalid format');
      if (!confirm(`${entries.length}件のデータをインポートします。既存の同名企業は上書きされます。よろしいですか？`)) return;
      for (const e of entries) await send({ type: 'UPSERT', entry: e });
      await refresh();
      $('#sync-info').textContent = `${entries.length}件インポート完了`;
    } catch (err) {
      alert(`インポート失敗: ${err.message}`);
    }
    ev.target.value = '';
  };

  refresh();
}
init();
