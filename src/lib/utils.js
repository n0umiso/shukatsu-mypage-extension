export function daysUntil(dateStr) {
  const d = new Date(String(dateStr).replace(/\//g, '-'));
  if (isNaN(d)) return null;
  return Math.ceil((d - new Date().setHours(0, 0, 0, 0)) / 86400000);
}

export function faviconUrl(url) {
  try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(url).hostname}`; }
  catch { return ''; }
}

export function whenColor(n) {
  if (n === null) return '#9ca3af';
  if (n <= 2) return '#dc2626';
  if (n <= 7) return '#b45309';
  return '#223049';
}

export function whenText(n) {
  if (n === null) return '';
  return n < 0 ? '終了' : n === 0 ? '今日' : `あと${n}日`;
}

export function siteKeyFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    return u.hostname + (seg ? '/' + seg : '');
  } catch { return ''; }
}
