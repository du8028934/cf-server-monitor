import { loadSettings } from '../utils/settings.js';
import {
  DEFAULT_SITE_TITLE,
  THEME_ASSET_CACHE_TTL_SECONDS,
  THEME_COMMIT_CACHE_TTL_SECONDS
} from '../utils/config.js';
import {
  parseCspOrigins,
  buildApiDomainsWithWs,
  buildCspHeader,
  buildBackgroundStyle,
  stripCspMeta,
  injectApiBase
} from '../utils/csp.js';
import { checkAuth } from '../middleware/auth.js';
import { normalizeThemeUrl, parseThemeUrl } from '../utils/themeUrl.js';
import {
  getPublicThemeCatalog,
  resolvePublicThemeId,
  resolvePublicThemeUrl
} from './theme.js';

const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const PREVIEW_COOKIE = 'cfsm_theme_preview';
const PREVIEW_AUTH_COOKIE = 'cfsm_theme_preview_auth';
const PUBLIC_THEME_COOKIE = 'cfsm_public_theme';
const PUBLIC_THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

let filesCache = null;

async function loadFrontendFiles(env) {
  if (filesCache) return filesCache;

  try {
    const files = {};

    if (env.ASSETS) {
      try {
        const mainFiles = ['dashboard.html', 'style.css'];
        for (const filename of mainFiles) {
          try {
            const res = await env.ASSETS.fetch(new Request(`http://static/${filename}`));
            if (res.ok) {
              files[filename] = await res.text();
            }
          } catch (e) {
            // ignore missing asset binding files
          }
        }
      } catch (e) {
        console.log('[INFO] No ASSETS binding');
      }
    }

    filesCache = files;
    return filesCache;
  } catch (e) {
    console.error('[ERROR] Failed to load frontend files:', e);
    return {};
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function insertBeforeHeadClose(html, content) {
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${content}\n</head>`);
  }
  return `${content}\n${html}`;
}

function injectTitle(html, title) {
  const safeTitle = escapeHtml(title || DEFAULT_SITE_TITLE);
  if (/<title>.*?<\/title>/is.test(html)) {
    return html.replace(/<title>.*?<\/title>/is, `<title>${safeTitle}</title>`);
  }
  return insertBeforeHeadClose(html, `<title>${safeTitle}</title>`);
}

function injectFavicon(html, favicon) {
  const value = String(favicon || '').trim();
  if (!value) return html;

  const withoutExistingIcons = html.replace(/<link\b(?=[^>]*\brel=["'][^"']*(?:shortcut\s+icon|icon)[^"']*["'])[^>]*>\s*/gi, '');
  const safeFavicon = escapeHtml(value);
  return insertBeforeHeadClose(withoutExistingIcons, `<link rel="icon" href="${safeFavicon}">`);
}

function getEnvApiBases(env) {
  return parseCspOrigins(env?.API_BASE || '');
}

function injectAppearanceSettings(html, settings, env = {}) {
  let modifiedHtml = stripCspMeta(html);

  modifiedHtml = injectTitle(modifiedHtml, settings.site_title || DEFAULT_SITE_TITLE);
  modifiedHtml = injectFavicon(modifiedHtml, settings.favicon);

  const envApiBases = getEnvApiBases(env);
  modifiedHtml = injectApiBase(modifiedHtml, envApiBases);

  const cspStatic = settings.csp_static || '';
  const cspApi = settings.csp_api || '';
  const staticDomains = parseCspOrigins(cspStatic);
  const rawApiDomains = [
    ...envApiBases,
    ...parseCspOrigins(cspApi)
  ];
  const apiDomains = buildApiDomainsWithWs(rawApiDomains);
  const csp = buildCspHeader({ staticDomains, apiDomains });

  if (settings.custom_head) {
    modifiedHtml = insertBeforeHeadClose(modifiedHtml, settings.custom_head);
  }

  if (settings.custom_script) {
    if (/<\/body>/i.test(modifiedHtml)) {
      modifiedHtml = modifiedHtml.replace(/<\/body>/i, `<script>${settings.custom_script}</script>\n</body>`);
    } else {
      modifiedHtml += `\n<script>${settings.custom_script}</script>`;
    }
  }

  if (settings.custom_bg || settings.custom_bg_mobile) {
    modifiedHtml = insertBeforeHeadClose(modifiedHtml, buildBackgroundStyle(settings.custom_bg, settings.custom_bg_mobile));
  }

  return {
    html: modifiedHtml,
    csp
  };
}

function getContentType(path) {
  const cleanPath = String(path || '').split('?')[0].toLowerCase();
  if (cleanPath.endsWith('.html')) return 'text/html;charset=UTF-8';
  if (cleanPath.endsWith('.js') || cleanPath.endsWith('.mjs')) return 'application/javascript;charset=UTF-8';
  if (cleanPath.endsWith('.css')) return 'text/css;charset=UTF-8';
  if (cleanPath.endsWith('.json')) return 'application/json;charset=UTF-8';
  if (cleanPath.endsWith('.svg')) return 'image/svg+xml';
  if (cleanPath.endsWith('.png')) return 'image/png';
  if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) return 'image/jpeg';
  if (cleanPath.endsWith('.webp') || cleanPath.endsWith('.webpg')) return 'image/webp';
  if (cleanPath.endsWith('.gif')) return 'image/gif';
  if (cleanPath.endsWith('.ico')) return 'image/x-icon';
  if (cleanPath.endsWith('.avif')) return 'image/avif';
  if (cleanPath.endsWith('.woff')) return 'font/woff';
  if (cleanPath.endsWith('.woff2')) return 'font/woff2';
  if (cleanPath.endsWith('.ttf')) return 'font/ttf';
  if (cleanPath.endsWith('.otf')) return 'font/otf';
  if (cleanPath.endsWith('.map')) return 'application/json;charset=UTF-8';
  return 'application/octet-stream';
}

function isCommitRef(ref) {
  return /^[a-f0-9]{40}$/i.test(ref);
}

function getThemeWorkerCacheTtl(parsedTheme) {
  return isCommitRef(parsedTheme.ref) ? THEME_COMMIT_CACHE_TTL_SECONDS : THEME_ASSET_CACHE_TTL_SECONDS;
}

function getThemeAssetBrowserCacheControl(parsedTheme) {
  if (isCommitRef(parsedTheme.ref)) {
    return IMMUTABLE_ASSET_CACHE_CONTROL;
  }
  return `public, max-age=${THEME_ASSET_CACHE_TTL_SECONDS}`;
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      return valueParts.join('=');
    }
  }
  return '';
}

function getPreviewThemeUrlFromCookie(request) {
  const value = getCookie(request, PREVIEW_COOKIE);
  if (!value) return '';
  try {
    return normalizeThemeUrl(decodeURIComponent(value));
  } catch (_) {
    return '';
  }
}

function buildPreviewCookie(request, themeUrl) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${PREVIEW_COOKIE}=${encodeURIComponent(themeUrl)}; Max-Age=${THEME_ASSET_CACHE_TTL_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

function buildClearPreviewCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${PREVIEW_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}

function getPublicThemeIdFromCookie(request, catalog) {
  const value = getCookie(request, PUBLIC_THEME_COOKIE);
  if (!value) return '';
  try {
    return resolvePublicThemeId(decodeURIComponent(value), catalog);
  } catch (_) {
    return '';
  }
}

function injectThemeSwitcher(html, catalog, selectedId) {
  if (!html || /id=["']cfsm-theme-switcher["']/.test(html)) return html;

  const options = [
    { id: '', title: '站点默认' },
    { id: 'builtin', title: '内置主题' },
    ...(Array.isArray(catalog) ? catalog : []).map(theme => ({
      id: theme.id,
      title: theme.title
    }))
  ];

  const panelItems = options.map(option => {
    const active = option.id === selectedId ? ' is-active' : '';
    return `<button type="button" class="cfsm-theme-item${active}" data-theme-id="${escapeHtml(option.id)}">${escapeHtml(option.title)}</button>`;
  }).join('');

  const widget = `<style id="cfsm-theme-switcher-style">
#cfsm-theme-switcher{position:fixed;top:13px;right:auto;left:auto;z-index:2147483000;pointer-events:none;box-sizing:border-box;visibility:hidden}
#cfsm-theme-switcher.is-fallback{visibility:visible;pointer-events:auto}
#cfsm-theme-switcher-controls{position:relative;display:inline-flex;align-items:center;pointer-events:auto}
#cfsm-theme-switcher-btn{padding:0;margin:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-sizing:border-box;flex:none}
#cfsm-theme-switcher-btn svg{width:16px;height:16px;pointer-events:none;flex:none}
#cfsm-theme-switcher-btn:not([data-themed]){width:36px;height:36px;border:1px solid rgba(128,128,128,.5);border-radius:999px;background:rgba(128,128,128,.14);color:inherit}
#cfsm-theme-switcher-panel{display:none;position:fixed;z-index:2147483001;min-width:180px;max-height:min(70vh,360px);overflow:auto;padding:6px;border-radius:10px;border:1px solid rgba(0,0,0,.12);background:#fff;color:#111;box-shadow:0 10px 30px rgba(0,0,0,.18);box-sizing:border-box}
#cfsm-theme-switcher-panel.is-open{display:flex;flex-direction:column;gap:2px}
#cfsm-theme-switcher-panel.is-centered{min-width:min(280px,calc(100vw - 32px));width:min(320px,calc(100vw - 32px));max-height:min(70vh,420px);left:50%;right:auto;top:50%;transform:translate(-50%,-50%);-webkit-transform:translate(-50%,-50%)}
#cfsm-theme-switcher-backdrop{display:none;position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.4)}
#cfsm-theme-switcher-backdrop.is-open{display:block}
.cfsm-theme-item{display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;border-radius:6px;padding:8px 10px;font-size:13px;cursor:pointer}
.cfsm-theme-item:hover,.cfsm-theme-item.is-active{background:rgba(0,0,0,.06)}
@media (prefers-color-scheme: dark){
  #cfsm-theme-switcher-panel{background:#16181d;color:#eee;border-color:rgba(255,255,255,.12)}
  .cfsm-theme-item:hover,.cfsm-theme-item.is-active{background:rgba(255,255,255,.08)}
}
</style>
<div id="cfsm-theme-switcher">
  <div id="cfsm-theme-switcher-inner">
    <div id="cfsm-theme-switcher-controls">
      <button type="button" id="cfsm-theme-switcher-btn" aria-label="切换主题" title="切换主题">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 13.74a2 2 0 0 1-2 0L2.5 8.87a1 1 0 0 1 0-1.74L11 2.26a2 2 0 0 1 2 0l8.5 4.87a1 1 0 0 1 0 1.74z"/><path d="m20 14.37-8.5 4.87a2 2 0 0 1-2 0L2.5 14.37"/><path d="m20 18.37-8.5 4.87a2 2 0 0 1-2 0L2.5 18.37"/></svg>
      </button>
    </div>
  </div>
</div>
<div id="cfsm-theme-switcher-backdrop"></div>
<div id="cfsm-theme-switcher-panel">${panelItems}</div>
<script>
(function(){
  var btn=document.getElementById('cfsm-theme-switcher-btn');
  var controls=document.getElementById('cfsm-theme-switcher-controls');
  var wrap=document.getElementById('cfsm-theme-switcher');
  var panel=document.getElementById('cfsm-theme-switcher-panel');
  var backdrop=document.getElementById('cfsm-theme-switcher-backdrop');
  if(!btn||!controls||!panel)return;
  function applyTheme(id){
    var secure=location.protocol==='https:'?'; Secure':'';
    document.cookie='${PUBLIC_THEME_COOKIE}='+encodeURIComponent(id||'')+'; Max-Age=${PUBLIC_THEME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax'+secure;
    location.reload();
  }
  function isMobilePanel(){
    return window.matchMedia('(max-width: 720px)').matches;
  }
  function positionPanel(){
    if(isMobilePanel()){
      panel.classList.add('is-centered');
      panel.style.left='50%';
      panel.style.right='auto';
      panel.style.top='50%';
      panel.style.transform='translate(-50%,-50%)';
      panel.style.webkitTransform='translate(-50%,-50%)';
      return;
    }
    panel.classList.remove('is-centered');
    panel.style.transform='';
    panel.style.webkitTransform='';
    var rect=btn.getBoundingClientRect();
    var top=rect.bottom+8;
    var estimated=Math.min(panel.scrollHeight||360, Math.min(window.innerHeight*0.7,360));
    if(top+estimated>window.innerHeight-8){
      top=Math.max(8, rect.top-8-estimated);
    }
    panel.style.top=top+'px';
    panel.style.right=Math.max(8, window.innerWidth-rect.right)+'px';
    panel.style.left='auto';
  }
  function closePanel(){
    panel.classList.remove('is-open');
    if(backdrop)backdrop.classList.remove('is-open');
  }
  function togglePanel(event){
    event.preventDefault();
    event.stopPropagation();
    if(panel.classList.contains('is-open')){
      closePanel();
      return;
    }
    positionPanel();
    panel.classList.add('is-open');
    if(backdrop&&isMobilePanel())backdrop.classList.add('is-open');
  }
  btn.addEventListener('click', togglePanel);
  if(backdrop){
    backdrop.addEventListener('click', function(event){
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    });
  }
  panel.addEventListener('click', function(event){
    var item=event.target.closest('[data-theme-id]');
    if(!item)return;
    applyTheme(item.getAttribute('data-theme-id')||'');
  });
  document.addEventListener('click', function(event){
    if(!panel.classList.contains('is-open'))return;
    if(btn.contains(event.target)||panel.contains(event.target))return;
    closePanel();
  });
  window.addEventListener('resize', function(){
    if(panel.classList.contains('is-open'))positionPanel();
    if(controls.dataset.placed!=='1')pinLeft();
  });
  function isOwn(el){
    return !el||el===btn||el===controls||el===wrap||el===panel||el===backdrop||(wrap&&wrap.contains(el))||(panel&&panel.contains(el))||(controls&&controls.contains(el));
  }
  function topRightIcons(){
    var nodes=document.querySelectorAll('a,button,[data-slot="button"],.nav-icon-button,.title-btn');
    var vw=window.innerWidth;
    var items=[];
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i];
      if(isOwn(el))continue;
      var r=el.getBoundingClientRect();
      if(r.width<8||r.height<8||r.width>120||r.height>72)continue;
      if(r.top<0||r.top>120||r.bottom<4)continue;
      if(r.left<vw*0.35)continue;
      items.push({el:el,rect:r,parent:el.parentElement});
    }
    items.sort(function(a,b){return a.rect.left-b.rect.left;});
    return items;
  }
  function bestCluster(items){
    if(!items.length)return null;
    var groups=[];
    for(var i=0;i<items.length;i++){
      var parent=items[i].parent;
      var group=null;
      for(var g=0;g<groups.length;g++){
        if(groups[g].parent===parent){group=groups[g];break;}
      }
      if(!group){
        group={parent:parent,items:[]};
        groups.push(group);
      }
      group.items.push(items[i]);
    }
    groups.sort(function(a,b){return b.items.length-a.items.length;});
    var cluster=groups[0].items.slice().sort(function(a,b){return a.rect.left-b.rect.left;});
    return {
      parent:cluster[0].parent,
      first:cluster[0].el,
      left:cluster[0].rect.left,
      top:cluster[0].rect.top,
      height:cluster[0].rect.height
    };
  }
  function pinLeft(){
    if(!wrap||controls.dataset.placed==='1')return;
    var cluster=bestCluster(topRightIcons());
    wrap.classList.add('is-fallback');
    wrap.style.visibility='visible';
    wrap.style.pointerEvents='auto';
    wrap.style.position='fixed';
    wrap.style.right='auto';
    var size=Math.max(22, Math.round(cluster&&cluster.height?cluster.height:36));
    if(cluster){
      restyleButton(cluster.first);
      wrap.style.top=Math.max(0, cluster.top+(cluster.height-size)/2)+'px';
      wrap.style.left=Math.max(8, cluster.left-8-size)+'px';
      return;
    }
    wrap.style.top='13px';
    wrap.style.left='auto';
    wrap.style.right='16px';
  }
  function iconCandidate(el){
    if(!el||isOwn(el))return false;
    var tag=(el.tagName||'').toLowerCase();
    if(tag!=='button'&&tag!=='a')return false;
    var r=el.getBoundingClientRect();
    return r.width>=18&&r.width<=64&&r.height>=18&&r.height<=64;
  }
  function skipCopiedClass(name){
    return !name||name==='is-active'||name==='control-toggle'||name==='floating-controls-refresh'||name.indexOf('is-refresh-')===0;
  }
  function restyleButton(from){
    var sibling=from;
    if(!iconCandidate(sibling)&&from&&from.querySelector){
      var nodes=from.querySelectorAll('a,button');
      sibling=null;
      for(var i=0;i<nodes.length;i++){
        if(iconCandidate(nodes[i])){sibling=nodes[i];break;}
      }
    }
    if(!sibling)return;
    var cls=sibling.className;
    if(cls&&typeof cls==='object')cls=cls.baseVal||'';
    cls=String(cls||'').split(' ').filter(function(c){return !skipCopiedClass(c);}).join(' ');
    if(cls) btn.className=cls;
    var cs=window.getComputedStyle(sibling);
    var w=parseFloat(cs.width);
    var h=parseFloat(cs.height);
    var radius=cs.borderRadius||cs.borderTopLeftRadius||'999px';
    var borderWidth=cs.borderTopWidth||'1px';
    var borderStyle=cs.borderTopStyle&&cs.borderTopStyle!=='none'?cs.borderTopStyle:'solid';
    var borderColor=cs.borderTopColor&&cs.borderTopColor!=='rgba(0, 0, 0, 0)'&&cs.borderTopColor!=='transparent'?cs.borderTopColor:'rgba(128,128,128,.5)';
    var bg=cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'&&cs.backgroundColor!=='transparent'?cs.backgroundColor:'rgba(128,128,128,.14)';
    btn.style.setProperty('-webkit-appearance','none');
    btn.style.setProperty('appearance','none');
    if(w>=18&&h>=18){
      btn.style.setProperty('width',w+'px');
      btn.style.setProperty('height',h+'px');
      btn.style.setProperty('min-width',w+'px');
      btn.style.setProperty('min-height',h+'px');
    }
    btn.style.setProperty('border-radius',radius);
    btn.style.setProperty('border-width',borderWidth);
    btn.style.setProperty('border-style',borderStyle);
    btn.style.setProperty('border-color',borderColor);
    btn.style.setProperty('background-color',bg);
    btn.style.setProperty('color',cs.color);
    if(cs.boxShadow) btn.style.setProperty('box-shadow',cs.boxShadow);
    var blur=cs.backdropFilter||cs.webkitBackdropFilter;
    if(blur&&blur!=='none'){
      btn.style.setProperty('backdrop-filter',blur);
      btn.style.setProperty('-webkit-backdrop-filter',blur);
    }
    btn.setAttribute('data-themed','1');
  }
  function place(){
    if(btn.dataset.placed==='1')return true;
    var cluster=bestCluster(topRightIcons());
    if(!cluster||!cluster.parent||!cluster.first){
      pinLeft();
      return false;
    }
    cluster.parent.insertBefore(btn, cluster.first);
    restyleButton(cluster.first);
    btn.dataset.placed='1';
    controls.dataset.placed='1';
    if(wrap)wrap.style.display='none';
    return true;
  }
  place();
  var obs=new MutationObserver(function(){
    if(place())obs.disconnect();
  });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(function(){
    obs.disconnect();
    if(controls.dataset.placed!=='1')pinLeft();
  },8000);
})();
</script>`;

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${widget}\n</body>`);
  }
  return `${html}\n${widget}`;
}

async function checkPreviewAuth(request, env, settings) {
  const token = getCookie(request, PREVIEW_AUTH_COOKIE);
  if (!token) return false;

  try {
    const authRequest = {
      headers: {
        get: (key) => {
          if (String(key).toLowerCase() === 'authorization') {
            return `Bearer ${decodeURIComponent(token)}`;
          }
          return request.headers.get(key);
        }
      }
    };
    return await checkAuth(authRequest, env, settings);
  } catch (_) {
    return false;
  }
}

function getPreviewThemeUrlFromQuery(url) {
  if (!url.searchParams.has('theme_url')) return '';
  return normalizeThemeUrl(url.searchParams.get('theme_url'));
}

function normalizeAssetPath(pathname) {
  const raw = pathname.slice('/assets/'.length);
  if (!raw) return '';

  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('\\')) return '';
    const parts = decoded.split('/').filter(Boolean);
    if (parts.length === 0 || parts.some(part => part === '.' || part === '..')) return '';
    return parts.map(part => encodeURIComponent(part)).join('/');
  } catch (_) {
    return '';
  }
}

function normalizeThemeAssetUrls(html) {
  return html.replace(/\b(src|href)=(["'])\.?\/?assets\//gi, '$1=$2/assets/');
}

function stripBrowserCacheHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('Cache-Control');
  headers.delete('CDN-Cache-Control');
  headers.delete('Pragma');
  headers.delete('Expires');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchWithCache(rawUrl, contentType, workerCacheUrl, workerCacheTtl = THEME_ASSET_CACHE_TTL_SECONDS) {
  const cacheKey = new Request(workerCacheUrl || rawUrl, { method: 'GET' });
  const cache = typeof caches !== 'undefined' ? caches.default : null;

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return stripBrowserCacheHeaders(cached);
    }
  }

  const originResponse = await fetch(rawUrl, {
    headers: { 'User-Agent': 'CFSM-Theme-Proxy' }
  });

  if (!originResponse.ok) {
    return new Response('Theme file not found', {
      status: originResponse.status,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', `public, max-age=${workerCacheTtl}`);
  headers.set('CDN-Cache-Control', `public, max-age=${workerCacheTtl}`);
  headers.set('X-Content-Type-Options', 'nosniff');

  const etag = originResponse.headers.get('ETag');
  if (etag) headers.set('ETag', etag);

  const response = new Response(originResponse.body, {
    status: 200,
    headers
  });

  if (cache) {
    await cache.put(cacheKey, response.clone()).catch(() => {});
  }

  return stripBrowserCacheHeaders(response);
}

async function serveThemeAsset(request, themeUrl) {
  const parsedTheme = parseThemeUrl(themeUrl);
  const url = new URL(request.url);
  const assetPath = normalizeAssetPath(url.pathname);

  if (!parsedTheme || !assetPath) {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        'X-CFSM-Theme-Asset': '1'
      }
    });
  }

  const contentType = getContentType(assetPath);
  const response = await fetchWithCache(
    `${parsedTheme.rawBase}/assets/${assetPath}`,
    contentType,
    `${parsedTheme.cacheBase}/assets/${assetPath}`,
    getThemeWorkerCacheTtl(parsedTheme)
  );
  const headers = new Headers(response.headers);
  headers.set('X-CFSM-Theme-Asset', '1');
  if (response.ok) {
    headers.set('Cache-Control', getThemeAssetBrowserCacheControl(parsedTheme));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function loadThemeIndex(themeUrl) {
  const parsedTheme = parseThemeUrl(themeUrl);
  if (!parsedTheme) return null;

  const response = await fetchWithCache(
    `${parsedTheme.rawBase}/index.html`,
    'text/html;charset=UTF-8',
    `${parsedTheme.cacheBase}/index.html`,
    getThemeWorkerCacheTtl(parsedTheme)
  );

  if (!response.ok) return null;
  return normalizeThemeAssetUrls(await response.text());
}

function buildHtmlResponse(html, settings, request, env = {}, previewThemeUrl = '', switcher = null) {
  const rendered = injectAppearanceSettings(html, settings, env);
  const pageHtml = switcher
    ? injectThemeSwitcher(rendered.html, switcher.catalog, switcher.selectedId)
    : rendered.html;
  const headers = new Headers({
    'Content-Type': 'text/html;charset=UTF-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': rendered.csp
  });

  if (previewThemeUrl) {
    headers.append('Set-Cookie', buildPreviewCookie(request, previewThemeUrl));
  } else if (getPreviewThemeUrlFromCookie(request)) {
    headers.append('Set-Cookie', buildClearPreviewCookie(request));
  }

  return new Response(pageHtml, { headers });
}

function buildThemeIndexErrorResponse() {
  return new Response('Theme index.html is unavailable', {
    status: 502,
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function buildPreviewUnauthorizedResponse(request, isAsset = false) {
  const headers = new Headers({
    'Content-Type': 'text/plain;charset=UTF-8',
    'X-Content-Type-Options': 'nosniff',
    'Set-Cookie': buildClearPreviewCookie(request)
  });

  if (isAsset) {
    headers.set('X-CFSM-Theme-Asset', '1');
  }

  return new Response('Theme preview requires admin login', {
    status: 401,
    headers
  });
}

function buildPublicThemeCookie(request, themeId) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  if (!themeId) {
    return `${PUBLIC_THEME_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
  }
  return `${PUBLIC_THEME_COOKIE}=${encodeURIComponent(themeId)}; Max-Age=${PUBLIC_THEME_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function redirectPublicThemePick(url, cookie) {
  url.searchParams.delete('cfsm_theme');
  const search = url.searchParams.toString();
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${url.pathname}${search ? `?${search}` : ''}` || '/',
      'Set-Cookie': cookie
    }
  });
}

function resolveThemeUrlForPage(request, settings, catalog = []) {
  const url = new URL(request.url);
  const queryThemeUrl = getPreviewThemeUrlFromQuery(url);
  if (queryThemeUrl) {
    return { themeUrl: queryThemeUrl, preview: true };
  }

  const cookieThemeUrl = getPreviewThemeUrlFromCookie(request);
  if (cookieThemeUrl) {
    return { themeUrl: cookieThemeUrl, preview: true };
  }

  const publicThemeId = getPublicThemeIdFromCookie(request, catalog);
  if (publicThemeId) {
    const resolved = resolvePublicThemeUrl(publicThemeId, catalog);
    return { themeUrl: resolved.themeUrl, preview: false };
  }

  return {
    themeUrl: normalizeThemeUrl(settings?.theme_url),
    preview: false
  };
}

function shouldUseBuiltinFrontend(path) {
  return path === '/admin' || path.startsWith('/admin/');
}

export async function serveFrontend(request, env, settings = null) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (!settings) {
    settings = await loadSettings(env.DB);
  }

  if (
    request.method === 'GET' &&
    url.searchParams.has('cfsm_theme') &&
    !path.startsWith('/assets/') &&
    !shouldUseBuiltinFrontend(path)
  ) {
    const catalog = await getPublicThemeCatalog();
    const raw = String(url.searchParams.get('cfsm_theme') || '').trim();
    const themeId = raw === 'builtin' ? 'builtin' : resolvePublicThemeId(raw, catalog);
    return redirectPublicThemePick(url, buildPublicThemeCookie(request, themeId));
  }

  const catalog = await getPublicThemeCatalog();
  const publicThemeId = getPublicThemeIdFromCookie(request, catalog);
  const switcher = { catalog, selectedId: publicThemeId };

  if (request.method === 'GET' && path.startsWith('/assets/')) {
    const resolvedTheme = resolveThemeUrlForPage(request, settings, catalog);
    if (!resolvedTheme.themeUrl) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
    if (resolvedTheme.preview && !await checkPreviewAuth(request, env, settings)) {
      return buildPreviewUnauthorizedResponse(request, true);
    }
    return serveThemeAsset(request, resolvedTheme.themeUrl);
  }

  const previewThemeUrl = getPreviewThemeUrlFromQuery(url);
  const pageTheme = resolveThemeUrlForPage(request, settings, catalog);
  const effectiveThemeUrl = previewThemeUrl || pageTheme.themeUrl;

  if (previewThemeUrl && !await checkPreviewAuth(request, env, settings)) {
    return buildPreviewUnauthorizedResponse(request);
  }

  if (!shouldUseBuiltinFrontend(path) && effectiveThemeUrl) {
    const themeHtml = await loadThemeIndex(effectiveThemeUrl);
    if (themeHtml) {
      return buildHtmlResponse(themeHtml, settings, request, env, previewThemeUrl, switcher);
    }
    return buildThemeIndexErrorResponse();
  }

  const files = await loadFrontendFiles(env);
  const html = files['dashboard.html'];

  if (html) {
    return buildHtmlResponse(html, settings, request, env, previewThemeUrl, null);
  }

  return new Response('Frontend not available. Please build the frontend first with `npm run build:frontend`.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
  });
}
