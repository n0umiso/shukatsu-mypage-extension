import { applyIcons } from './lib/icons.js';

const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

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
$('#settings').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('src/profile.html') }); window.close(); };

(async () => {
  applyIcons(document);
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
})();
