// 情報入力・設定（プロフィール + 同期/機能設定）。

const PREFS = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
  '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
  '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
  '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

const $ = (s) => document.querySelector(s);
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

function fillOptions(sel, values, { pad } = {}) {
  const el = typeof sel === 'string' ? $('#' + sel) : sel;
  el.innerHTML = '<option value="">-</option>';
  for (const v of values) {
    const val = pad ? String(v).padStart(2, '0') : String(v);
    const o = document.createElement('option');
    o.value = val; o.textContent = val;
    el.appendChild(o);
  }
}

function range(a, b) {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function buildSelects() {
  const thisYear = new Date().getFullYear();
  fillOptions('birthYear', range(thisYear - 40, thisYear - 15));
  fillOptions('birthMonth', range(1, 12), { pad: true });
  fillOptions('birthDay', range(1, 31), { pad: true });
  fillOptions('gradYear', range(thisYear, thisYear + 6));
  fillOptions('gradMonth', range(1, 12), { pad: true });
  for (const sel of document.querySelectorAll('select.pref')) {
    sel.innerHTML = '<option value="">-</option>';
    for (const p of PREFS) {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      sel.appendChild(o);
    }
  }
}

function setVal(el, value) {
  if (el.type === 'checkbox') el.checked = !!value;
  else el.value = value ?? '';
}
function getVal(el) {
  return el.type === 'checkbox' ? el.checked : el.value;
}

async function load() {
  const [{ profile }, { settings }] = await Promise.all([
    send({ type: 'GET_PROFILE' }),
    send({ type: 'GET_SETTINGS' }),
  ]);
  for (const el of document.querySelectorAll('[data-profile]')) {
    setVal(el, profile[el.dataset.profile]);
  }
  for (const el of document.querySelectorAll('[data-setting]')) {
    setVal(el, settings[el.dataset.setting]);
  }
  toggleHome();
}

async function save() {
  const profile = {};
  for (const el of document.querySelectorAll('[data-profile]')) {
    profile[el.dataset.profile] = getVal(el);
  }
  const settingsPatch = {};
  for (const el of document.querySelectorAll('[data-setting]')) {
    settingsPatch[el.dataset.setting] = getVal(el);
  }
  await Promise.all([
    send({ type: 'SET_PROFILE', patch: profile }),
    send({ type: 'SET_SETTINGS', patch: settingsPatch }),
  ]);
  $('#saved').textContent = '✓ 保存しました';
  setTimeout(() => ($('#saved').textContent = ''), 2500);
}

function toggleHome() {
  const same = $('#homeSame').checked;
  $('#homeBlock').classList.toggle('disabled', same);
}

function initTabs() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.panel').forEach((p) =>
        p.classList.toggle('hidden', p.id !== 'tab-' + tab.dataset.tab));
    };
  }
}

buildSelects();
initTabs();
$('#save').onclick = save;
$('#homeSame').onchange = toggleHome;
load();
