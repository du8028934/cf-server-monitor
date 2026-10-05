import {
  THEME_STORE_CACHE_TTL_SECONDS,
  THEME_STORE_URL
} from '../utils/config.js'
import { mergeLocalThemeStore } from '../utils/localThemes.js'
import { normalizeThemeUrl } from '../utils/themeUrl.js'

const THEME_ID_RE = /^[A-Za-z0-9._-]{1,64}$/
const GITHUB_PART_RE = /^[A-Za-z0-9._-]+$/

let cachedThemeStore = null
let cacheTime = 0

const createEmptyThemeStore = () => ({ schema: 1, themes: [] })

const normalizeThemeStore = (data) => {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      ...data,
      schema: data.schema || 1,
      themes: Array.isArray(data.themes) ? data.themes : []
    }
  }

  return createEmptyThemeStore()
}

export async function handleTheme() {
  const now = Math.floor(Date.now() / 1000)
  if (cachedThemeStore && (now - cacheTime) < THEME_STORE_CACHE_TTL_SECONDS) {
    return { ok: true, themeStore: cachedThemeStore, cached: true }
  }

  try {
    const res = await fetch(THEME_STORE_URL, {
      headers: { 'User-Agent': 'CFSM-Theme-Store' }
    })

    if (!res.ok) {
      const localOnly = mergeLocalThemeStore(createEmptyThemeStore())
      if (localOnly.themes.length) {
        return { ok: true, themeStore: localOnly, cached: false }
      }
      return { ok: false, status: res.status, error: 'themeStoreProxyFailed' }
    }

    const data = await res.json()
    const themeStore = mergeLocalThemeStore(normalizeThemeStore(data))

    cachedThemeStore = themeStore
    cacheTime = now
    return { ok: true, themeStore, cached: false }
  } catch (e) {
    const localOnly = mergeLocalThemeStore(createEmptyThemeStore())
    if (localOnly.themes.length) {
      return { ok: true, themeStore: localOnly, cached: false }
    }
    return { ok: false, status: 0, error: 'themeStoreProxyFailed' }
  }
}

function githubRepoUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return ''
    if (url.username || url.password || url.search || url.hash) return ''

    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return ''

    const owner = parts[0]
    const repo = String(parts[1] || '').replace(/\.git$/i, '')
    if (!GITHUB_PART_RE.test(owner) || !GITHUB_PART_RE.test(repo)) return ''
    if (parts.slice(0, 2).some(part => part === '.' || part === '..' || /[%\\]/.test(part))) return ''

    return { owner, repo, parts }
  } catch (_) {
    return ''
  }
}

export function getStoreThemeUrl(theme) {
  const versions = Array.isArray(theme?.versions) ? theme.versions : []
  for (const version of versions) {
    const fromVersion = normalizeThemeUrl(version?.theme_url)
    if (fromVersion) return fromVersion
  }

  const parsed = githubRepoUrl(theme?.url)
  if (!parsed) return ''

  if (parsed.parts[2] === 'tree' && parsed.parts.length >= 4) {
    return normalizeThemeUrl(`https://github.com/${parsed.parts.join('/')}`)
  }

  const branch = String(theme?.branch || '').trim()
  if (!branch || !GITHUB_PART_RE.test(branch) || /[%\\]/.test(branch)) return ''

  return normalizeThemeUrl(`https://github.com/${parsed.owner}/${parsed.repo}/tree/${branch}`)
}

export async function getPublicThemeCatalog() {
  const result = await handleTheme()
  if (!result.ok) return []

  const catalog = []
  const seen = new Set()
  for (const theme of result.themeStore.themes) {
    const id = String(theme?.id || '').trim()
    if (!THEME_ID_RE.test(id) || seen.has(id)) continue

    const themeUrl = getStoreThemeUrl(theme)
    if (!themeUrl) continue

    seen.add(id)
    catalog.push({
      id,
      title: String(theme.title || id).slice(0, 80),
      themeUrl
    })
  }

  return catalog
}

export function resolvePublicThemeId(rawId, catalog) {
  const id = String(rawId || '').trim()
  if (id === 'builtin') return 'builtin'
  if (Array.isArray(catalog) && catalog.some(theme => theme.id === id)) return id
  return ''
}

export function resolvePublicThemeUrl(themeId, catalog) {
  const id = resolvePublicThemeId(themeId, catalog)
  if (id === 'builtin') return { id, themeUrl: '' }
  if (!id) return { id: '', themeUrl: null }

  const match = catalog.find(theme => theme.id === id)
  return { id, themeUrl: match?.themeUrl || '' }
}
