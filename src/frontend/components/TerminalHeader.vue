<template>
  <div class="terminal-header">
    <div class="terminal-dots">
      <span class="terminal-dot red"></span>
      <span class="terminal-dot yellow"></span>
      <span class="terminal-dot green"></span>
    </div>
    <div class="terminal-title">{{ title }}</div>
    <div class="terminal-header-controls">
      <div class="theme-store-picker" v-if="!isAdminPage">
        <button
          ref="themePickerBtn"
          type="button"
          class="theme-store-picker-btn"
          :disabled="loadingThemes"
          aria-label="切换主题"
          title="切换主题"
          @click.stop="toggleThemePanel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
          </svg>
        </button>
        <Teleport to="body">
          <div
            v-if="themePanelOpen"
            class="theme-store-picker-panel"
            :style="themePanelStyle"
            @click.stop
          >
            <button type="button" :class="{ active: selectedThemeId === 'builtin' }" @click="applyStoreTheme('builtin')">内置主题</button>
            <button
              v-for="theme in storeThemes"
              :key="theme.id"
              type="button"
              :class="{ active: selectedThemeId === theme.id }"
              @click="applyStoreTheme(theme.id)"
            >{{ theme.title }}</button>
          </div>
        </Teleport>
      </div>
      <div class="lang-toggle">
        <button 
          class="lang-btn" 
          :class="{ active: currentLang === 'en' }"
          @click="setLang('en')"
          aria-label="English"
        >EN</button>
        <button 
          class="lang-btn" 
          :class="{ active: currentLang === 'zh' }"
          @click="setLang('zh')"
          aria-label="中文"
        >中</button>
      </div>
      <div class="theme-toggle-wrapper">
        <div class="theme-toggle">
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'auto' }"
            @click="setTheme('auto')"
            aria-label="Auto - Follow System"
          ><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-monitor"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg></button>
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'dark' }"
            @click="setTheme('dark')"
            aria-label="Dark Mode"
          ><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-moon"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg></button>
          <button 
            class="theme-btn" 
            :class="{ active: currentTheme === 'light' }"
            @click="setTheme('light')"
            aria-label="Light Mode"
          ><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sun"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg></button>
        </div>
      </div>
      <a v-if="isAdminPage" href="/#/" class="admin-link-header"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-home">
  <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/>
</svg></a>
      <a v-else :href="adminHref" class="admin-link-header"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></a>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { t, setLanguage, getLanguage } from '../utils/i18n'
import { useTheme } from '../composables/useTheme'
import { DEFAULT_SITE_TITLE } from '../utils/constants'
import { hasConfiguredApiBase } from '../utils/config'
import http from '../utils/http'

const PUBLIC_THEME_COOKIE = 'cfsm_public_theme'

defineProps({
  title: {
    type: String,
    default: DEFAULT_SITE_TITLE
  }
})

const { currentTheme, setTheme } = useTheme()
const currentLang = ref('en')
const route = useRoute()
const isAdminPage = ref(route.path === '/admin')
const adminHref = computed(() => hasConfiguredApiBase() ? '/#/admin' : '/admin#/admin')
const storeThemes = ref([])
const loadingThemes = ref(false)
const selectedThemeId = ref('builtin')
const themePanelOpen = ref(false)
const themePickerBtn = ref(null)
const themePanelStyle = ref({})

const setLang = (lang) => {
  setLanguage(lang)
  currentLang.value = lang
}

const handleLanguageChange = (e) => {
  currentLang.value = e.detail.lang
}

const readPublicThemeCookie = () => {
  const prefix = `${PUBLIC_THEME_COOKIE}=`
  const match = document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix))
  if (!match) return ''
  try {
    return decodeURIComponent(match.slice(prefix.length))
  } catch (_) {
    return ''
  }
}

const getWorkerOrigin = () => {
  if (import.meta.env.DEV && window.location.port === '5173') {
    return String(import.meta.env.VITE_DEV_PROXY_TARGET || 'http://localhost:8787').replace(/\/$/, '')
  }
  return window.location.origin
}

const applyStoreTheme = (themeId) => {
  selectedThemeId.value = String(themeId || 'builtin')
  themePanelOpen.value = false
  window.location.assign(`${getWorkerOrigin()}/?cfsm_theme=${encodeURIComponent(selectedThemeId.value)}`)
}

const positionThemePanel = () => {
  const button = themePickerBtn.value
  if (!button) return
  const rect = button.getBoundingClientRect()
  themePanelStyle.value = {
    position: 'fixed',
    top: `${Math.round(rect.bottom + 8)}px`,
    right: `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`,
    left: 'auto',
    zIndex: 10050
  }
}

const toggleThemePanel = async () => {
  themePanelOpen.value = !themePanelOpen.value
  if (themePanelOpen.value) {
    await nextTick()
    positionThemePanel()
  }
}

const handleDocumentClick = () => {
  themePanelOpen.value = false
}

onMounted(() => {
  currentLang.value = getLanguage()
  window.addEventListener('languageChanged', handleLanguageChange)
  document.addEventListener('click', handleDocumentClick)
  window.addEventListener('resize', positionThemePanel)
  window.addEventListener('scroll', positionThemePanel, true)

  const onViteDev = import.meta.env.DEV && window.location.port === '5173'
  if (!onViteDev) {
    const cookieTheme = readPublicThemeCookie()
    if (cookieTheme && cookieTheme !== 'builtin') {
      selectedThemeId.value = cookieTheme
    }
  }

  loadingThemes.value = true
  http.get('/theme', { includeAuth: false, autoRedirect: false }).then((result) => {
    const themes = Array.isArray(result.data?.themes) ? result.data.themes : []
    storeThemes.value = themes
      .map(theme => ({
        id: String(theme?.id || '').trim(),
        title: String(theme?.title || theme?.id || '').trim()
      }))
      .filter(theme => theme.id)

    if (selectedThemeId.value !== 'builtin' && !storeThemes.value.some(theme => theme.id === selectedThemeId.value)) {
      selectedThemeId.value = 'builtin'
    }
  }).finally(() => {
    loadingThemes.value = false
  })
})

onUnmounted(() => {
  window.removeEventListener('languageChanged', handleLanguageChange)
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('resize', positionThemePanel)
  window.removeEventListener('scroll', positionThemePanel, true)
})
</script>
