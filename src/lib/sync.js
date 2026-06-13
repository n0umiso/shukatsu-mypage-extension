// GAS Web アプリへの同期処理。
import { getSettings, getEntries } from './store.js';

/** スプレッドシートへ送る形に整形（パスワード除外設定を反映） */
function toPayload(entry, syncPassword) {
  return {
    id: entry.id,
    companyName: entry.companyName || '',
    industry: entry.industry || '',
    mypageUrl: entry.mypageUrl || '',
    loginId: entry.loginId || '',
    password: syncPassword ? entry.password || '' : '',
    deadlines: (entry.deadlines || [])
      .map((d) => `${d.type ? d.type + ':' : ''}${d.date}`)
      .join(' / '),
    stage: entry.stage || '',
    memo: entry.memo || '',
    updatedAt: entry.updatedAt || '',
    deleted: !!entry.deleted,
  };
}

/** 全エントリを GAS にまとめて upsert する */
export async function syncAll() {
  const settings = await getSettings();
  if (!settings.gasUrl) {
    return { ok: false, error: 'GAS の URL が未設定です（オプション画面で設定してください）' };
  }
  const entries = await getEntries();
  const payload = {
    action: 'sync',
    entries: Object.values(entries).map((e) => toPayload(e, settings.syncPassword)),
  };
  try {
    const res = await fetch(settings.gasUrl, {
      method: 'POST',
      // GAS は単純リクエストにするため text/plain で送る（プリフライト回避）
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({ ok: res.ok }));
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    await chrome.storage.local.set({ lastSync: new Date().toISOString() });
    return { ok: true, count: payload.entries.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
