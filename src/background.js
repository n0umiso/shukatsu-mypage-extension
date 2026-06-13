// Service Worker: データ更新の単一窓口 + スプレッドシート同期のトリガ。
import {
  getEntryList,
  getEntryByHost,
  saveEntry,
  deleteEntry,
  getSettings,
  saveSettings,
  getProfile,
  saveProfile,
} from './lib/store.js';
import { syncAll } from './lib/sync.js';

// autoSync が ON なら保存後に同期。失敗してもローカルは保持される。
async function maybeSync() {
  const { autoSync } = await getSettings();
  if (autoSync) return syncAll();
  return { ok: true, skipped: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'LIST':
          sendResponse({ ok: true, entries: await getEntryList() });
          break;

        case 'UPSERT': {
          const saved = await saveEntry(msg.entry);
          const sync = await maybeSync();
          sendResponse({ ok: true, entry: saved, sync });
          break;
        }

        case 'DELETE': {
          await deleteEntry(msg.id);
          const sync = await maybeSync();
          sendResponse({ ok: true, sync });
          break;
        }

        case 'CAPTURE': {
          // content.js からの自動取り込み。host で既存を探して上書き or 新規。
          const p = msg.payload || {};
          const existing = p.host ? await getEntryByHost(p.host) : null;
          const merged = {
            ...(existing || {}),
            host: p.host || existing?.host || '',
            companyName: existing?.companyName || p.companyName || '',
            mypageUrl: p.mypageUrl || existing?.mypageUrl || '',
            // 入力があった項目だけ更新（空で上書きしない）
            loginId: p.loginId || existing?.loginId || '',
            password: p.password || existing?.password || '',
            deadlines: mergeDeadlines(existing?.deadlines, p.deadlines),
            stage: existing?.stage || '気になる',
            memo: existing?.memo || '',
          };
          const saved = await saveEntry(merged);
          const sync = await maybeSync();
          sendResponse({ ok: true, entry: saved, sync, isNew: !existing });
          break;
        }

        case 'SYNC_ALL':
          sendResponse({ ok: true, sync: await syncAll() });
          break;

        case 'PENDING_LOGIN':
          // ホーム/カードの「ログイン」押下時。次に開くタブで自動入力する予約。
          await chrome.storage.session.set({
            pendingLogin: { host: msg.host, ts: Date.now() },
          });
          sendResponse({ ok: true });
          break;

        case 'CONSUME_LOGIN': {
          // content.js がページ読込時に問い合わせ。予約が一致＆新鮮なら資格情報を返す。
          const { pendingLogin } = await chrome.storage.session.get('pendingLogin');
          const fresh = pendingLogin && Date.now() - pendingLogin.ts < 60000;
          if (fresh && pendingLogin.host === msg.host) {
            await chrome.storage.session.remove('pendingLogin');
            const entry = await getEntryByHost(msg.host);
            sendResponse({
              ok: true,
              creds: entry ? { loginId: entry.loginId, password: entry.password } : null,
            });
          } else {
            sendResponse({ ok: true, creds: null });
          }
          break;
        }

        case 'GET_PROFILE':
          sendResponse({ ok: true, profile: await getProfile() });
          break;

        case 'SET_PROFILE':
          sendResponse({ ok: true, profile: await saveProfile(msg.patch) });
          break;

        case 'GET_SETTINGS':
          sendResponse({ ok: true, settings: await getSettings() });
          break;

        case 'SET_SETTINGS':
          sendResponse({ ok: true, settings: await saveSettings(msg.patch) });
          break;

        default:
          sendResponse({ ok: false, error: `unknown message: ${msg.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // 非同期レスポンスを有効化
});

// 既存締切と新規締切を type+date でユニーク化してマージ
function mergeDeadlines(oldList = [], newList = []) {
  const seen = new Set();
  const out = [];
  for (const d of [...(oldList || []), ...(newList || [])]) {
    if (!d || !d.date) continue;
    const key = `${d.type || ''}|${d.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}
