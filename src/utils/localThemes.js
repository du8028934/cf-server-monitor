export const SITE_LUMINAPLUS_THEME_URL =
  'https://github.com/du8028934/cf-server-monitor/tree/main/themes/luminaplus'

export const LOCAL_STORE_THEMES = [
  {
    id: 'luminaplus-site',
    title: 'LuminaPlus 本站',
    cover: 'https://raw.githubusercontent.com/volcano-1025/CFSM-Theme-LuminaPlus/main/docs/preview.png',
    tags: ['LuminaPlus', '本站定制', 'Mobile'],
    description: {
      'zh-CN': '本站定制的 LuminaPlus：手机端外观一键循环、折叠横幅、圆环 / 条形 / 虚线指标样式。',
      en: 'Site fork of LuminaPlus with mobile appearance cycling, banner cards, and ring / bar / dashed metric styles.'
    },
    url: SITE_LUMINAPLUS_THEME_URL,
    author: 'du8028934',
    versions: [
      {
        short_version: 'main',
        title: 'main / themes/luminaplus',
        theme_url: SITE_LUMINAPLUS_THEME_URL
      }
    ]
  }
]

export function mergeLocalThemeStore(themeStore) {
  const themes = Array.isArray(themeStore?.themes) ? [...themeStore.themes] : []
  const seen = new Set(themes.map((theme) => String(theme?.id || '').trim()).filter(Boolean))
  const extras = LOCAL_STORE_THEMES.filter((theme) => theme.id && !seen.has(theme.id))

  return {
    schema: themeStore?.schema || 1,
    ...themeStore,
    themes: [...extras, ...themes]
  }
}
