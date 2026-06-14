(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);

  const STAGES_ACTIVE = ['インターン', 'エントリー', 'ES', 'Webテスト', '一次面接', '最終面接'];

  function daysUntil(dateStr) {
    const d = new Date(String(dateStr).replace(/\//g, '-'));
    if (isNaN(d)) return null;
    return Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
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

  function parseDeadlines(str) {
    if (!str) return [];
    return str.split(/\s*\/\s*/).map((s) => {
      const i = s.lastIndexOf(':');
      return i > 0
        ? { type: s.slice(0, i).trim(), date: s.slice(i + 1).trim() }
        : { type: '', date: s.trim() };
    }).filter((d) => d.date);
  }

  function getConfig() {
    try {
      return JSON.parse(localStorage.getItem('pwa_config') || 'null');
    } catch { return null; }
  }
  function saveConfig(cfg) {
    localStorage.setItem('pwa_config', JSON.stringify(cfg));
  }
  function getCachedData() {
    try {
      return JSON.parse(localStorage.getItem('pwa_data') || 'null');
    } catch { return null; }
  }
  function saveCachedData(data) {
    localStorage.setItem('pwa_data', JSON.stringify(data));
  }

  async function fetchEntries(cfg) {
    const url = new URL(cfg.gasUrl);
    url.searchParams.set('action', 'list');
    if (cfg.token) url.searchParams.set('token', cfg.token);
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'fetch failed');
    return data.entries.map((e) => ({
      ...e,
      deadlines: parseDeadlines(e.deadlines),
    }));
  }

  let entries = [];

  // ---- Setup ----
  function showSetup(cfg) {
    $('#setup').classList.remove('hidden');
    $('#app').classList.add('hidden');
    if (cfg) {
      $('#s-url').value = cfg.gasUrl || '';
      $('#s-token').value = cfg.token || '';
    }
  }

  $('#s-save').onclick = async () => {
    const gasUrl = $('#s-url').value.trim();
    const token = $('#s-token').value;
    if (!gasUrl) { $('#s-error').textContent = 'URL を入力してください'; return; }
    $('#s-save').disabled = true;
    $('#s-save').textContent = '接続中…';
    $('#s-error').textContent = '';
    try {
      const cfg = { gasUrl, token };
      const data = await fetchEntries(cfg);
      saveConfig(cfg);
      saveCachedData(data);
      entries = data;
      $('#setup').classList.add('hidden');
      $('#app').classList.remove('hidden');
      renderAll();
    } catch (err) {
      const detail = (err.message || '').includes('unauthorized')
        ? 'トークンが一致しません。GAS のスクリプトプロパティ SYNC_TOKEN と同じ値を入力してください。'
        : (err.message || '').includes('Failed to fetch')
        ? 'GAS に接続できません。URL を確認してください。'
        : `接続失敗: ${err.message}`;
      $('#s-error').textContent = detail;
    } finally {
      $('#s-save').disabled = false;
      $('#s-save').textContent = '接続';
    }
  };

  // ---- Refresh ----
  async function refresh() {
    const cfg = getConfig();
    if (!cfg) return;
    $('#sync-status').innerHTML = '<span class="spinner"></span>';
    try {
      const data = await fetchEntries(cfg);
      saveCachedData(data);
      entries = data;
      renderAll();
      const now = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
      $('#sync-status').textContent = now;
    } catch (err) {
      const msg = (err.message || '').includes('unauthorized') ? 'トークン不一致' : '更新失敗';
      $('#sync-status').textContent = msg;
    }
  }

  $('#refresh').onclick = refresh;
  $('#config').onclick = () => showSetup(getConfig());
  $('#clear-cache').onclick = () => {
    if (!confirm('この端末に保存した GAS URL・トークン・表示データを削除しますか?')) return;
    localStorage.removeItem('pwa_config');
    localStorage.removeItem('pwa_data');
    entries = [];
    $('#sync-status').textContent = '';
    showSetup(null);
  };

  // ---- Tabs ----
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + tab.dataset.view));
    };
  });

  // ---- Render ----
  function renderAll() {
    renderHome();
    renderList();
    renderDeadlines();
  }

  function renderHome() {
    const deadlineRows = [];
    for (const e of entries) {
      for (const d of e.deadlines) {
        deadlineRows.push({ company: e.companyName, type: d.type || '締切', date: d.date, n: daysUntil(d.date), url: e.mypageUrl });
      }
    }
    const week = deadlineRows.filter((r) => r.n !== null && r.n >= 0 && r.n <= 7).length;

    $('#m-total').textContent = entries.length;
    $('#m-active').textContent = entries.filter((e) => STAGES_ACTIVE.includes(e.stage)).length;
    $('#m-week').textContent = week;

    const near = deadlineRows.filter((r) => r.n !== null && r.n >= 0 && r.n <= 14).sort((a, b) => a.n - b.n).slice(0, 8);
    const box = $('#home-deadlines');
    box.innerHTML = '';
    if (!near.length) { box.innerHTML = '<div class="empty">直近2週間の締切はありません</div>'; return; }
    for (const r of near) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML =
        `<div class="card-head"><div class="card-name"></div></div>` +
        `<div class="card-deadline"><span class="dot"></span><span class="dl-text"></span><span class="when"></span></div>`;
      card.querySelector('.card-name').textContent = r.company;
      card.querySelector('.dot').style.background = whenColor(r.n);
      card.querySelector('.dl-text').textContent = `${r.type}  ${r.date}`;
      const w = card.querySelector('.when');
      w.textContent = whenText(r.n);
      w.style.color = whenColor(r.n);
      box.appendChild(card);
    }
  }

  function renderList() {
    const q = ($('#search').value || '').trim().toLowerCase();
    const box = $('#company-list');
    box.innerHTML = '';
    let items = entries;
    if (q) items = items.filter((e) => [e.companyName, e.industry, e.stage].some((v) => (v || '').toLowerCase().includes(q)));
    if (!items.length) { box.innerHTML = '<div class="empty">該当する企業がありません</div>'; return; }
    for (const e of items) {
      const card = document.createElement('div');
      card.className = 'card';

      const head = document.createElement('div');
      head.className = 'card-head';
      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = e.companyName || '(無題)';
      head.appendChild(name);
      if (e.stage) {
        const stage = document.createElement('span');
        stage.className = 'card-stage';
        stage.textContent = e.stage;
        head.appendChild(stage);
      }
      card.appendChild(head);

      if (e.industry) {
        const ind = document.createElement('div');
        ind.className = 'card-industry';
        ind.textContent = e.industry;
        card.appendChild(ind);
      }

      if (e.mypageUrl) {
        const a = document.createElement('a');
        a.href = e.mypageUrl;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = e.mypageUrl;
        card.appendChild(a);
      }

      for (const d of e.deadlines) {
        const n = daysUntil(d.date);
        const dl = document.createElement('div');
        dl.className = 'card-deadline';
        dl.innerHTML = '<span class="dot"></span><span class="dl-text"></span><span class="when"></span>';
        dl.querySelector('.dot').style.background = whenColor(n);
        dl.querySelector('.dl-text').textContent = `${d.type || '締切'}  ${d.date}`;
        const w = dl.querySelector('.when');
        w.textContent = whenText(n);
        w.style.color = whenColor(n);
        card.appendChild(dl);
      }

      box.appendChild(card);
    }
  }

  function renderDeadlines() {
    const rows = [];
    for (const e of entries) {
      for (const d of e.deadlines) {
        rows.push({ company: e.companyName, type: d.type || '締切', date: d.date, n: daysUntil(d.date) });
      }
    }
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const list = $('#deadline-list');
    list.innerHTML = '';
    if (!rows.length) { list.innerHTML = '<li class="empty">締切の登録がありません</li>'; return; }
    for (const r of rows) {
      const li = document.createElement('li');
      const left = r.n === null ? '' : r.n < 0 ? '終了' : r.n === 0 ? '今日' : `あと${r.n}日`;
      li.innerHTML = '<span class="d-date"></span><span class="d-left"></span><span class="d-type"></span><span class="d-company"></span>';
      li.querySelector('.d-date').textContent = r.date;
      const leftEl = li.querySelector('.d-left');
      leftEl.textContent = left;
      leftEl.style.color = whenColor(r.n);
      li.querySelector('.d-type').textContent = r.type;
      li.querySelector('.d-company').textContent = r.company;
      list.appendChild(li);
    }
  }

  $('#search').oninput = renderList;

  // ---- Init ----
  const cfg = getConfig();
  if (!cfg) {
    showSetup(null);
  } else {
    const cached = getCachedData();
    if (cached) {
      entries = cached;
      $('#app').classList.remove('hidden');
      renderAll();
      refresh();
    } else {
      $('#app').classList.remove('hidden');
      refresh();
    }
  }

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
