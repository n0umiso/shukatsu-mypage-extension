// chrome.storage.local を一次データソースとして扱うヘルパー群。
// entries: { [id]: Entry }、settings: { gasUrl, autoSync, syncPassword }

/**
 * Entry の形:
 * {
 *   id: string,            // 一意なID (uuid)
 *   host: string,          // マイページのホスト名 (重複判定キー)
 *   companyName: string,   // 企業名
 *   mypageUrl: string,     // ログインページURL
 *   loginId: string,       // ログインID
 *   password: string,      // パスワード（平文・取り扱い注意）
 *   deadlines: [{ type: string, date: string }],
 *   status: string,        // 選考ステータス
 *   memo: string,
 *   updatedAt: string,     // ISO日時
 *   deleted?: boolean
 * }
 */

const DEFAULT_SETTINGS = {
  gasUrl: '',
  autoSync: true,
  syncPassword: true,
  showAutofillButton: true,
  syncToken: '',
};

export async function getEntries() {
  const { entries = {} } = await chrome.storage.local.get('entries');
  return entries;
}

export async function getEntryList() {
  const entries = await getEntries();
  return Object.values(entries)
    .filter((e) => !e.deleted)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function getEntryByHost(host) {
  const entries = await getEntries();
  return Object.values(entries).find((e) => e.host === host && !e.deleted) || null;
}

let _chain = Promise.resolve();
function serialize(fn) {
  const p = _chain.then(fn);
  _chain = p.catch(() => {});
  return p;
}

export function saveEntry(entry) {
  return serialize(async () => {
    const entries = await getEntries();
    if (!entry.id) entry.id = crypto.randomUUID();
    entry.updatedAt = new Date().toISOString();
    entries[entry.id] = entry;
    await chrome.storage.local.set({ entries });
    return entry;
  });
}

export function deleteEntry(id) {
  return serialize(async () => {
    const entries = await getEntries();
    if (entries[id]) {
      entries[id].deleted = true;
      entries[id].updatedAt = new Date().toISOString();
      await chrome.storage.local.set({ entries });
    }
    return entries[id];
  });
}

// ---- プロフィール（自動入力用の個人データ） ----
export async function getProfile() {
  const { profile = {} } = await chrome.storage.local.get('profile');
  return profile;
}

export async function saveProfile(patch) {
  const current = await getProfile();
  const profile = { ...current, ...patch };
  await chrome.storage.local.set({ profile });
  return profile;
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const settings = { ...current, ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}
