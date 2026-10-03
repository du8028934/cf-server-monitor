const GITHUB_PART_RE = /^[A-Za-z0-9._-]+$/;

export function normalizeThemeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return '';
    if (url.username || url.password || url.search || url.hash) return '';

    const parts = url.pathname.split('/').filter(Boolean);
    const ref = parts[3];
    if (
      parts.length < 4 ||
      parts[2] !== 'tree' ||
      !GITHUB_PART_RE.test(parts[0]) ||
      !GITHUB_PART_RE.test(parts[1]) ||
      !GITHUB_PART_RE.test(ref) ||
      parts.some(part => part === '.' || part === '..' || /[%\\]/.test(part))
    ) {
      return '';
    }

    return `https://github.com/${parts.join('/')}`;
  } catch (_) {
    return '';
  }
}

export function parseThemeUrl(themeUrl) {
  const normalized = normalizeThemeUrl(themeUrl);
  if (!normalized) return null;

  const url = new URL(normalized);
  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[3];
  const themePathParts = parts.slice(4);
  const encodedThemePath = [owner, repo, ref, ...themePathParts]
    .map(part => encodeURIComponent(part))
    .join('/');

  return {
    themeUrl: normalized,
    ref,
    rawBase: `https://raw.githubusercontent.com/${encodedThemePath}`,
    cacheBase: `https://cfsm-theme-cache.local/${encodedThemePath}`
  };
}
