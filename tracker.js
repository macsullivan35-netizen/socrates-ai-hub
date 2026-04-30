// ─── Data Layer ──────────────────────────────────────────────────────────────
const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }
};

const KEYS = { businesses: 'pt_businesses', assets: 'pt_assets' };

function getBusinesses() { return DB.get(KEYS.businesses); }
function getAssets()     { return DB.get(KEYS.assets); }
function saveBusinesses(d) { DB.set(KEYS.businesses, d); }
function saveAssets(d)     { DB.set(KEYS.assets, d); }

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── Formatting ──────────────────────────────────────────────────────────────
function fmt(n) {
  if (isNaN(n) || n === null || n === undefined) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtShort(n) {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return '$' + (n / 1_000).toFixed(1)     + 'K';
  return fmt(n);
}

// ─── Navigation ──────────────────────────────────────────────────────────────
let currentPage = 'dashboard';

function navigateTo(page) {
  currentPage = page;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });

  const titles = { dashboard: 'Dashboard', businesses: 'Businesses', assets: 'Assets' };
  document.getElementById('page-title').textContent = titles[page] || page;

  // Update "Add New" button label
  const addBtn = document.getElementById('topbar-add-btn');
  if (page === 'businesses') addBtn.textContent = '+ Add Business';
  else if (page === 'assets') addBtn.textContent = '+ Add Asset';
  else addBtn.textContent = '+ Add New';

  renderPage(page);
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
  });
});

document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// Close sidebar on overlay click (mobile)
document.addEventListener('click', e => {
  const sidebar = document.getElementById('sidebar');
  const toggle  = document.getElementById('sidebar-toggle');
  if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggle) {
    sidebar.classList.remove('open');
  }
});

// ─── "Add New" Top Button ─────────────────────────────────────────────────────
document.getElementById('topbar-add-btn').addEventListener('click', () => {
  if (currentPage === 'assets') openAssetModal();
  else if (currentPage === 'businesses') openBusinessModal();
  else {
    // On dashboard, show a mini picker
    openBusinessModal();
  }
});

// ─── Business Modal ───────────────────────────────────────────────────────────
function openBusinessModal(biz = null) {
  const isEdit = !!biz;
  document.getElementById('modal-biz-title').textContent = isEdit ? 'Edit Business' : 'Add Business';
  document.getElementById('biz-id').value           = biz?.id || '';
  document.getElementById('biz-name').value         = biz?.name || '';
  document.getElementById('biz-industry').value     = biz?.industry || 'Technology';
  document.getElementById('biz-monthly-rev').value  = biz?.monthlyRevenue || '';
  document.getElementById('biz-annual-rev').value   = biz?.annualRevenue || '';
  document.getElementById('biz-ownership').value    = biz?.ownership ?? 100;
  document.getElementById('biz-status').value       = biz?.status || 'Active';
  document.getElementById('biz-notes').value        = biz?.notes || '';
  openModal('modal-business');
}

// Auto-fill annual when monthly changes
document.getElementById('biz-monthly-rev').addEventListener('input', function() {
  const annual = document.getElementById('biz-annual-rev');
  if (this.value && !annual.value) {
    annual.placeholder = fmt(parseFloat(this.value) * 12) + ' (auto)';
  } else {
    annual.placeholder = 'Auto-calculated';
  }
});

document.getElementById('form-business').addEventListener('submit', e => {
  e.preventDefault();
  const monthly = parseFloat(document.getElementById('biz-monthly-rev').value) || 0;
  const annual  = parseFloat(document.getElementById('biz-annual-rev').value) || (monthly * 12);
  const id      = document.getElementById('biz-id').value;

  const biz = {
    id:            id || uid(),
    name:          document.getElementById('biz-name').value.trim(),
    industry:      document.getElementById('biz-industry').value,
    monthlyRevenue: monthly,
    annualRevenue:  annual,
    ownership:     parseFloat(document.getElementById('biz-ownership').value) || 100,
    status:        document.getElementById('biz-status').value,
    notes:         document.getElementById('biz-notes').value.trim(),
    dateAdded:     id ? undefined : new Date().toISOString(),
    type:          'business'
  };

  const list = getBusinesses();
  if (id) {
    const idx = list.findIndex(b => b.id === id);
    if (idx >= 0) { biz.dateAdded = list[idx].dateAdded; list[idx] = biz; }
  } else {
    list.push(biz);
  }
  saveBusinesses(list);
  closeModal('modal-business');
  renderPage(currentPage);
  if (currentPage !== 'businesses') renderDashboard();
});

// ─── Asset Modal ──────────────────────────────────────────────────────────────
function openAssetModal(asset = null) {
  const isEdit = !!asset;
  document.getElementById('modal-asset-title').textContent = isEdit ? 'Edit Asset' : 'Add Asset';
  document.getElementById('asset-id').value            = asset?.id || '';
  document.getElementById('asset-name').value          = asset?.name || '';
  document.getElementById('asset-type').value          = asset?.assetType || 'Real Estate';
  document.getElementById('asset-value').value         = asset?.value || '';
  document.getElementById('asset-monthly-income').value= asset?.monthlyIncome || '';
  document.getElementById('asset-annual-income').value = asset?.annualIncome || '';
  document.getElementById('asset-status').value        = asset?.status || 'Active';
  document.getElementById('asset-notes').value         = asset?.notes || '';
  openModal('modal-asset');
}

document.getElementById('asset-monthly-income').addEventListener('input', function() {
  const annual = document.getElementById('asset-annual-income');
  if (this.value && !annual.value) {
    annual.placeholder = fmt(parseFloat(this.value) * 12) + ' (auto)';
  } else {
    annual.placeholder = 'Auto-calculated';
  }
});

document.getElementById('form-asset').addEventListener('submit', e => {
  e.preventDefault();
  const monthly = parseFloat(document.getElementById('asset-monthly-income').value) || 0;
  const annual  = parseFloat(document.getElementById('asset-annual-income').value) || (monthly * 12);
  const id      = document.getElementById('asset-id').value;

  const asset = {
    id:           id || uid(),
    name:         document.getElementById('asset-name').value.trim(),
    assetType:    document.getElementById('asset-type').value,
    value:        parseFloat(document.getElementById('asset-value').value) || 0,
    monthlyIncome: monthly,
    annualIncome:  annual,
    status:       document.getElementById('asset-status').value,
    notes:        document.getElementById('asset-notes').value.trim(),
    dateAdded:    id ? undefined : new Date().toISOString(),
    type:         'asset'
  };

  const list = getAssets();
  if (id) {
    const idx = list.findIndex(a => a.id === id);
    if (idx >= 0) { asset.dateAdded = list[idx].dateAdded; list[idx] = asset; }
  } else {
    list.push(asset);
  }
  saveAssets(list);
  closeModal('modal-asset');
  renderPage(currentPage);
  if (currentPage !== 'assets') renderDashboard();
});

// ─── Delete ───────────────────────────────────────────────────────────────────
let pendingDelete = null;

function confirmDelete(type, id, name) {
  pendingDelete = { type, id };
  document.getElementById('delete-message').textContent =
    `Are you sure you want to delete "${name}"? This cannot be undone.`;
  openModal('modal-delete');
}

document.getElementById('confirm-delete-btn').addEventListener('click', () => {
  if (!pendingDelete) return;
  const { type, id } = pendingDelete;
  if (type === 'business') {
    saveBusinesses(getBusinesses().filter(b => b.id !== id));
  } else {
    saveAssets(getAssets().filter(a => a.id !== id));
  }
  pendingDelete = null;
  closeModal('modal-delete');
  renderPage(currentPage);
  if (currentPage === 'dashboard') renderDashboard();
  else renderDashboard();
});

// ─── Modal Utilities ──────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close buttons
document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.modal;
    if (modalId) closeModal(modalId);
  });
});

// Close on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ─── Render Businesses Page ───────────────────────────────────────────────────
function renderBusinesses() {
  const businesses = getBusinesses();
  const grid = document.getElementById('businesses-grid');
  const totalMonthly = businesses.reduce((s, b) => s + (b.monthlyRevenue || 0), 0);
  const totalAnnual  = businesses.reduce((s, b) => s + (b.annualRevenue  || 0), 0);

  document.getElementById('biz-count').textContent   = businesses.length;
  document.getElementById('biz-annual').textContent  = fmt(totalAnnual);
  document.getElementById('biz-monthly').textContent = fmt(totalMonthly);

  if (businesses.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🏢</div>
      <div class="empty-text">No businesses added yet.</div>
      <div class="empty-sub">Click <strong>+ Add Business</strong> to add your first business.</div>
    </div>`;
    return;
  }

  const sorted = [...businesses].sort((a, b) => b.annualRevenue - a.annualRevenue);
  grid.innerHTML = sorted.map(biz => `
    <div class="item-card type-business">
      <div class="item-card-header">
        <div>
          <div class="item-card-title">${escHtml(biz.name)}</div>
          <div class="item-card-meta">${escHtml(biz.industry)} · ${biz.ownership}% ownership</div>
        </div>
        <div class="item-card-actions">
          <button class="item-btn" title="Edit" onclick="openBusinessModal(getBusinessById('${biz.id}'))">✏️</button>
          <button class="item-btn delete" title="Delete" onclick="confirmDelete('business','${biz.id}','${escAttr(biz.name)}')">🗑️</button>
        </div>
      </div>
      <div class="item-stats">
        <div class="stat-item">
          <div class="stat-label">Annual Revenue</div>
          <div class="stat-value">${fmt(biz.annualRevenue)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Monthly Revenue</div>
          <div class="stat-value">${fmt(biz.monthlyRevenue)}</div>
        </div>
      </div>
      <div class="item-footer">
        <span class="item-notes">${escHtml(biz.notes || 'No notes')}</span>
        <span class="status-pill status-${biz.status}">${biz.status}</span>
      </div>
    </div>
  `).join('');
}

function getBusinessById(id) { return getBusinesses().find(b => b.id === id) || null; }
function getAssetById(id)    { return getAssets().find(a => a.id === id)    || null; }

// Expose globally for inline handlers
window.getBusinessById = getBusinessById;
window.getAssetById    = getAssetById;
window.openBusinessModal = openBusinessModal;
window.openAssetModal    = openAssetModal;
window.confirmDelete     = confirmDelete;

// ─── Render Assets Page ───────────────────────────────────────────────────────
function renderAssets() {
  const assets = getAssets();
  const grid = document.getElementById('assets-grid');
  const totalMonthly = assets.reduce((s, a) => s + (a.monthlyIncome || 0), 0);
  const totalAnnual  = assets.reduce((s, a) => s + (a.annualIncome  || 0), 0);
  const totalValue   = assets.reduce((s, a) => s + (a.value         || 0), 0);

  document.getElementById('asset-count').textContent       = assets.length;
  document.getElementById('asset-total-value').textContent = fmt(totalValue);
  document.getElementById('asset-annual').textContent      = fmt(totalAnnual);
  document.getElementById('asset-monthly').textContent     = fmt(totalMonthly);

  if (assets.length === 0) {
    grid.innerHTML = `<div class="empty-state">
      <div class="empty-icon">💎</div>
      <div class="empty-text">No assets added yet.</div>
      <div class="empty-sub">Click <strong>+ Add Asset</strong> to add your first asset.</div>
    </div>`;
    return;
  }

  const sorted = [...assets].sort((a, b) => b.annualIncome - a.annualIncome);
  grid.innerHTML = sorted.map(asset => `
    <div class="item-card type-asset">
      <div class="item-card-header">
        <div>
          <div class="item-card-title">${escHtml(asset.name)}</div>
          <div class="item-card-meta">${escHtml(asset.assetType)}</div>
        </div>
        <div class="item-card-actions">
          <button class="item-btn" title="Edit" onclick="openAssetModal(getAssetById('${asset.id}'))">✏️</button>
          <button class="item-btn delete" title="Delete" onclick="confirmDelete('asset','${asset.id}','${escAttr(asset.name)}')">🗑️</button>
        </div>
      </div>
      <div class="item-stats">
        <div class="stat-item">
          <div class="stat-label">Annual Income</div>
          <div class="stat-value">${fmt(asset.annualIncome)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Monthly Income</div>
          <div class="stat-value">${fmt(asset.monthlyIncome)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Asset Value</div>
          <div class="stat-value">${fmt(asset.value)}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Yield (Annual)</div>
          <div class="stat-value">${asset.value > 0 ? ((asset.annualIncome / asset.value) * 100).toFixed(1) + '%' : '—'}</div>
        </div>
      </div>
      <div class="item-footer">
        <span class="item-notes">${escHtml(asset.notes || 'No notes')}</span>
        <span class="status-pill status-${asset.status}">${asset.status}</span>
      </div>
    </div>
  `).join('');
}

// ─── Chart Instances ──────────────────────────────────────────────────────────
let barChartInst   = null;
let donutChartInst = null;

// ─── Render Dashboard ─────────────────────────────────────────────────────────
function renderDashboard() {
  const businesses = getBusinesses();
  const assets     = getAssets();

  const bizAnnual   = businesses.reduce((s, b) => s + (b.annualRevenue  || 0), 0);
  const bizMonthly  = businesses.reduce((s, b) => s + (b.monthlyRevenue || 0), 0);
  const assetAnnual = assets.reduce((s, a)     => s + (a.annualIncome   || 0), 0);
  const assetMonthly= assets.reduce((s, a)     => s + (a.monthlyIncome  || 0), 0);

  const totalAnnual  = bizAnnual  + assetAnnual;
  const totalMonthly = bizMonthly + assetMonthly;
  const totalDaily   = totalMonthly / 30;

  // KPI cards
  document.getElementById('kpi-total').textContent         = fmt(totalAnnual);
  document.getElementById('kpi-total-monthly').textContent = fmt(totalMonthly) + ' / month';
  document.getElementById('kpi-business').textContent      = fmt(bizAnnual);
  document.getElementById('kpi-business-count').textContent= `${businesses.length} business${businesses.length !== 1 ? 'es' : ''}`;
  document.getElementById('kpi-asset').textContent         = fmt(assetAnnual);
  document.getElementById('kpi-asset-count').textContent   = `${assets.length} asset${assets.length !== 1 ? 's' : ''}`;
  document.getElementById('kpi-monthly').textContent       = fmt(totalMonthly);
  document.getElementById('kpi-daily').textContent         = fmt(totalDaily) + ' / day (avg)';

  const hasData = businesses.length + assets.length > 0;

  // ── Bar Chart (all items) ──────────────────────────────────────────────────
  const barEmpty = document.getElementById('bar-empty');
  const barCanvas = document.getElementById('barChart');

  if (!hasData) {
    barEmpty.classList.add('visible');
    barCanvas.style.display = 'none';
  } else {
    barEmpty.classList.remove('visible');
    barCanvas.style.display = '';

    const allItems = [
      ...businesses.map(b => ({ label: b.name, value: b.annualRevenue || 0, color: '#3b82f6' })),
      ...assets.map(a     => ({ label: a.name, value: a.annualIncome  || 0, color: '#8b5cf6' }))
    ].sort((a, b) => b.value - a.value);

    const labels = allItems.map(i => i.label);
    const values = allItems.map(i => i.value);
    const colors = allItems.map(i => i.color);

    if (barChartInst) barChartInst.destroy();
    barChartInst = new Chart(barCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Annual Revenue / Income',
          data: values,
          backgroundColor: colors,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + fmt(ctx.parsed.y)
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 12 }, maxRotation: 30 }
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              font: { size: 12 },
              callback: v => fmtShort(v)
            }
          }
        }
      }
    });

    // Legend
    document.getElementById('bar-legend').innerHTML = `
      <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#64748b;margin-right:12px;">
        <span style="width:10px;height:10px;border-radius:2px;background:#3b82f6;display:inline-block;"></span> Business
      </span>
      <span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#64748b;">
        <span style="width:10px;height:10px;border-radius:2px;background:#8b5cf6;display:inline-block;"></span> Asset
      </span>
    `;
  }

  // ── Donut Chart ───────────────────────────────────────────────────────────
  const donutEmpty  = document.getElementById('donut-empty');
  const donutCanvas = document.getElementById('donutChart');
  const donutLabels = document.getElementById('donut-labels');

  if (!hasData) {
    donutEmpty.classList.add('visible');
    donutCanvas.style.display = 'none';
    donutLabels.innerHTML = '';
  } else {
    donutEmpty.classList.remove('visible');
    donutCanvas.style.display = '';

    const donutData = [
      { label: 'Businesses', value: bizAnnual, color: '#3b82f6' },
      { label: 'Assets',     value: assetAnnual, color: '#8b5cf6' }
    ].filter(d => d.value > 0);

    if (donutChartInst) donutChartInst.destroy();
    donutChartInst = new Chart(donutCanvas, {
      type: 'doughnut',
      data: {
        labels: donutData.map(d => d.label),
        datasets: [{
          data: donutData.map(d => d.value),
          backgroundColor: donutData.map(d => d.color),
          borderWidth: 3,
          borderColor: '#fff',
          hoverBorderWidth: 3
        }]
      },
      options: {
        responsive: true,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + fmt(ctx.parsed) + ' (' + Math.round(ctx.parsed / totalAnnual * 100) + '%)'
            }
          }
        }
      }
    });

    donutLabels.innerHTML = donutData.map(d => `
      <div class="donut-label-item">
        <span class="donut-dot" style="background:${d.color}"></span>
        <span class="donut-label-text">${d.label}</span>
        <span class="donut-label-val">${fmt(d.value)}</span>
      </div>
    `).join('');
  }

  // ── Top Performers Table ───────────────────────────────────────────────────
  const tbody = document.getElementById('top-performers-body');

  if (!hasData) {
    tbody.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📊</div>
      <div class="empty-text">No businesses or assets added yet.</div>
      <div class="empty-sub">Click <strong>+ Add New</strong> to get started.</div>
    </div>`;
    return;
  }

  const allForTable = [
    ...businesses.map(b => ({
      name:    b.name,
      subtype: b.industry,
      kind:    'business',
      annual:  b.annualRevenue  || 0,
      monthly: b.monthlyRevenue || 0,
      status:  b.status,
      share:   totalAnnual > 0 ? (b.annualRevenue / totalAnnual) * 100 : 0
    })),
    ...assets.map(a => ({
      name:    a.name,
      subtype: a.assetType,
      kind:    'asset',
      annual:  a.annualIncome  || 0,
      monthly: a.monthlyIncome || 0,
      status:  a.status,
      share:   totalAnnual > 0 ? (a.annualIncome / totalAnnual) * 100 : 0
    }))
  ].sort((a, b) => b.annual - a.annual);

  tbody.innerHTML = `
    <table class="performers-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Status</th>
          <th>Monthly</th>
          <th>Annual</th>
          <th>Portfolio Share</th>
        </tr>
      </thead>
      <tbody>
        ${allForTable.map(item => `
          <tr>
            <td>
              <strong>${escHtml(item.name)}</strong>
              <div style="font-size:11px;color:#94a3b8;">${escHtml(item.subtype)}</div>
            </td>
            <td>
              <span class="type-badge badge-${item.kind}">
                ${item.kind === 'business' ? '🏢' : '💎'} ${item.kind.charAt(0).toUpperCase() + item.kind.slice(1)}
              </span>
            </td>
            <td><span class="status-pill status-${item.status}">${item.status}</span></td>
            <td class="amount-cell">${fmt(item.monthly)}</td>
            <td class="amount-cell">${fmt(item.annual)}</td>
            <td style="min-width:120px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <div class="share-bar-wrap" style="flex:1;">
                  <div class="share-bar-fill" style="width:${item.share.toFixed(1)}%;background:${item.kind === 'business' ? '#3b82f6' : '#8b5cf6'};"></div>
                </div>
                <span style="font-size:12px;font-weight:600;color:#64748b;min-width:36px;">${item.share.toFixed(0)}%</span>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── Route Rendering ──────────────────────────────────────────────────────────
function renderPage(page) {
  if (page === 'dashboard')   renderDashboard();
  if (page === 'businesses')  renderBusinesses();
  if (page === 'assets')      renderAssets();
}

// ─── Security Helpers ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str || '').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
navigateTo('dashboard');
