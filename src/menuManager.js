import {
  deleteMenuEntity,
  getMenuUser,
  loadMenuSections,
  loadMenuSettings,
  loginMenuWithGoogle,
  loginMenuWithPassword,
  logoutMenuUser,
  observeMenuUser,
  saveMenuEntity,
  saveMenuSettings,
  setMenuEntityHidden
} from './menuManagerFirebase.js';

const GROUPS = [
  ['poffertjes', 'Poffertjes'],
  ['cafe', 'Café'],
  ['desayunos', 'Desayunos'],
  ['bebidas', 'Bebidas']
];
const ADMIN_UID = import.meta.env.VITE_MENU_FIREBASE_ADMIN_UID || '8sSVQe3BKJVu7QiPrYF9gTrPrtG2';
const MENU_ASSET_BASE = 'https://esenciacafe.github.io/EsenciaMenu/';
const IMAGES_URL = `${MENU_ASSET_BASE}assets/popup/images.json`;

const state = {
  user: undefined,
  sections: [],
  settings: {},
  images: [],
  loading: false,
  loaded: false,
  error: '',
  query: '',
  group: 'all',
  hiddenOnly: false
};
let unsubscribeAuth;
let notify = () => {};
let toast = () => {};

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const slug = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^\w]+/g, '-').replace(/(^-|-$)/g, '');

function groupId(section) {
  const value = slug(section.group || section.title || section.id);
  if (/^poff/.test(value)) return 'poffertjes';
  if (/^caf/.test(value)) return 'cafe';
  if (/^desayun/.test(value)) return 'desayunos';
  if (/^bebid/.test(value)) return 'bebidas';
  return value || 'otros';
}

function normalizePromoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || (raw.includes('github.com') && raw.includes('/tree/'))) return '';
  if (raw.includes('github.com') && raw.includes('/blob/')) {
    return raw.replace('https://github.com/EsenciaCafe/EsenciaMenu/blob/main/', '').replace(/^\/+/, '');
  }
  return raw.replace(/^\/+/, '');
}

function publicAssetUrl(value) {
  const normalized = normalizePromoUrl(value);
  return /^https?:\/\//i.test(normalized) ? normalized : `${MENU_ASSET_BASE}${normalized}`;
}

async function refreshAll() {
  if (!state.user) return;
  state.loading = true;
  state.error = '';
  notify();
  try {
    const [sections, settings, imagesResponse] = await Promise.all([
      loadMenuSections(),
      loadMenuSettings(),
      fetch(`${IMAGES_URL}?v=${Date.now()}`, { cache: 'no-store' }).catch(() => null)
    ]);
    state.sections = sections;
    state.settings = settings;
    state.images = imagesResponse?.ok ? await imagesResponse.json() : [];
    state.loaded = true;
  } catch (error) {
    console.error('[Menu Manager]', error);
    state.error = error.message || 'No se pudo cargar Menu Manager.';
  } finally {
    state.loading = false;
    notify();
  }
}

export function initMenuManager(onChange, showToast) {
  notify = onChange;
  toast = showToast;
  if (unsubscribeAuth) return;
  unsubscribeAuth = true;
  observeMenuUser(user => {
      state.user = user;
      if (user) refreshAll();
      else {
        state.loaded = false;
        state.sections = [];
        state.settings = {};
        notify();
      }
    })
    .then(unsubscribe => { unsubscribeAuth = unsubscribe; })
    .catch(error => {
      state.user = null;
      state.error = error.message || 'No se pudo iniciar Firebase.';
      notify();
    });
}

function authView() {
  return `
    <div class="menu-manager-auth settings-editor-container">
      <div class="menu-manager-icon">M</div>
      <h3>Conectar con Esencia Menu</h3>
      <p class="gemini-muted">Inicia sesión con la cuenta autorizada para gestionar el menú público.</p>
      <form id="menu-manager-login-form" class="menu-manager-login-form">
        <input id="menu-manager-email" type="email" autocomplete="username" placeholder="Correo electrónico" required>
        <input id="menu-manager-password" type="password" autocomplete="current-password" placeholder="Contraseña" required>
        <button class="btn btn-primary" type="submit">Entrar</button>
      </form>
      <div class="menu-manager-divider"><span>o</span></div>
      <button class="btn btn-secondary" id="menu-manager-google-login" type="button">Continuar con Google</button>
    </div>`;
}

export function renderMenuManagerHome(chevron) {
  return `
    <div class="view-container">
      <div class="settings-nav-header">
        <button class="settings-back-arrow-btn" id="settings-back-btn">← Ajustes</button>
      </div>
      <div class="menu-manager-heading">
        <div><h2 class="settings-nav-title">Menu Manager</h2><p>Gestiona lo que ve el cliente sin salir del TPV.</p></div>
        ${state.user ? `<span class="menu-manager-user">${escapeHtml(state.user.email || 'Sesión activa')}</span>` : ''}
      </div>
      <div class="settings-tree-list">
        <button class="settings-tree-item" id="settings-to-menu-availability">
          <span><strong>Disponibilidad</strong><small>Secciones, artículos y toppings del menú público</small></span>${chevron}
        </button>
        <button class="settings-tree-item" id="settings-to-menu-promos">
          <span><strong>Promos</strong><small>Estado, imagen y vista previa de la promoción</small></span>${chevron}
        </button>
      </div>
    </div>`;
}

function shell(title, body, backLabel = 'Menu Manager') {
  return `
    <div class="view-container menu-manager-view">
      <div class="settings-nav-header">
        <button class="settings-back-arrow-btn" id="settings-back-btn">← ${backLabel}</button>
        ${state.user ? `<button class="btn btn-secondary" id="menu-manager-logout">Cerrar sesión</button>` : ''}
      </div>
      <h2 class="settings-nav-title">${title}</h2>
      ${state.user === undefined || state.loading ? '<div class="menu-manager-loading">Cargando…</div>' : ''}
      ${state.user === null ? authView() : body}
    </div>`;
}

function visibilitySwitch(type, sectionId, entity) {
  return `<button class="menu-visibility-toggle ${entity.hidden ? 'is-hidden' : 'is-visible'}"
    data-menu-toggle="${type}" data-section-id="${escapeHtml(sectionId)}" data-entity-id="${escapeHtml(entity.id)}"
    data-next-hidden="${entity.hidden ? 'false' : 'true'}">
    <span></span>${entity.hidden ? 'Oculto' : 'Visible'}
  </button>`;
}

function entityActions(type, sectionId, entity) {
  return `<div class="menu-manager-actions">
    <button class="btn btn-secondary" data-menu-edit="${type}" data-section-id="${escapeHtml(sectionId)}" data-entity-id="${escapeHtml(entity.id)}">Editar</button>
    <button class="btn btn-secondary menu-danger-btn" data-menu-delete="${type}" data-section-id="${escapeHtml(sectionId)}" data-entity-id="${escapeHtml(entity.id)}">Eliminar</button>
  </div>`;
}

export function renderMenuAvailability() {
  if (!state.user) return shell('Disponibilidad', '');
  const query = state.query.toLowerCase().trim();
  const hiddenItems = state.sections.flatMap(section =>
    (section.items || []).filter(item => item.hidden).map(item => ({ ...item, section }))
  ).filter(item => !query || [item.name, item.name_en, item.section.title]
    .some(value => String(value || '').toLowerCase().includes(query)));
  const sections = state.sections.filter(section => {
    if (state.group !== 'all' && groupId(section) !== state.group) return false;
    if (!query) return true;
    return [section.title, section.title_en, ...(section.items || []).flatMap(item => [item.name, item.name_en])]
      .some(value => String(value || '').toLowerCase().includes(query));
  });
  const cards = sections.map(section => `
    <section class="menu-section-card ${section.hidden ? 'is-muted' : ''}">
      <header>
        <div>
          <span class="menu-manager-eyebrow">${escapeHtml(section.group || groupId(section))}</span>
          <h3>${escapeHtml(section.title || section.id)}</h3>
          <small>${section.items?.length || 0} artículos · ${section.toppings?.length || 0} toppings</small>
        </div>
        <div class="menu-manager-header-actions">
          ${visibilitySwitch('section', section.id, section)}
          ${entityActions('section', section.id, section)}
        </div>
      </header>
      <div class="menu-manager-subheading"><span>Artículos</span><button class="btn btn-secondary" data-menu-add="item" data-section-id="${escapeHtml(section.id)}">+ Añadir</button></div>
      <div class="menu-entity-list">
        ${(section.items || []).sort((a,b) => Number(a.order||9999)-Number(b.order||9999)).map(item => `
          <div class="menu-entity-row ${item.hidden ? 'is-muted' : ''}">
            <div><strong>${escapeHtml(item.name || 'Sin nombre')}</strong><small>${escapeHtml(item.name_en || '')}${item.price !== undefined ? ` · ${escapeHtml(item.price)} €` : ''}</small></div>
            ${visibilitySwitch('item', section.id, item)}
            ${entityActions('item', section.id, item)}
          </div>`).join('') || '<p class="menu-manager-empty">Sin artículos.</p>'}
      </div>
      <details class="menu-toppings-details" data-menu-toppings-section="${escapeHtml(section.id)}">
        <summary>Toppings (${section.toppings?.length || 0})</summary>
        <div class="menu-manager-subheading"><span>Opciones adicionales</span><button class="btn btn-secondary" data-menu-add="topping" data-section-id="${escapeHtml(section.id)}">+ Añadir</button></div>
        <div class="menu-entity-list">
          ${(section.toppings || []).sort((a,b) => Number(a.order||9999)-Number(b.order||9999)).map(item => `
            <div class="menu-entity-row ${item.hidden ? 'is-muted' : ''}">
              <div><strong>${escapeHtml(item.name || 'Sin nombre')}</strong><small>${escapeHtml(item.name_en || '')}${item.price !== undefined ? ` · ${escapeHtml(item.price)} €` : ''}</small></div>
              ${visibilitySwitch('topping', section.id, item)}
              ${entityActions('topping', section.id, item)}
            </div>`).join('') || '<p class="menu-manager-empty">Sin toppings.</p>'}
        </div>
      </details>
    </section>`).join('');
  return shell('Disponibilidad', `
    ${state.error ? `<div class="menu-manager-error">${escapeHtml(state.error)}</div>` : ''}
    <div class="menu-manager-toolbar">
      <input id="menu-manager-search" type="search" value="${escapeHtml(state.query)}" placeholder="Buscar sección o artículo…">
      <select id="menu-manager-group">
        <option value="all">Todas las categorías</option>
        ${GROUPS.map(([id,label]) => `<option value="${id}" ${state.group === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <button class="btn btn-primary" data-menu-add="section">+ Sección</button>
      <button class="btn btn-secondary" id="menu-manager-nav-labels">Nombres de categorías</button>
      <button class="btn btn-secondary" id="menu-manager-refresh">Actualizar</button>
    </div>
    <div class="menu-manager-quick-grid">
      <button class="menu-manager-quick-btn ${state.hiddenOnly ? 'is-active' : ''}" id="menu-manager-hidden-items">
        <strong>${hiddenItems.length}</strong>
        <span>Artículos ocultos</span>
      </button>
      <button class="menu-manager-quick-btn ${!state.hiddenOnly && state.group === 'all' ? 'is-active' : ''}" data-menu-group-quick="all">
        <strong>${state.sections.reduce((total, section) => total + (section.items?.length || 0), 0)}</strong>
        <span>Todos</span>
      </button>
      ${GROUPS.map(([id, label]) => {
        const count = state.sections.filter(section => groupId(section) === id)
          .reduce((total, section) => total + (section.items?.length || 0), 0);
        return `<button class="menu-manager-quick-btn ${!state.hiddenOnly && state.group === id ? 'is-active' : ''}" data-menu-group-quick="${id}">
          <strong>${count}</strong><span>${label}</span>
        </button>`;
      }).join('')}
    </div>
    <div class="menu-manager-summary">
      ${state.hiddenOnly
        ? `<strong>${hiddenItems.length}</strong> artículos ocultos · pulsa “Oculto” para volver a mostrarlos`
        : `<strong>${state.sections.length}</strong> secciones · <strong>${state.sections.reduce((total, section) => total + (section.items?.length || 0), 0)}</strong> artículos`}
    </div>
    ${state.hiddenOnly ? `
      <div class="menu-hidden-items-panel">
        ${hiddenItems.map(item => `
          <div class="menu-entity-row is-muted">
            <div>
              <strong>${escapeHtml(item.name || 'Sin nombre')}</strong>
              <small>${escapeHtml(item.section.title || item.section.id)}${item.name_en ? ` · ${escapeHtml(item.name_en)}` : ''}</small>
            </div>
            ${visibilitySwitch('item', item.section.id, item)}
            ${entityActions('item', item.section.id, item)}
          </div>
        `).join('') || '<div class="menu-manager-empty">No hay artículos ocultos.</div>'}
      </div>
    ` : `<div class="menu-section-list">${cards || '<div class="menu-manager-empty">No hay resultados.</div>'}</div>`}
  `);
}

export function renderMenuPromos() {
  if (!state.user) return shell('Promos', '');
  const image = normalizePromoUrl(state.settings.promo_image_url);
  return shell('Promos', `
    <div class="menu-promo-grid">
      <form id="menu-promo-form" class="settings-editor-container menu-promo-form">
        <div class="menu-promo-status-row">
          <div><h3>Estado de la promo</h3><p class="gemini-muted">Controla el popup que aparece en el menú del cliente.</p></div>
          <label class="menu-switch"><input id="menu-promo-enabled" type="checkbox" ${state.settings.promo_enabled ? 'checked' : ''}><span></span></label>
        </div>
        <label>Imagen promocional
          <input id="menu-promo-url" value="${escapeHtml(image)}" placeholder="assets/popup/imagen.webp" required>
        </label>
        <p class="gemini-muted">Al guardar se genera una versión nueva para que el cliente vuelva a verla.</p>
        <div class="menu-manager-actions">
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
          <button class="btn btn-secondary" id="menu-manager-refresh" type="button">Recargar</button>
        </div>
      </form>
      <div class="settings-editor-container menu-promo-preview">
        <h3>Vista previa</h3>
        ${image ? `<img src="${escapeHtml(publicAssetUrl(image))}?v=${Date.now()}" alt="Vista previa de la promoción">` : '<div class="menu-manager-empty">Selecciona una imagen.</div>'}
      </div>
    </div>
    <div class="settings-editor-container menu-promo-gallery-wrap">
      <h3>Imágenes disponibles</h3>
      <div class="menu-promo-gallery">
        ${state.images.map(file => {
          const value = String(file).startsWith('http') ? String(file) : `assets/popup/${file}`;
          return `<button class="menu-promo-thumb ${normalizePromoUrl(value) === image ? 'is-selected' : ''}" data-promo-image="${escapeHtml(value)}">
            <img src="${escapeHtml(publicAssetUrl(value))}?v=${Date.now()}" loading="lazy" alt="${escapeHtml(file)}"><span>${escapeHtml(file)}</span>
          </button>`;
        }).join('') || '<div class="menu-manager-empty">No se pudo cargar la galería.</div>'}
      </div>
    </div>
  `);
}

function findEntity(type, sectionId, entityId) {
  const section = state.sections.find(item => item.id === sectionId);
  if (type === 'section') return section;
  return section?.[type === 'item' ? 'items' : 'toppings']?.find(item => item.id === entityId);
}

function openEntityDialog(type, sectionId, entityId) {
  const entity = findEntity(type, sectionId, entityId) || {};
  const isSection = type === 'section';
  const overlay = document.createElement('div');
  overlay.className = 'menu-manager-dialog-overlay';
  overlay.innerHTML = `
    <form class="menu-manager-dialog">
      <header><h3>${entityId ? 'Editar' : 'Crear'} ${isSection ? 'sección' : type === 'item' ? 'artículo' : 'topping'}</h3><button type="button" data-dialog-close>×</button></header>
      ${isSection && !entityId ? `<label>Identificador<input name="id" value="" placeholder="ej. cafes-especiales" required></label>` : ''}
      ${isSection ? `
        <label>Grupo<input name="group" value="${escapeHtml(entity.group || 'Café')}" required></label>
        <label>Título (ES)<input name="title" value="${escapeHtml(entity.title || '')}" required></label>
        <label>Título (EN)<input name="title_en" value="${escapeHtml(entity.title_en || '')}"></label>
        <label>Subtítulo (ES)<input name="subtitle" value="${escapeHtml(entity.subtitle || '')}"></label>
        <label>Subtítulo (EN)<input name="subtitle_en" value="${escapeHtml(entity.subtitle_en || '')}"></label>
        <label>Nota (ES)<textarea name="note">${escapeHtml(entity.note || '')}</textarea></label>
        <label>Nota (EN)<textarea name="note_en">${escapeHtml(entity.note_en || '')}</textarea></label>
        <label class="menu-dialog-check"><input name="base_enable" type="checkbox" ${entity.base_enable ? 'checked' : ''}> Mostrar producto base</label>
        <label>Producto base (ES)<input name="base_title" value="${escapeHtml(entity.base_title || '')}"></label>
        <label>Producto base (EN)<input name="base_title_en" value="${escapeHtml(entity.base_title_en || '')}"></label>
        <label>Descripción base (ES)<textarea name="base_desc">${escapeHtml(entity.base_desc || '')}</textarea></label>
        <label>Descripción base (EN)<textarea name="base_desc_en">${escapeHtml(entity.base_desc_en || '')}</textarea></label>
        <label>Precio base<input name="base_price" type="number" step="0.01" value="${escapeHtml(entity.base_price ?? '')}"></label>
      ` : `
        <label>Nombre (ES)<input name="name" value="${escapeHtml(entity.name || '')}" required></label>
        <label>Nombre (EN)<input name="name_en" value="${escapeHtml(entity.name_en || '')}"></label>
        ${type === 'item' ? `<label>Descripción (ES)<textarea name="desc">${escapeHtml(entity.desc || '')}</textarea></label><label>Descripción (EN)<textarea name="desc_en">${escapeHtml(entity.desc_en || '')}</textarea></label>` : ''}
        <label>Precio<input name="price" type="number" step="0.01" value="${escapeHtml(entity.price ?? '')}"></label>
      `}
      <label>Orden<input name="order" type="number" value="${escapeHtml(entity.order ?? 1)}"></label>
      <label class="menu-dialog-check"><input name="hidden" type="checkbox" ${entity.hidden ? 'checked' : ''}> Oculto en el menú</label>
      <footer><button class="btn btn-secondary" type="button" data-dialog-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></footer>
    </form>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-dialog-close]').forEach(button => button.onclick = () => overlay.remove());
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    values.order = Number(values.order || 9999);
    values.hidden = form.get('hidden') === 'on';
    if (isSection) {
      values.base_enable = form.get('base_enable') === 'on';
      values.base_price = values.base_price === '' ? '' : Number(values.base_price);
    }
    if ('price' in values) values.price = values.price === '' ? '' : Number(values.price);
    try {
      await saveMenuEntity(type, sectionId, entityId, values);
      overlay.remove();
      toast('Cambios guardados en el menú público.', 'success');
      await refreshAll();
    } catch (error) {
      toast(error.message || 'No se pudo guardar.', 'error');
    }
  });
}

function openNavLabelsDialog() {
  const current = state.settings.nav_labels || {};
  const overlay = document.createElement('div');
  overlay.className = 'menu-manager-dialog-overlay';
  overlay.innerHTML = `
    <form class="menu-manager-dialog">
      <header><h3>Nombres de categorías</h3><button type="button" data-dialog-close>×</button></header>
      ${GROUPS.map(([id, label]) => `
        <label>${label} (ES)<input name="${id}_es" value="${escapeHtml(current[id]?.es || label)}"></label>
        <label>${label} (EN)<input name="${id}_en" value="${escapeHtml(current[id]?.en || '')}"></label>
      `).join('')}
      <footer><button class="btn btn-secondary" type="button" data-dialog-close>Cancelar</button><button class="btn btn-primary" type="submit">Guardar</button></footer>
    </form>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('[data-dialog-close]').forEach(button => button.onclick = () => overlay.remove());
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  overlay.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const navLabels = Object.fromEntries(GROUPS.map(([id]) => [id, {
      es: String(form.get(`${id}_es`) || '').trim(),
      en: String(form.get(`${id}_en`) || '').trim()
    }]));
    try {
      await saveMenuSettings({ nav_labels: navLabels });
      state.settings.nav_labels = navLabels;
      overlay.remove();
      toast('Nombres de categorías actualizados.', 'success');
      notify();
    } catch (error) { toast(error.message || 'No se pudieron guardar los nombres.', 'error'); }
  });
}

export function bindMenuManager(container, navigate) {
  container.querySelector('#settings-to-menu-availability')?.addEventListener('click', () => navigate(['menu-manager', 'disponibilidad']));
  container.querySelector('#settings-to-menu-promos')?.addEventListener('click', () => navigate(['menu-manager', 'promos']));
  container.querySelector('#menu-manager-login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      await loginMenuWithPassword(
        container.querySelector('#menu-manager-email').value.trim(),
        container.querySelector('#menu-manager-password').value
      );
      toast('Sesión de Esencia Menu iniciada.', 'success');
    } catch (error) {
      toast(error.message || 'No se pudo iniciar sesión.', 'error');
      button.disabled = false;
    }
  });
  container.querySelector('#menu-manager-google-login')?.addEventListener('click', async () => {
    try { await loginMenuWithGoogle(); }
    catch (error) { toast(error.message || 'No se pudo iniciar sesión con Google.', 'error'); }
  });
  container.querySelector('#menu-manager-logout')?.addEventListener('click', () => logoutMenuUser());
  container.querySelector('#menu-manager-refresh')?.addEventListener('click', refreshAll);
  container.querySelector('#menu-manager-nav-labels')?.addEventListener('click', openNavLabelsDialog);
  container.querySelector('#menu-manager-search')?.addEventListener('input', event => {
    state.query = event.target.value;
    window.clearTimeout(event.target._menuTimer);
    event.target._menuTimer = window.setTimeout(notify, 180);
  });
  container.querySelector('#menu-manager-group')?.addEventListener('change', event => {
    state.group = event.target.value;
    state.hiddenOnly = false;
    notify();
  });
  container.querySelector('#menu-manager-hidden-items')?.addEventListener('click', () => {
    state.hiddenOnly = !state.hiddenOnly;
    notify();
  });
  container.querySelectorAll('[data-menu-group-quick]').forEach(button => button.addEventListener('click', () => {
    state.group = button.dataset.menuGroupQuick;
    state.hiddenOnly = false;
    notify();
  }));
  container.querySelectorAll('[data-menu-toggle]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await setMenuEntityHidden(
        button.dataset.menuToggle,
        button.dataset.sectionId,
        button.dataset.entityId || null,
        button.dataset.nextHidden === 'true'
      );
      toast(button.dataset.nextHidden === 'true' ? 'Elemento ocultado.' : 'Elemento visible.', 'success');
      await refreshAll();
    } catch (error) {
      toast(error.message || 'No se pudo cambiar la disponibilidad.', 'error');
      button.disabled = false;
    }
  }));
  container.querySelectorAll('[data-menu-add]').forEach(button => button.addEventListener('click', () => {
    openEntityDialog(button.dataset.menuAdd, button.dataset.sectionId || null, null);
  }));
  container.querySelectorAll('[data-menu-edit]').forEach(button => button.addEventListener('click', () => {
    openEntityDialog(button.dataset.menuEdit, button.dataset.sectionId, button.dataset.entityId);
  }));
  container.querySelectorAll('[data-menu-delete]').forEach(button => button.addEventListener('click', async () => {
    const entity = findEntity(button.dataset.menuDelete, button.dataset.sectionId, button.dataset.entityId);
    if (!window.confirm(`¿Eliminar "${entity?.title || entity?.name || 'este elemento'}"? Esta acción afecta al menú público.`)) return;
    try {
      await deleteMenuEntity(button.dataset.menuDelete, button.dataset.sectionId, button.dataset.entityId);
      toast('Elemento eliminado.', 'success');
      await refreshAll();
    } catch (error) { toast(error.message || 'No se pudo eliminar.', 'error'); }
  }));
  container.querySelectorAll('[data-promo-image]').forEach(button => button.addEventListener('click', () => {
    state.settings.promo_image_url = button.dataset.promoImage;
    notify();
  }));
  container.querySelector('#menu-promo-url')?.addEventListener('input', event => {
    state.settings.promo_image_url = event.target.value;
  });
  container.querySelector('#menu-promo-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if ((await getMenuUser())?.uid !== ADMIN_UID) {
      toast('Esta cuenta no tiene permiso para modificar promociones.', 'error');
      return;
    }
    const image = normalizePromoUrl(container.querySelector('#menu-promo-url').value);
    if (!image) {
      toast('Selecciona una imagen válida.', 'error');
      return;
    }
    try {
      await saveMenuSettings({
        promo_enabled: container.querySelector('#menu-promo-enabled').checked,
        promo_image_url: image,
        promo_version: String(Date.now())
      });
      state.settings = await loadMenuSettings();
      toast('Promoción actualizada en el menú público.', 'success');
      notify();
    } catch (error) { toast(error.message || 'No se pudo guardar la promoción.', 'error'); }
  });
}
