const PAGE = document.body.dataset.page === 'admin' ? 'admin' : 'main';

const state = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  query: '',
  originFilterType: 'all',
  customOrigin: '',
  loading: false,
  humanToken: '',
  adminToken: ''
};

const dom = {
  logFeed: document.getElementById('log-feed'),
  loadMore: document.getElementById('load-more'),
  search: document.getElementById('search'),
  toastRoot: document.getElementById('toast-root')
};

function showToast(message, kind = 'info') {
  if (!dom.toastRoot) return;
  const el = document.createElement('div');
  el.className = 'toast';
  if (kind === 'error') {
    el.style.borderColor = 'rgba(255,111,145,0.52)';
  }
  el.textContent = message;
  dom.toastRoot.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 2600);
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLocal(iso) {
  const dt = new Date(iso);
  return dt.toLocaleString();
}

function signalBars(strength) {
  const onCount = Math.max(1, Math.round(strength / 20));
  return `
    <div class="bars" aria-hidden="true">
      ${Array.from({ length: 5 }, (_, i) => `<span class="bar ${i < onCount ? 'on' : ''}"></span>`).join('')}
    </div>
    <span class="signal-text">Signal ${strength}%</span>
  `;
}

function entryTemplate(item, adminMode = false) {
  const callsign = item.callsign || 'Anonymous';
  const origin = item.origin || 'Unknown';

  return `
    <article class="entry" data-id="${item.id}">
      <div class="entry-top">
        <div class="entry-meta">
          <strong>${escapeHtml(callsign)}</strong> @ <strong>${escapeHtml(origin)}</strong><br />
          <span>${escapeHtml(formatLocal(item.created_at))}</span><br />
          <span class="iso">${escapeHtml(item.created_at)}</span>
        </div>
        <div class="signal">
          ${signalBars(item.strength)}
        </div>
      </div>
      <p class="message-text"></p>
      <div class="entry-actions">
        <button class="btn btn-secondary mini-btn" data-action="copy" type="button">Copy</button>
        ${adminMode
          ? '<button class="btn btn-secondary mini-btn" data-action="delete" type="button">Delete</button>'
          : '<button class="btn btn-secondary mini-btn" data-action="report" type="button">Report</button>'}
      </div>
    </article>
  `;
}

function renderItems(adminMode = false) {
  if (!dom.logFeed) return;
  dom.logFeed.innerHTML = state.items.map((item) => entryTemplate(item, adminMode)).join('');
  const blocks = dom.logFeed.querySelectorAll('.entry');
  blocks.forEach((entry, idx) => {
    const textEl = entry.querySelector('.message-text');
    textEl.textContent = state.items[idx].message;
  });

  const empty = document.getElementById('empty-state');
  if (empty) {
    empty.classList.toggle('hidden', state.items.length > 0);
  }

  if (dom.loadMore) {
    dom.loadMore.disabled = state.loading || state.items.length >= state.total;
    dom.loadMore.textContent = state.items.length >= state.total ? 'No more signals' : 'Load more';
  }
}

function originFilterValue() {
  if (state.originFilterType === 'earth') return 'earth';
  if (state.originFilterType === 'unknown') return '__unknown__';
  if (state.originFilterType === 'custom') return state.customOrigin.trim();
  return '';
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

async function loadMessages({ reset = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (reset) state.offset = 0;

  const qs = new URLSearchParams({
    limit: String(state.limit),
    offset: String(state.offset),
    q: state.query,
    origin: originFilterValue()
  });

  try {
    const data = await apiFetch(`/api/messages?${qs.toString()}`);
    state.total = data.total;
    state.items = reset ? data.items : state.items.concat(data.items);
    state.offset = state.items.length;
    renderItems(PAGE === 'admin');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    state.loading = false;
    renderItems(PAGE === 'admin');
  }
}

async function refreshHumanCheck() {
  const questionEl = document.getElementById('human-question');
  if (!questionEl) return;

  try {
    const data = await apiFetch('/api/human-check');
    state.humanToken = data.token;
    questionEl.textContent = data.question;
  } catch {
    questionEl.textContent = 'Challenge unavailable';
    showToast('Could not load human challenge.', 'error');
  }
}

function validateMessageClient(message) {
  const trimmed = message.trim();
  if (!trimmed) return 'Message is required.';
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return 'Message must include at least one letter or number.';
  if (/(.)\1{7,}/u.test(trimmed)) return 'Message looks like repeated-character spam.';
  return '';
}

async function submitTransmission(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formError = document.getElementById('form-error');
  formError.textContent = '';

  const payload = {
    callsign: form.callsign.value,
    origin: form.origin.value,
    message: form.message.value,
    humanAnswer: form.humanAnswer.value,
    humanToken: state.humanToken,
    website: form.website.value
  };

  const validationError = validateMessageClient(payload.message);
  if (validationError) {
    formError.textContent = validationError;
    return;
  }

  try {
    await apiFetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    form.reset();
    updateCounter();
    await refreshHumanCheck();
    await loadMessages({ reset: true });
    showToast('Transmission received.');
  } catch (err) {
    formError.textContent = err.message;
    if (err.message.toLowerCase().includes('human check')) {
      refreshHumanCheck();
    }
  }
}

async function handleEntryAction(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const entryEl = event.target.closest('.entry');
  if (!entryEl) return;
  const id = Number(entryEl.dataset.id);

  if (btn.dataset.action === 'copy') {
    const item = state.items.find((x) => x.id === id);
    const payload = item
      ? `${item.callsign || 'Anonymous'} | ${item.origin || 'Unknown'}\n${item.message}`
      : '';
    await navigator.clipboard.writeText(payload).catch(() => {});
    showToast('Transmission copied.');
    return;
  }

  if (btn.dataset.action === 'report') {
    const reason = window.prompt('Optional report reason:', '');
    try {
      await apiFetch(`/api/report/${id}`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || '' })
      });
      showToast('Transmission reported.');
    } catch (err) {
      showToast(err.message, 'error');
    }
    return;
  }

  if (btn.dataset.action === 'delete' && PAGE === 'admin') {
    if (!state.adminToken) {
      showToast('Add admin token first.', 'error');
      return;
    }
    if (!window.confirm('Delete this transmission?')) return;

    try {
      await apiFetch(`/api/messages/${id}`, {
        method: 'DELETE',
        headers: {
          'x-admin-token': state.adminToken
        }
      });
      state.items = state.items.filter((x) => x.id !== id);
      state.total = Math.max(0, state.total - 1);
      renderItems(true);
      showToast('Transmission deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

function updateCounter() {
  const msg = document.getElementById('message');
  const counter = document.getElementById('char-counter');
  if (!msg || !counter) return;
  counter.textContent = `${msg.value.length}/300`;
}

function setupFilters() {
  const chips = document.getElementById('filter-chips');
  const customOriginEl = document.getElementById('custom-origin');

  if (chips) {
    chips.addEventListener('click', (event) => {
      const chip = event.target.closest('.chip');
      if (!chip) return;

      state.originFilterType = chip.dataset.filter;
      chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');

      if (customOriginEl) {
        customOriginEl.classList.toggle('hidden', state.originFilterType !== 'custom');
      }

      loadMessages({ reset: true });
    });
  }

  if (customOriginEl) {
    customOriginEl.addEventListener('input', debounce(() => {
      state.customOrigin = customOriginEl.value;
      if (state.originFilterType === 'custom') {
        loadMessages({ reset: true });
      }
    }, 300));
  }
}

function setupSearch() {
  if (!dom.search) return;
  dom.search.addEventListener('input', debounce(() => {
    state.query = dom.search.value.trim();
    loadMessages({ reset: true });
  }, 300));
}

function setupPagination() {
  if (!dom.loadMore) return;
  dom.loadMore.addEventListener('click', () => loadMessages({ reset: false }));
}

function setupMainPage() {
  const form = document.getElementById('transmission-form');
  const message = document.getElementById('message');
  const refresh = document.getElementById('refresh');
  const refreshHuman = document.getElementById('refresh-human');

  if (form) form.addEventListener('submit', submitTransmission);
  if (form) form.addEventListener('reset', () => {
    setTimeout(() => {
      document.getElementById('form-error').textContent = '';
      updateCounter();
      refreshHumanCheck();
    }, 0);
  });
  if (message) message.addEventListener('input', updateCounter);
  if (refresh) refresh.addEventListener('click', () => loadMessages({ reset: true }));
  if (refreshHuman) refreshHuman.addEventListener('click', refreshHumanCheck);

  updateCounter();
  setupFilters();
  setupSearch();
  setupPagination();
  dom.logFeed?.addEventListener('click', handleEntryAction);
  refreshHumanCheck();
  loadMessages({ reset: true });
}

function setupAdminPage() {
  const tokenInput = document.getElementById('admin-token');
  const saveBtn = document.getElementById('save-admin-token');
  const remember = document.getElementById('remember-token');
  const refresh = document.getElementById('refresh-admin');

  const saved = sessionStorage.getItem('signalLogAdminToken') || '';
  if (saved && tokenInput) {
    tokenInput.value = saved;
    state.adminToken = saved;
    if (remember) remember.checked = true;
  }

  if (saveBtn && tokenInput) {
    saveBtn.addEventListener('click', () => {
      state.adminToken = tokenInput.value.trim();
      if (!state.adminToken) {
        showToast('Token cannot be empty.', 'error');
        return;
      }

      if (remember?.checked) {
        sessionStorage.setItem('signalLogAdminToken', state.adminToken);
      } else {
        sessionStorage.removeItem('signalLogAdminToken');
      }
      showToast('Admin token loaded for this session.');
    });
  }

  if (refresh) {
    refresh.addEventListener('click', () => loadMessages({ reset: true }));
  }

  setupSearch();
  setupPagination();
  dom.logFeed?.addEventListener('click', handleEntryAction);
  loadMessages({ reset: true });
}

if (PAGE === 'admin') {
  setupAdminPage();
} else {
  setupMainPage();
}
