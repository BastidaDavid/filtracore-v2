const links = document.querySelectorAll('.main-nav a');
const sections = document.querySelectorAll('main section');

function loadStoredArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`FiltraCore ignored invalid localStorage data for ${key}.`, error);
    return [];
  }
}

function loadStoredObject(key, fallback = {}) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.warn(`FiltraCore ignored invalid localStorage data for ${key}.`, error);
    return fallback;
  }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return entities[character];
  });
}

function escapeInlineValue(value) {
  return escapeHTML(String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' '));
}

const machines = loadStoredArray('filtracore_machines');
const filters = loadStoredArray('filtracore_filters');
const inventory = loadStoredArray('filtracore_inventory');
const maintenanceRecords = loadStoredArray('filtracore_maintenance');
const facilities = loadStoredArray('filtracore_facilities');
const technicians = loadStoredArray('filtracore_technicians');
const inspections = loadStoredArray('filtracore_inspections');
const inventoryUsage = loadStoredArray('filtracore_inventory_usage');
const suppliers = loadStoredArray('filtracore_suppliers');
const supplierProducts = loadStoredArray('filtracore_supplier_products');
const priceHistory = loadStoredArray('filtracore_price_history');
const purchaseOrders = loadStoredArray('filtracore_purchase_orders');
const API_BASE_URL = window.FILTRACORE_API_BASE_URL || '';
const authTokenKey = 'filtracore_auth_token';
const authUserKey = 'filtracore_auth_user';
const selectedTenantKey = 'filtracore_selected_tenant_id';
const brainUserEmail = 'bastidasystems@gmail.com';
const standardMachineLimit = 5;
const valuedMachineClientEmails = new Set([
  'strat01@bastidasystems.io',
  'westgate@bastidasystems.io'
]);
let authToken = localStorage.getItem(authTokenKey) || '';
let currentUser = loadStoredObject(authUserKey, null);
let selectedTenantId = localStorage.getItem(selectedTenantKey) || '';
let apiAvailable = false;
let adminUsers = [];
let restaurantWorkspaces = [];
let adminUserTotals = {};
let restaurantLogoDataUrl = '';
let clientWorkspaceLogoDataUrl = '';
let machineAccess = {
  tier: 'standard',
  unlimited: false,
  limit: 5,
  machines: 0,
  remaining: 5,
  ownerEmail: '',
  message: 'Standard FiltraCore accounts include up to 5 machines.'
};

function isBrainUser() {
  return String(currentUser?.email || '').trim().toLowerCase() === brainUserEmail
    || String(currentUser?.role || '').trim().toLowerCase() === 'superadmin';
}

function isValuedMachineClientEmail(email) {
  return valuedMachineClientEmails.has(String(email || '').trim().toLowerCase());
}

function getRestaurantWorkspaces() {
  return isBrainUser() ? adminUsers : restaurantWorkspaces;
}

function hasValuedMachineAccess(workspaces = getRestaurantWorkspaces()) {
  return isValuedMachineClientEmail(currentUser?.email)
    || workspaces.some(workspace => isValuedMachineClientEmail(workspace.email));
}

function getSelectedRestaurant() {
  return getRestaurantWorkspaces().find(user => String(user.tenantId) === String(selectedTenantId)) || null;
}

function needsRestaurantSelection() {
  return Boolean(authToken && !getSelectedRestaurant());
}

function getRestaurantInitials(user) {
  const source = user?.businessName || user?.fullName || user?.email || 'FC';
  return String(source)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] || '')
    .join('')
    .toUpperCase() || 'FC';
}

function getLogoMarkup(user, className = 'restaurant-card-logo') {
  const logo = String(user?.logoDataUrl || '');
  if (/^data:image\/(png|jpe?g);base64,/i.test(logo)) {
    return `<img class="${className}" src="${escapeHTML(logo)}" alt="${escapeHTML(user?.businessName || 'Restaurant')} logo" />`;
  }

  return `<span class="${className} logo-fallback">${escapeHTML(getRestaurantInitials(user))}</span>`;
}

function normalizeMachineAccess(value) {
  const access = value && typeof value === 'object' ? value : {};
  const limit = access.limit === null || access.limit === undefined ? null : Number(access.limit) || 5;
  const machineCount = Number(access.machines);
  const unlimited = Boolean(access.unlimited);

  return {
    tier: String(access.tier || (unlimited ? 'valued' : 'standard')),
    unlimited,
    limit,
    machines: Number.isFinite(machineCount) ? machineCount : machines.length,
    remaining: unlimited || limit === null
      ? null
      : Math.max(limit - (Number.isFinite(machineCount) ? machineCount : machines.length), 0),
    ownerEmail: String(access.ownerEmail || '').trim().toLowerCase(),
    message: String(access.message || (unlimited
      ? 'As a valued early FiltraCore client, this workspace has unlimited machine access. Standard accounts include up to 5 machines.'
      : `Standard FiltraCore accounts include up to ${standardMachineLimit} machines. Upgrade your plan or buy more machine access to install additional machines.`))
  };
}

function machineLimitMessage() {
  if (machineAccess.unlimited || machineAccess.limit === null) return '';
  return `This workspace has reached the ${machineAccess.limit}-machine Standard limit. Upgrade the plan or buy more machine access to install additional machines.`;
}

function isAtMachineLimit() {
  return !machineAccess.unlimited
    && machineAccess.limit !== null
    && machines.length >= machineAccess.limit;
}

function normalizeMachine(machine) {
  return {
    id: Number(machine.id ?? machine.machine_id),
    facilityId: machine.facilityId ?? machine.facility_id ?? null,
    name: machine.name || '',
    type: machine.type || '',
    category: machine.category || machine.type || '',
    location: machine.location || '',
    department: machine.department || '',
    brand: machine.brand || '',
    model: machine.model || '',
    serialNumber: machine.serialNumber ?? machine.serial_number ?? '',
    building: machine.building || '',
    floor: machine.floor || '',
    zone: machine.zone || '',
    exactLocation: machine.exactLocation ?? machine.exact_location ?? machine.location ?? '',
    assetId: machine.assetId ?? machine.asset_id ?? '',
    qrPayload: machine.qrPayload ?? machine.qr_payload ?? '',
    healthStatus: machine.healthStatus ?? machine.health_status ?? '',
    createdAt: machine.createdAt ?? machine.created_at ?? null
  };
}

function normalizeInventoryItem(item) {
  const category = item.category || '';

  return {
    id: Number(item.id ?? item.inventory_id),
    name: item.name || '',
    category,
    reorderNumber: item.reorderNumber ?? item.reorder_number ?? '',
    filterType: item.filterType ?? item.filter_type ?? category,
    vendorName: item.vendorName ?? item.vendor_name ?? '',
    vendorContact: item.vendorContact ?? item.vendor_contact ?? '',
    stock: Number(item.stock) || 0,
    unitCost: Number(item.unitCost ?? item.unit_cost ?? item.cost) || 0,
    reorderLevel: Number(item.reorderLevel ?? item.reorder_level) || 0,
    lifeMonths: Number(item.lifeMonths ?? item.life_months) || getDefaultLifeMonths(category),
    createdAt: item.createdAt ?? item.created_at ?? null
  };
}

function normalizeFilter(filter) {
  const productName = filter.productName ?? filter.product_name ?? 'Filter';
  const category = filter.productCategory ?? filter.product_category ?? '';
  const productId = filter.productId ?? filter.inventory_id ?? null;

  return {
    id: Number(filter.id ?? filter.filter_id),
    machineId: Number(filter.machineId ?? filter.machine_id),
    productId: productId === null || productId === undefined || productId === '' ? null : Number(productId),
    productName,
    reorderNumber: filter.reorderNumber ?? filter.reorder_number ?? '',
    filterType: filter.filterType ?? filter.filter_type ?? category,
    filterQuantity: Number(filter.filterQuantity ?? filter.filter_quantity) || 1,
    psiMin: filter.psiMin ?? filter.psi_min ?? null,
    psiMax: filter.psiMax ?? filter.psi_max ?? null,
    vendorName: filter.vendorName ?? filter.vendor_name ?? '',
    cost: Number(filter.cost ?? filter.unit_cost) || 0,
    lifeMonths: Number(filter.lifeMonths ?? filter.life_months) || getDefaultLifeMonths(category),
    psi: filter.psi === null || filter.psi === undefined || filter.psi === '' ? null : Number(filter.psi),
    psiHistory: Array.isArray(filter.psiHistory) ? filter.psiHistory : [],
    installedAt: filter.installedAt ?? filter.installed_at ?? null,
    dueDate: filter.dueDate ?? filter.due_date ?? null,
    status: filter.status || 'Healthy',
    createdAt: filter.createdAt ?? filter.created_at ?? null
  };
}

function normalizeMaintenanceRecord(record) {
  const filterId = record.filterId ?? record.filter_id ?? null;
  const replacementProductId = record.replacementProductId ?? record.replacement_product_id ?? null;

  return {
    id: Number(record.id ?? record.maintenance_id),
    logId: record.logId ?? record.log_id ?? null,
    machineId: Number(record.machineId ?? record.machine_id),
    filterId: filterId === null || filterId === undefined || filterId === '' ? null : Number(filterId),
    technicianId: record.technicianId ?? record.technician_id ?? null,
    technicianName: record.technicianName ?? record.technician_name ?? '',
    inspectionStatus: record.inspectionStatus ?? record.inspection_status ?? '',
    priority: record.priority || '',
    nextDueDate: record.nextDueDate ?? record.next_due_date ?? null,
    type: record.type ?? record.maintenance_type ?? 'General',
    date: record.date ?? record.performed_at ?? null,
    notes: record.notes || '',
    replacementProductId: replacementProductId === null || replacementProductId === undefined || replacementProductId === ''
      ? null
      : Number(replacementProductId),
    replacedFrom: record.replacedFrom ?? record.replaced_from ?? '',
    replacedWith: record.replacedWith ?? record.replaced_with ?? '',
    previousPsi: record.previousPsi ?? record.currentPsi ?? record.current_psi ?? null,
    correctedPsi: record.correctedPsi ?? record.corrected_psi ?? null,
    createdAt: record.createdAt ?? record.created_at ?? record.performed_at ?? null
  };
}

function normalizeFacility(facility) {
  return {
    id: Number(facility.id ?? facility.facility_id),
    name: facility.name || '',
    venueType: facility.venueType ?? facility.venue_type ?? '',
    building: facility.building || '',
    address: facility.address || '',
    createdAt: facility.createdAt ?? facility.created_at ?? null
  };
}

function normalizeTechnician(technician) {
  return {
    id: Number(technician.id ?? technician.technician_id),
    name: technician.name || '',
    email: technician.email || '',
    phone: technician.phone || '',
    role: technician.role || 'Technician',
    active: technician.active !== false,
    createdAt: technician.createdAt ?? technician.created_at ?? null
  };
}

function normalizeInspection(inspection) {
  return {
    id: Number(inspection.id ?? inspection.inspection_id),
    machineId: inspection.machineId ?? inspection.machine_id ?? null,
    filterId: inspection.filterId ?? inspection.filter_id ?? null,
    technicianId: inspection.technicianId ?? inspection.technician_id ?? null,
    inspectionType: inspection.inspectionType ?? inspection.inspection_type ?? 'General Inspection',
    result: inspection.result || '',
    notes: inspection.notes || '',
    psiReading: inspection.psiReading ?? inspection.psi_reading ?? null,
    inspectedAt: inspection.inspectedAt ?? inspection.inspected_at ?? null,
    createdAt: inspection.createdAt ?? inspection.created_at ?? null
  };
}

function normalizeInventoryUsage(usage) {
  return {
    inventoryId: usage.inventoryId ?? usage.inventory_id ?? null,
    totalUsed: Number(usage.totalUsed ?? usage.total_used) || 0,
    events: Number(usage.events) || 0,
    lastUsedAt: usage.lastUsedAt ?? usage.last_used_at ?? null
  };
}

function normalizeSupplier(supplier) {
  return {
    id: Number(supplier.id ?? supplier.supplier_id),
    name: supplier.name || '',
    contact: supplier.contact ?? supplier.contactName ?? supplier.contact_name ?? '',
    email: supplier.email || '',
    phone: supplier.phone || '',
    website: supplier.website || '',
    category: supplier.category || '',
    notes: supplier.notes || '',
    status: String(supplier.status || 'active').toLowerCase(),
    createdAt: supplier.createdAt ?? supplier.created_at ?? null,
    updatedAt: supplier.updatedAt ?? supplier.updated_at ?? null
  };
}

function normalizeSupplierProduct(product) {
  const currentPrice = Number(product.currentPrice ?? product.current_price ?? product.price) || 0;
  const rawLastPrice = product.lastPrice ?? product.last_price;
  const lastPrice = rawLastPrice === null || rawLastPrice === undefined || rawLastPrice === '' ? null : Number(rawLastPrice) || 0;
  const variationPercent = lastPrice && lastPrice > 0
    ? ((currentPrice - lastPrice) / lastPrice) * 100
    : Number(product.variationPercent ?? product.variation_percent) || 0;

  return {
    id: Number(product.id ?? product.supplier_product_id),
    supplierId: Number(product.supplierId ?? product.supplier_id),
    inventoryId: Number(product.inventoryId ?? product.inventory_id),
    supplierName: product.supplierName ?? product.supplier_name ?? '',
    inventoryName: product.inventoryName ?? product.inventory_name ?? '',
    inventoryCategory: product.inventoryCategory ?? product.inventory_category ?? '',
    stock: Number(product.stock) || 0,
    reorderLevel: Number(product.reorderLevel ?? product.reorder_level) || 0,
    supplierSku: product.supplierSku ?? product.supplier_sku ?? '',
    productName: product.productName ?? product.product_name ?? product.inventoryName ?? product.inventory_name ?? '',
    currentPrice,
    lastPrice,
    variationPercent,
    direction: product.direction || (variationPercent > 0 ? 'up' : variationPercent < 0 ? 'down' : 'flat'),
    lastUpdatedAt: product.lastUpdatedAt ?? product.last_updated_at ?? null,
    notes: product.notes || '',
    status: String(product.status || 'active').toLowerCase(),
    createdAt: product.createdAt ?? product.created_at ?? null,
    updatedAt: product.updatedAt ?? product.updated_at ?? null
  };
}

function normalizePriceHistoryEntry(entry) {
  return {
    id: Number(entry.id ?? entry.price_history_id),
    supplierProductId: Number(entry.supplierProductId ?? entry.supplier_product_id),
    supplierId: Number(entry.supplierId ?? entry.supplier_id),
    inventoryId: Number(entry.inventoryId ?? entry.inventory_id),
    price: Number(entry.price) || 0,
    previousPrice: entry.previousPrice ?? entry.previous_price ?? null,
    changedAt: entry.changedAt ?? entry.changed_at ?? null,
    source: entry.source || '',
    notes: entry.notes || ''
  };
}

function normalizePurchaseOrder(order) {
  return {
    id: Number(order.id ?? order.purchase_order_id),
    supplierId: order.supplierId ?? order.supplier_id ?? null,
    supplierName: order.supplierName ?? order.supplier_name ?? '',
    poNumber: order.poNumber ?? order.po_number ?? '',
    status: order.status || 'Draft',
    expectedDate: order.expectedDate ?? order.expected_date ?? null,
    sentAt: order.sentAt ?? order.sent_at ?? null,
    receivedAt: order.receivedAt ?? order.received_at ?? null,
    notes: order.notes || '',
    totalAmount: Number(order.totalAmount ?? order.total_amount) || 0,
    createdAt: order.createdAt ?? order.created_at ?? null,
    updatedAt: order.updatedAt ?? order.updated_at ?? null,
    items: Array.isArray(order.items) ? order.items.map(item => ({
      id: Number(item.id ?? item.purchase_order_item_id),
      purchaseOrderId: Number(item.purchaseOrderId ?? item.purchase_order_id),
      inventoryId: item.inventoryId ?? item.inventory_id ?? null,
      supplierProductId: item.supplierProductId ?? item.supplier_product_id ?? null,
      inventoryName: item.inventoryName ?? item.inventory_name ?? '',
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice ?? item.unit_price) || 0,
      lineTotal: Number(item.lineTotal ?? item.line_total) || 0,
      receivedQuantity: Number(item.receivedQuantity ?? item.received_quantity) || 0,
      notes: item.notes || ''
    })) : []
  };
}

function replaceCollection(collection, nextItems) {
  collection.splice(0, collection.length, ...nextItems);
}

function saveLocalData() {
  localStorage.setItem('filtracore_machines', JSON.stringify(machines));
  localStorage.setItem('filtracore_filters', JSON.stringify(filters));
  localStorage.setItem('filtracore_inventory', JSON.stringify(inventory));
  localStorage.setItem('filtracore_maintenance', JSON.stringify(maintenanceRecords));
  localStorage.setItem('filtracore_facilities', JSON.stringify(facilities));
  localStorage.setItem('filtracore_technicians', JSON.stringify(technicians));
  localStorage.setItem('filtracore_inspections', JSON.stringify(inspections));
  localStorage.setItem('filtracore_inventory_usage', JSON.stringify(inventoryUsage));
  localStorage.setItem('filtracore_suppliers', JSON.stringify(suppliers));
  localStorage.setItem('filtracore_supplier_products', JSON.stringify(supplierProducts));
  localStorage.setItem('filtracore_price_history', JSON.stringify(priceHistory));
  localStorage.setItem('filtracore_purchase_orders', JSON.stringify(purchaseOrders));
}

function clearLocalOperationalData() {
  replaceCollection(machines, []);
  replaceCollection(filters, []);
  replaceCollection(inventory, []);
  replaceCollection(maintenanceRecords, []);
  replaceCollection(facilities, []);
  replaceCollection(technicians, []);
  replaceCollection(inspections, []);
  replaceCollection(inventoryUsage, []);
  replaceCollection(suppliers, []);
  replaceCollection(supplierProducts, []);
  replaceCollection(priceHistory, []);
  replaceCollection(purchaseOrders, []);
  localStorage.removeItem('filtracore_machines');
  localStorage.removeItem('filtracore_filters');
  localStorage.removeItem('filtracore_inventory');
  localStorage.removeItem('filtracore_maintenance');
  localStorage.removeItem('filtracore_facilities');
  localStorage.removeItem('filtracore_technicians');
  localStorage.removeItem('filtracore_inspections');
  localStorage.removeItem('filtracore_inventory_usage');
  localStorage.removeItem('filtracore_suppliers');
  localStorage.removeItem('filtracore_supplier_products');
  localStorage.removeItem('filtracore_price_history');
  localStorage.removeItem('filtracore_purchase_orders');
}

function applyServerState(state) {
  if (!state || typeof state !== 'object') return;

  replaceCollection(machines, Array.isArray(state.machines) ? state.machines.map(normalizeMachine) : machines);
  replaceCollection(inventory, Array.isArray(state.inventory) ? state.inventory.map(normalizeInventoryItem) : inventory);
  replaceCollection(filters, Array.isArray(state.filters) ? state.filters.map(normalizeFilter) : filters);
  replaceCollection(facilities, Array.isArray(state.facilities) ? state.facilities.map(normalizeFacility) : facilities);
  replaceCollection(
    maintenanceRecords,
    Array.isArray(state.maintenanceRecords) ? state.maintenanceRecords.map(normalizeMaintenanceRecord) : maintenanceRecords
  );
  replaceCollection(technicians, Array.isArray(state.technicians) ? state.technicians.map(normalizeTechnician) : technicians);
  replaceCollection(inspections, Array.isArray(state.inspections) ? state.inspections.map(normalizeInspection) : inspections);
  replaceCollection(inventoryUsage, Array.isArray(state.inventoryUsage) ? state.inventoryUsage.map(normalizeInventoryUsage) : inventoryUsage);
  replaceCollection(suppliers, Array.isArray(state.suppliers) ? state.suppliers.map(normalizeSupplier) : suppliers);
  replaceCollection(
    supplierProducts,
    Array.isArray(state.supplierProducts) ? state.supplierProducts.map(normalizeSupplierProduct) : supplierProducts
  );
  replaceCollection(priceHistory, Array.isArray(state.priceHistory) ? state.priceHistory.map(normalizePriceHistoryEntry) : priceHistory);
  replaceCollection(purchaseOrders, Array.isArray(state.purchaseOrders) ? state.purchaseOrders.map(normalizePurchaseOrder) : purchaseOrders);
  machineAccess = normalizeMachineAccess(state.machineAccess);

  saveLocalData();
}

function updateAuthUI() {
  const isSignedIn = Boolean(authToken);
  const loginScreen = document.querySelector('#login-screen');
  const restaurantScreen = document.querySelector('#restaurant-screen');
  const accountPanel = document.querySelector('#account-panel');
  const accountName = document.querySelector('#account-name');
  const accountsNav = document.querySelector('#accounts-nav');
  const switchRestaurantButton = document.querySelector('#switch-restaurant-button');
  const requiresRestaurant = needsRestaurantSelection();

  document.body.classList.toggle('auth-required', !isSignedIn);
  document.body.classList.toggle('restaurant-required', requiresRestaurant);

  if (loginScreen) {
    loginScreen.hidden = isSignedIn;
  }

  if (restaurantScreen) {
    restaurantScreen.hidden = !requiresRestaurant;
  }

  if (accountPanel) {
    accountPanel.hidden = !isSignedIn;
  }

  if (accountName) {
    const selectedRestaurant = getSelectedRestaurant();
    accountName.textContent = selectedRestaurant
      ? `${currentUser?.name || currentUser?.email || ''} · ${selectedRestaurant.businessName}`
      : currentUser?.name || currentUser?.email || '';
  }

  if (accountsNav) {
    accountsNav.hidden = !isSignedIn || !isBrainUser();
  }

  if (switchRestaurantButton) {
    switchRestaurantButton.hidden = !isSignedIn || !getSelectedRestaurant();
  }
}

function setAuthSession(session) {
  authToken = session.token || '';
  currentUser = session.user || null;

  if (authToken) {
    localStorage.setItem(authTokenKey, authToken);
  }

  if (currentUser) {
    localStorage.setItem(authUserKey, JSON.stringify(currentUser));
  }

  updateAuthUI();
}

function setAuthMode(mode) {
  const isSignup = mode === 'signup';

  if (loginForm) loginForm.hidden = isSignup;
  if (signupForm) signupForm.hidden = !isSignup;
  authModeSigninBtn?.classList.toggle('active', !isSignup);
  authModeSignupBtn?.classList.toggle('active', isSignup);

  if (loginError) loginError.textContent = '';
  if (signupError) signupError.textContent = '';

  if (isSignup) {
    signupBusinessNameInput?.focus();
  } else {
    loginEmailInput?.focus();
  }
}

function clearAuthSession() {
  authToken = '';
  currentUser = null;
  apiAvailable = false;
  adminUsers = [];
  restaurantWorkspaces = [];
  adminUserTotals = {};
  selectedTenantId = '';
  localStorage.removeItem(authTokenKey);
  localStorage.removeItem(authUserKey);
  localStorage.removeItem(selectedTenantKey);
  clearLocalOperationalData();
  updateAuthUI();
}

async function apiRequest(path, options = {}) {
  const { auth = true, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {})
  };

  if (auth && authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (auth && authToken && selectedTenantId) {
    headers['X-FiltraCore-Tenant-Id'] = selectedTenantId;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    if (response.status === 401 && auth) {
      clearAuthSession();
    }

    const message = typeof payload === 'object' && payload !== null && payload.error
      ? payload.error
      : `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload;
}

async function signIn(email, password) {
  const session = await apiRequest('/api/auth/login', {
    method: 'POST',
    auth: false,
    body: JSON.stringify({ username: email, password })
  });

  setAuthSession(session);
  clearSelectedRestaurant();
  await loadRestaurantWorkspaces();
  if (getSelectedRestaurant()) {
    await loadServerData();
  } else {
    clearLocalOperationalData();
    updateAuthUI();
  }
  renderApp();
}

async function signUpPublicAccount(payload) {
  const session = await apiRequest('/api/auth/signup', {
    method: 'POST',
    auth: false,
    body: JSON.stringify(payload)
  });

  setAuthSession(session);
  clearSelectedRestaurant();
  await loadRestaurantWorkspaces();
  clearLocalOperationalData();
  updateAuthUI();
  renderApp();
}

async function signOut() {
  try {
    if (authToken) {
      await apiRequest('/api/auth/logout', {
        method: 'POST'
      });
    }
  } catch (error) {
    console.warn('FiltraCore sign out could not reach the server.', error);
  }

  clearAuthSession();
}

async function loadServerData() {
  try {
    const state = await apiRequest('/api/state');
    apiAvailable = true;
    applyServerState(state);
  } catch (error) {
    apiAvailable = false;
    console.warn('FiltraCore API unavailable. Using local browser data.', error);
  }
}

function formatAccountDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleDateString();
}

function setAccountsStatus(message, tone = '') {
  if (!accountsStatus) return;

  accountsStatus.textContent = message;
  accountsStatus.dataset.tone = tone;
}

function renderAdminUsers() {
  if (accountsTotalUsers) accountsTotalUsers.textContent = adminUserTotals.users ?? adminUsers.length;
  if (accountsBusinesses) accountsBusinesses.textContent = adminUserTotals.businesses ?? 0;
  if (accountsDemoUsers) accountsDemoUsers.textContent = adminUserTotals.demoUsers ?? 0;
  if (accountsBrainUsers) accountsBrainUsers.textContent = adminUserTotals.brainUsers ?? 0;

  if (!accountsList) return;

  accountsList.innerHTML = '';

  if (!isBrainUser()) {
    accountsList.innerHTML = '<p class="empty-state">Only Bastida Systems can view account registrations.</p>';
    return;
  }

  if (!adminUsers.length) {
    accountsList.innerHTML = '<p class="empty-state">No accounts loaded.</p>';
    return;
  }

  adminUsers.forEach(user => {
    const row = document.createElement('article');
    row.className = 'account-row';
    row.innerHTML = `
      <div class="account-profile">
        ${getLogoMarkup(user, 'account-row-logo')}
        <div>
          <h3>${escapeHTML(user.businessName || 'Business')}</h3>
          <p>${escapeHTML(user.identityLabel || user.fullName || 'Owner')}</p>
          <strong>${escapeHTML(user.role || 'admin')}</strong>
        </div>
      </div>
      <div>
        <p>${escapeHTML(user.email || '')}</p>
        <span>Created ${escapeHTML(formatAccountDate(user.createdAt))}</span>
        <span>Last active ${escapeHTML(formatAccountDate(user.lastSessionAt))}</span>
      </div>
      <div class="account-row-metrics">
        <div><span>Machines</span><b>${Number(user.machines) || 0}</b></div>
        <div><span>Inventory</span><b>${Number(user.inventory) || 0}</b></div>
        <div><span>Filters</span><b>${Number(user.filters) || 0}</b></div>
        <div><span>Maint.</span><b>${Number(user.maintenanceRecords) || 0}</b></div>
      </div>
    `;
    accountsList.appendChild(row);
  });
}

function setRestaurantStatus(message, tone = '') {
  if (!restaurantStatus) return;

  restaurantStatus.textContent = message;
  restaurantStatus.dataset.tone = tone;
}

function clearSelectedRestaurant() {
  selectedTenantId = '';
  localStorage.removeItem(selectedTenantKey);
  clearLocalOperationalData();
}

function validateSelectedRestaurant() {
  if (selectedTenantId && !getSelectedRestaurant()) {
    clearSelectedRestaurant();
  }
}

function renderRestaurantAccessNotice(isBrain, clientAccountLabel, workspaces) {
  if (!restaurantAccessNotice) return;

  const showNotice = Boolean(authToken && !isBrain);
  restaurantAccessNotice.hidden = !showNotice;

  if (!showNotice) {
    restaurantAccessNotice.innerHTML = '';
    restaurantAccessNotice.className = 'restaurant-access-notice';
    return;
  }

  const valued = hasValuedMachineAccess(workspaces);
  restaurantAccessNotice.className = `restaurant-access-notice ${valued ? 'is-valued' : 'is-standard'}`;
  restaurantAccessNotice.innerHTML = valued
    ? `
      <div>
        <span>Plan access</span>
        <h3>Unlimited Machine Access</h3>
        <p>${escapeHTML(clientAccountLabel)} is a valued early FiltraCore client. Every workspace under this account can register unlimited machines. Standard accounts include up to ${standardMachineLimit} machines per workspace.</p>
      </div>
      <strong>Unlimited</strong>
    `
    : `
      <div>
        <span>Standard plan</span>
        <h3>${standardMachineLimit} machines included</h3>
        <p>Upgrade your plan or buy more machine access to install additional machines in any workspace.</p>
      </div>
      <strong>Upgrade available</strong>
    `;
}

function renderRestaurantSelector() {
  if (!restaurantList) return;

  const isBrain = isBrainUser();
  const workspaces = getRestaurantWorkspaces();
  const primaryWorkspace = workspaces[0] || null;
  const clientAccountLabel = primaryWorkspace?.identityLabel
    || currentUser?.name
    || currentUser?.tenantName
    || 'Client account';

  restaurantScreen?.classList.toggle('client-picker', Boolean(authToken && !isBrain));
  if (restaurantForm) restaurantForm.hidden = Boolean(authToken && !isBrain);
  if (refreshRestaurantsBtn) refreshRestaurantsBtn.hidden = Boolean(authToken && !isBrain);
  if (clientAddWorkspaceButton) {
    clientAddWorkspaceButton.hidden = !authToken || isBrain;
    clientAddWorkspaceButton.title = `Add a workspace to ${clientAccountLabel}`;
    clientAddWorkspaceButton.setAttribute('aria-label', `Add a workspace to ${clientAccountLabel}`);
  }

  if (restaurantContextLabel) {
    restaurantContextLabel.textContent = isBrain
      ? 'Bastida Systems Cerebro'
      : `${clientAccountLabel} account`.toUpperCase();
  }

  if (restaurantTitle) {
    restaurantTitle.textContent = isBrain ? 'Choose Restaurant' : 'Choose restaurant';
  }

  if (restaurantSubtitle) {
    restaurantSubtitle.textContent = isBrain
      ? 'Select the business workspace you want to operate. Each restaurant opens with its own machines, filters, inventory, maintenance history, and reports.'
      : `Each card is a restaurant or venue under ${clientAccountLabel}. Open one to see only its machines, filters, inventory, and maintenance.`;
  }

  renderRestaurantAccessNotice(isBrain, clientAccountLabel, workspaces);

  restaurantList.innerHTML = '';
  if (restaurantTotalWorkspaces) restaurantTotalWorkspaces.textContent = '0';
  if (restaurantTotalMachines) restaurantTotalMachines.textContent = '0';
  if (restaurantTotalFilters) restaurantTotalFilters.textContent = '0';

  if (!authToken) {
    restaurantList.innerHTML = '<p class="empty-state">Sign in to choose a restaurant.</p>';
    return;
  }

  if (!workspaces.length) {
    restaurantList.innerHTML = '<p class="empty-state">No restaurants loaded yet.</p>';
    return;
  }

  const totals = workspaces.reduce((summary, user) => ({
    workspaces: summary.workspaces + 1,
    machines: summary.machines + (Number(user.machines) || 0),
    filters: summary.filters + (Number(user.filters) || 0)
  }), { workspaces: 0, machines: 0, filters: 0 });

  if (restaurantTotalWorkspaces) restaurantTotalWorkspaces.textContent = totals.workspaces;
  if (restaurantTotalMachines) restaurantTotalMachines.textContent = totals.machines;
  if (restaurantTotalFilters) restaurantTotalFilters.textContent = totals.filters;

  const valuedAccount = hasValuedMachineAccess(workspaces);
  const planBadgeMarkup = valuedAccount
    ? '<span class="client-workspace-plan is-valued">Unlimited machine access</span>'
    : `<span class="client-workspace-plan is-standard">${standardMachineLimit} machine Standard plan</span>`;

  workspaces.forEach((user, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `restaurant-card${isBrain ? '' : ' client-workspace-card'}`;
    button.dataset.tenantId = user.tenantId;
    const isCurrent = String(user.tenantId) === String(selectedTenantId);
    const label = user.identityLabel || user.role || 'Workspace';
    const lastActivity = user.lastSessionAt
      ? new Date(user.lastSessionAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : 'No recent session';

    button.innerHTML = isBrain
      ? `
        <div class="restaurant-card-main">
          ${getLogoMarkup(user)}
          <div>
            <span class="restaurant-card-kicker">${escapeHTML(label)}</span>
            <h3>${escapeHTML(user.businessName || 'Restaurant')}</h3>
            <p>${escapeHTML(user.fullName || 'Admin')} · ${escapeHTML(user.email || '')}</p>
          </div>
        </div>
        <div class="restaurant-card-metrics" aria-label="Workspace metrics">
          <div><strong>${Number(user.machines) || 0}</strong><span>Machines</span></div>
          <div><strong>${Number(user.filters) || 0}</strong><span>Filters</span></div>
          <div><strong>${Number(user.maintenanceRecords) || 0}</strong><span>Service</span></div>
        </div>
        <div class="restaurant-card-footer">
          <span>Last activity: ${escapeHTML(lastActivity)}</span>
          <strong>${isCurrent ? 'Current' : 'Open'}</strong>
        </div>
      `
      : `
        <div class="restaurant-card-main">
          ${getLogoMarkup(user)}
          <div>
            <h3>${escapeHTML(user.businessName || currentUser?.tenantName || 'Restaurant')}</h3>
            <p>${escapeHTML(user.identityLabel || 'Restaurant')} · ${index === 0 ? 'Primary restaurant' : 'Restaurant workspace'}</p>
            ${planBadgeMarkup}
          </div>
        </div>
        <div class="restaurant-card-metrics" aria-label="Restaurant metrics">
          <div><strong>${Number(user.machines) || 0}</strong><span>Machines</span></div>
          <div><strong>${Number(user.filters) || 0}</strong><span>Filters</span></div>
          <div><strong>${Number(user.inventory) || 0}</strong><span>Inventory</span></div>
        </div>
      `;
    restaurantList.appendChild(button);
  });
}

function renderRestaurantLogoPreview() {
  if (!restaurantLogoPreview) return;

  restaurantLogoPreview.hidden = false;
  restaurantLogoPreview.innerHTML = restaurantLogoDataUrl
    ? `<img src="${escapeHTML(restaurantLogoDataUrl)}" alt="Selected restaurant logo" /><span>Logo selected</span>`
    : '<span>No logo selected</span>';
}

function clearRestaurantLogo() {
  restaurantLogoDataUrl = '';
  if (restaurantLogoInput) restaurantLogoInput.value = '';
  renderRestaurantLogoPreview();
}

function loadRestaurantLogoFile(file) {
  if (!file) {
    clearRestaurantLogo();
    return;
  }

  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    clearRestaurantLogo();
    setRestaurantStatus('Logo must be a PNG or JPG image.', 'error');
    return;
  }

  if (file.size > 800 * 1024) {
    clearRestaurantLogo();
    setRestaurantStatus('Logo image must be under 800 KB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    restaurantLogoDataUrl = String(reader.result || '');
    renderRestaurantLogoPreview();
    setRestaurantStatus('Logo ready.', 'success');
  };
  reader.onerror = () => {
    clearRestaurantLogo();
    setRestaurantStatus('Unable to read that logo file.', 'error');
  };
  reader.readAsDataURL(file);
}

function setClientWorkspaceStatus(message, tone = '') {
  if (!clientWorkspaceStatus) return;

  clientWorkspaceStatus.textContent = message;
  clientWorkspaceStatus.dataset.tone = tone;
}

function renderClientWorkspaceLogoPreview() {
  if (!clientWorkspaceLogoPreview) return;

  clientWorkspaceLogoPreview.hidden = false;
  clientWorkspaceLogoPreview.innerHTML = clientWorkspaceLogoDataUrl
    ? `<img src="${escapeHTML(clientWorkspaceLogoDataUrl)}" alt="Selected workspace logo" /><span>Logo selected</span>`
    : '<span>No logo selected</span>';
}

function clearClientWorkspaceLogo() {
  clientWorkspaceLogoDataUrl = '';
  if (clientWorkspaceLogoInput) clientWorkspaceLogoInput.value = '';
  renderClientWorkspaceLogoPreview();
}

function loadClientWorkspaceLogoFile(file) {
  if (!file) {
    clearClientWorkspaceLogo();
    return;
  }

  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    clearClientWorkspaceLogo();
    setClientWorkspaceStatus('Logo must be a PNG or JPG image.', 'error');
    return;
  }

  if (file.size > 800 * 1024) {
    clearClientWorkspaceLogo();
    setClientWorkspaceStatus('Logo image must be under 800 KB.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    clientWorkspaceLogoDataUrl = String(reader.result || '');
    renderClientWorkspaceLogoPreview();
    setClientWorkspaceStatus('Logo ready.', 'success');
  };
  reader.onerror = () => {
    clearClientWorkspaceLogo();
    setClientWorkspaceStatus('Unable to read that logo file.', 'error');
  };
  reader.readAsDataURL(file);
}

function openClientWorkspaceModal() {
  if (!authToken || isBrainUser() || !clientWorkspaceModal) return;

  clientWorkspaceModal.hidden = false;
  clientWorkspaceModal.classList.add('is-open');
  setClientWorkspaceStatus('');
  if (clientWorkspaceBusinessTypeInput) clientWorkspaceBusinessTypeInput.value = 'Restaurant';
  if (clientWorkspaceIdentityLabelInput && !clientWorkspaceIdentityLabelInput.value) {
    clientWorkspaceIdentityLabelInput.value = getRestaurantWorkspaces()[0]?.identityLabel || '';
  }
  renderClientWorkspaceLogoPreview();
  clientWorkspaceBusinessNameInput?.focus();
}

function closeClientWorkspaceModal() {
  if (!clientWorkspaceModal) return;

  clientWorkspaceModal.classList.remove('is-open');
  clientWorkspaceModal.hidden = true;
  setClientWorkspaceStatus('');
}

async function createClientWorkspace() {
  if (!clientWorkspaceForm || !authToken || isBrainUser()) return;

  const payload = {
    businessName: clientWorkspaceBusinessNameInput?.value.trim() || '',
    businessType: clientWorkspaceBusinessTypeInput?.value || 'Restaurant',
    identityLabel: clientWorkspaceIdentityLabelInput?.value.trim() || getRestaurantWorkspaces()[0]?.identityLabel || '',
    logoDataUrl: clientWorkspaceLogoDataUrl
  };

  if (!payload.businessName) {
    setClientWorkspaceStatus('Business or location name is required.', 'error');
    clientWorkspaceBusinessNameInput?.focus();
    return;
  }

  setClientWorkspaceStatus('Creating workspace...');
  setFormBusy(clientWorkspaceForm, true);
  if (clientWorkspaceSubmitButton) clientWorkspaceSubmitButton.textContent = 'Creating...';

  try {
    const response = await apiRequest('/api/restaurants', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    restaurantWorkspaces = Array.isArray(response.users) ? response.users : restaurantWorkspaces;
    clientWorkspaceForm.reset();
    clearClientWorkspaceLogo();
    renderRestaurantSelector();
    closeClientWorkspaceModal();
    if (response.user?.tenantId) {
      await openRestaurant(response.user.tenantId);
    } else {
      updateAuthUI();
    }
  } catch (error) {
    console.error(error);
    setClientWorkspaceStatus(error.message || 'Unable to create workspace.', 'error');
  } finally {
    setFormBusy(clientWorkspaceForm, false);
    if (clientWorkspaceSubmitButton) clientWorkspaceSubmitButton.textContent = 'Create Workspace';
  }
}

async function openRestaurant(tenantId) {
  selectedTenantId = String(tenantId || '');
  localStorage.setItem(selectedTenantKey, selectedTenantId);
  updateAuthUI();
  clearLocalOperationalData();
  await loadServerData();
  renderApp();
  showSection('dashboard');
  setActiveNavById('dashboard');
}

async function loadRestaurantWorkspaces() {
  if (!authToken) {
    adminUsers = [];
    restaurantWorkspaces = [];
    adminUserTotals = {};
    renderAdminUsers();
    renderRestaurantSelector();
    return;
  }

  if (isBrainUser()) {
    setAccountsStatus('Loading account registrations...');
  }

  try {
    const payload = await apiRequest('/api/restaurants');
    const users = Array.isArray(payload.users) ? payload.users : [];

    if (isBrainUser()) {
      adminUsers = users;
      restaurantWorkspaces = [];
      adminUserTotals = payload.totals || {};
      setAccountsStatus(adminUsers.length ? 'Accounts synced from Render.' : 'No accounts yet.', 'success');
    } else {
      restaurantWorkspaces = users;
      adminUsers = [];
      adminUserTotals = {};
    }

    validateSelectedRestaurant();
    renderAdminUsers();
    renderRestaurantSelector();
    updateAuthUI();
  } catch (error) {
    console.error(error);
    if (isBrainUser()) {
      setAccountsStatus(error.message || 'Unable to load accounts.', 'error');
    }
    renderRestaurantSelector();
    updateAuthUI();
  }
}

async function loadAdminUsers() {
  return loadRestaurantWorkspaces();
}

async function createRestaurantAccount() {
  if (!restaurantForm) return;

  const payload = {
    businessName: restaurantBusinessNameInput?.value.trim() || '',
    identityLabel: restaurantIdentityLabelInput?.value.trim() || '',
    fullName: restaurantOwnerNameInput?.value.trim() || '',
    email: restaurantLoginInput?.value.trim() || '',
    password: restaurantPasswordInput?.value || '',
    businessType: restaurantBusinessTypeInput?.value || 'Restaurant',
    logoDataUrl: restaurantLogoDataUrl
  };

  if (!payload.businessName || !payload.fullName || !payload.email.includes('@') || !payload.email.includes('.') || payload.password.length < 6) {
    setRestaurantStatus('Business, owner, account email, and a 6+ character password are required.', 'error');
    return;
  }

  setRestaurantStatus('Creating restaurant workspace...');
  setFormBusy(restaurantForm, true);
  if (restaurantSubmitButton) restaurantSubmitButton.textContent = 'Creating...';

  try {
    const response = await apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    adminUsers = Array.isArray(response.users) ? response.users : adminUsers;
    adminUserTotals = response.totals || adminUserTotals;
    restaurantForm.reset();
    clearRestaurantLogo();
    renderAdminUsers();
    renderRestaurantSelector();
    setRestaurantStatus('Restaurant created. Opening workspace...', 'success');
    await openRestaurant(response.user?.tenantId);
  } catch (error) {
    console.error(error);
    setRestaurantStatus(error.message || 'Unable to create restaurant.', 'error');
  } finally {
    setFormBusy(restaurantForm, false);
    if (restaurantSubmitButton) restaurantSubmitButton.textContent = 'Add and Open';
  }
}

function renderApp() {
  renderMachines();
  updateMachineOptions();
  updateInventoryOptions();
  updateSupplierOptions();
  updateMaintenanceOptions();
  syncFilterScheduleFields(true);
  renderFilters();
  renderInventory();
  renderSuppliers();
  renderMaintenance();
  renderCostMetrics();
  renderCostPerMachine();
  renderEnterpriseDashboard();
  renderRiskScore();
  renderFinancialMetrics();
  renderReports();
  renderAdminUsers();
  renderSmartSetup();
  renderSmartImportPreview();
}

function setFormBusy(form, isBusy) {
  if (!form) return;

  form.querySelectorAll('button, input, select, textarea').forEach(element => {
    element.disabled = Boolean(isBusy);
  });
}

function showSaveError(error) {
  console.error(error);
  alert(error.message || 'Unable to save. Check the server connection and try again.');
}

const loginForm = document.querySelector('#login-form');
const signupForm = document.querySelector('#signup-form');
const authModeSigninBtn = document.querySelector('#auth-mode-signin');
const authModeSignupBtn = document.querySelector('#auth-mode-signup');
const backToLoginBtn = document.querySelector('#back-to-login');
const loginEmailInput = document.querySelector('#login-email');
const loginPasswordInput = document.querySelector('#login-password');
const loginError = document.querySelector('#login-error');
const loginSubmitButton = document.querySelector('#login-submit');
const signupBusinessTypeInput = document.querySelector('#signup-business-type');
const signupBusinessNameInput = document.querySelector('#signup-business-name');
const signupFullNameInput = document.querySelector('#signup-full-name');
const signupEmailInput = document.querySelector('#signup-email');
const signupPasswordInput = document.querySelector('#signup-password');
const signupConfirmPasswordInput = document.querySelector('#signup-confirm-password');
const signupError = document.querySelector('#signup-error');
const signupSubmitButton = document.querySelector('#signup-submit');
const restaurantLogoutButton = document.querySelector('#restaurant-logout-button');
const logoutButton = document.querySelector('#logout-button');
const switchRestaurantButton = document.querySelector('#switch-restaurant-button');
const restaurantScreen = document.querySelector('#restaurant-screen');
const restaurantList = document.querySelector('#restaurant-list');
const restaurantAccessNotice = document.querySelector('#restaurant-access-notice');
const refreshRestaurantsBtn = document.querySelector('#refresh-restaurants');
const restaurantContextLabel = document.querySelector('#restaurant-context-label');
const restaurantTitle = document.querySelector('#restaurant-title');
const restaurantSubtitle = document.querySelector('#restaurant-subtitle');
const restaurantTotalWorkspaces = document.querySelector('#restaurant-total-workspaces');
const restaurantTotalMachines = document.querySelector('#restaurant-total-machines');
const restaurantTotalFilters = document.querySelector('#restaurant-total-filters');
const restaurantForm = document.querySelector('#restaurant-form');
const restaurantBusinessNameInput = document.querySelector('#restaurant-business-name');
const restaurantIdentityLabelInput = document.querySelector('#restaurant-identity-label');
const restaurantLogoInput = document.querySelector('#restaurant-logo');
const restaurantLogoPreview = document.querySelector('#restaurant-logo-preview');
const restaurantOwnerNameInput = document.querySelector('#restaurant-owner-name');
const restaurantLoginInput = document.querySelector('#restaurant-login');
const restaurantPasswordInput = document.querySelector('#restaurant-password');
const restaurantBusinessTypeInput = document.querySelector('#restaurant-business-type');
const restaurantSubmitButton = document.querySelector('#restaurant-submit');
const restaurantStatus = document.querySelector('#restaurant-status');
const clientAddWorkspaceButton = document.querySelector('#client-add-workspace-button');
const clientWorkspaceModal = document.querySelector('#client-workspace-modal');
const clientWorkspaceForm = document.querySelector('#client-workspace-form');
const clientWorkspaceCloseButton = document.querySelector('#client-workspace-close');
const clientWorkspaceBusinessNameInput = document.querySelector('#client-workspace-business-name');
const clientWorkspaceBusinessTypeInput = document.querySelector('#client-workspace-business-type');
const clientWorkspaceIdentityLabelInput = document.querySelector('#client-workspace-identity-label');
const clientWorkspaceLogoInput = document.querySelector('#client-workspace-logo');
const clientWorkspaceLogoPreview = document.querySelector('#client-workspace-logo-preview');
const clientWorkspaceSubmitButton = document.querySelector('#client-workspace-submit');
const clientWorkspaceStatus = document.querySelector('#client-workspace-status');
const machineForm = document.querySelector('#machine-form');
const machinesList = document.querySelector('#machines-list');
const machineSearchInput = document.querySelector('#machine-search');
const machineResultsCount = document.querySelector('#machine-results-count');
const enterpriseOverview = document.querySelector('#enterprise-overview');
const facilityOverviewList = document.querySelector('#facility-overview-list');
const psiAnalyticsGrid = document.querySelector('#psi-analytics-grid');
const upcomingReplacementsList = document.querySelector('#upcoming-replacements-list');
const dashboardMachinesRisk = document.querySelector('#dashboard-machines-risk');
const dashboardAlertsCount = document.querySelector('#dashboard-alerts-count');
const dashboardMachinesRiskFilterBtn = document.querySelector('#dashboard-machines-risk-filter');
const dashboardAlertsFilterBtn = document.querySelector('#dashboard-alerts-filter');
const machinesRiskFilterBtn = document.querySelector('#machines-risk-filter');
const smartSetupShell = document.querySelector('#smart-setup-shell');
const smartSetupPanel = document.querySelector('#smart-setup-panel');
const smartSetupList = document.querySelector('#smart-setup-list');
const smartSetupCount = document.querySelector('#smart-setup-count');
const smartProgressBar = document.querySelector('#smart-progress-bar');
const smartSetupToggle = document.querySelector('#smart-setup-toggle');
const smartSetupToggleCount = document.querySelector('#smart-setup-toggle-count');
const smartSetupToggleBar = document.querySelector('#smart-setup-toggle-bar');
const smartSetupClose = document.querySelector('#smart-setup-close');
const totalMachinesKpi = document.querySelectorAll('.kpi-card strong')[0];
const filterMachineSelect = document.querySelector('#filter-machine');
const filterProductSelect = document.querySelector('#filter-product');
const filterQuantityInput = document.querySelector('#filter-quantity');
const filterPsiMinInput = document.querySelector('#filter-psi-min');
const filterPsiMaxInput = document.querySelector('#filter-psi-max');
const filterLifeMonthsInput = document.querySelector('#filter-life-months');
const filterInstalledAtInput = document.querySelector('#filter-installed-at');
const filterDueDateInput = document.querySelector('#filter-due-date');
const filterForm = document.querySelector('#filter-form');
const filtersList = document.querySelector('#filters-list');
const filtersSearchInput = document.querySelector('#filters-search');
const filtersResultsCount = document.querySelector('#filters-results-count');
const filtersTotalKpi = document.querySelector('#filters-total-kpi');
const filtersHealthyKpi = document.querySelector('#filters-healthy-kpi');
const filtersWatchKpi = document.querySelector('#filters-watch-kpi');
const filtersCriticalKpi = document.querySelector('#filters-critical-kpi');
const filtersHealthyFilterBtn = document.querySelector('#filters-healthy-filter');
const filtersWatchFilterBtn = document.querySelector('#filters-watch-filter');
const filtersCriticalFilterBtn = document.querySelector('#filters-critical-filter');
const kpis = document.querySelectorAll('.kpi-card strong');
const riskPanel = document.querySelector('#risk-panel');
const riskList = document.querySelector('#risk-list');
const inventoryForm = document.querySelector('#inventory-form');
const inventoryList = document.querySelector('#inventory-list');
const inventorySearchInput = document.querySelector('#inventory-search');
const inventoryResultsCount = document.querySelector('#inventory-results-count');
const inventoryTotalKpi = document.querySelector('#inventory-total-kpi');
const inventoryLowStockKpi = document.querySelector('#inventory-low-stock-kpi');
const inventoryValueKpi = document.querySelector('#inventory-value-kpi');
const inventoryReorderKpi = document.querySelector('#inventory-reorder-kpi');
const supplierForm = document.querySelector('#supplier-form');
const supplierNameInput = document.querySelector('#supplier-name');
const supplierContactInput = document.querySelector('#supplier-contact');
const supplierEmailInput = document.querySelector('#supplier-email');
const supplierPhoneInput = document.querySelector('#supplier-phone');
const supplierWebsiteInput = document.querySelector('#supplier-website');
const supplierCategoryInput = document.querySelector('#supplier-category');
const supplierStatusInput = document.querySelector('#supplier-status');
const supplierNotesInput = document.querySelector('#supplier-notes');
const supplierProductForm = document.querySelector('#supplier-product-form');
const supplierProductInventorySelect = document.querySelector('#supplier-product-inventory');
const supplierProductSupplierSelect = document.querySelector('#supplier-product-supplier');
const supplierProductSkuInput = document.querySelector('#supplier-product-sku');
const supplierProductPriceInput = document.querySelector('#supplier-product-price');
const supplierProductNotesInput = document.querySelector('#supplier-product-notes');
const purchaseOrderForm = document.querySelector('#purchase-order-form');
const purchaseOrderSupplierSelect = document.querySelector('#purchase-order-supplier');
const purchaseOrderProductSelect = document.querySelector('#purchase-order-product');
const purchaseOrderQuantityInput = document.querySelector('#purchase-order-quantity');
const purchaseOrderStatusInput = document.querySelector('#purchase-order-status');
const purchaseOrderExpectedDateInput = document.querySelector('#purchase-order-expected-date');
const purchaseOrderNotesInput = document.querySelector('#purchase-order-notes');
const suppliersSearchInput = document.querySelector('#suppliers-search');
const suppliersResultsCount = document.querySelector('#suppliers-results-count');
const suppliersTotalKpi = document.querySelector('#suppliers-total-kpi');
const supplierProductsKpi = document.querySelector('#supplier-products-kpi');
const supplierPriceChangesKpi = document.querySelector('#supplier-price-changes-kpi');
const supplierIncreaseAlertsKpi = document.querySelector('#supplier-increase-alerts-kpi');
const supplierCriticalProductsKpi = document.querySelector('#supplier-critical-products-kpi');
const supplierBestSuggestionKpi = document.querySelector('#supplier-best-suggestion-kpi');
const suppliersList = document.querySelector('#suppliers-list');
const supplierProductsList = document.querySelector('#supplier-products-list');
const supplierComparisonList = document.querySelector('#supplier-comparison-list');
const purchaseOrdersList = document.querySelector('#purchase-orders-list');
const maintenanceForm = document.querySelector('#maintenance-form');
const maintenanceMachineSelect = document.querySelector('#maintenance-machine');
const maintenanceFilterSelect = document.querySelector('#maintenance-filter');
const maintenanceReplacementProductSelect = document.querySelector('#maintenance-replacement-product');
const maintenanceTechnicianNameInput = document.querySelector('#maintenance-technician-name');
const maintenancePriorityInput = document.querySelector('#maintenance-priority');
const maintenanceInspectionStatusInput = document.querySelector('#maintenance-inspection-status');
const maintenanceNextDueDateInput = document.querySelector('#maintenance-next-due-date');
const maintenanceCurrentPsiInput = document.querySelector('#maintenance-current-psi');
const maintenanceCorrectedPsiInput = document.querySelector('#maintenance-corrected-psi');
const maintenancePsiChart = document.querySelector('#maintenance-psi-chart');
const maintenanceList = document.querySelector('#maintenance-list');
const maintenanceSearchInput = document.querySelector('#maintenance-search');
const maintenanceResultsCount = document.querySelector('#maintenance-results-count');
const maintenanceTotalKpi = document.querySelector('#maintenance-total-kpi');
const maintenanceWarningKpi = document.querySelector('#maintenance-warning-kpi');
const maintenanceCriticalKpi = document.querySelector('#maintenance-critical-kpi');
const maintenanceReplacementKpi = document.querySelector('#maintenance-replacement-kpi');
const monthlySpendKpi = document.querySelector('#monthly-spend');
const annualSpendKpi = document.querySelector('#annual-spend');
const riskExposureEl = document.querySelector('#risk-exposure');
const savingsEl = document.querySelector('#potential-savings');
const alertCountEl = document.querySelector('#alert-count');
const alertSummaryEl = document.querySelector('#alert-summary');
const toggleAlertsBtn = document.querySelector('#toggle-alerts');
const archiveAllAlertsBtn = document.querySelector('#archive-all-alerts');
const openAlertsCard = document.querySelector('#open-alerts-card');
const alertsModal = document.querySelector('#alerts-modal');
const closeAlertsModal = document.querySelector('#close-alerts-modal');
const closeAlertsModalFooter = document.querySelector('#close-alerts-modal-footer');
const archiveAllModalAlerts = document.querySelector('#archive-all-modal-alerts');
const modalAlertsList = document.querySelector('#modal-alerts-list');
const modalAlertCount = document.querySelector('#modal-alert-count');
const modalCriticalCount = document.querySelector('#modal-critical-count');
const modalWarningCount = document.querySelector('#modal-warning-count');
const modalRiskExposure = document.querySelector('#modal-risk-exposure');
const machineQRModal = document.querySelector('#machine-qr-modal');
const closeMachineQRModal = document.querySelector('#close-machine-qr-modal');
const closeMachineQRModalFooter = document.querySelector('#close-machine-qr-modal-footer');
const printMachineQRBtn = document.querySelector('#print-machine-qr');
const machineQRModalTitle = document.querySelector('#machine-qr-modal-title');
const machineQRModalSubtitle = document.querySelector('#machine-qr-modal-subtitle');
const machineQRCode = document.querySelector('#machine-qr-code');
const machineQRDisplayCode = document.querySelector('#machine-qr-display-code');
const machineQRPayload = document.querySelector('#machine-qr-payload');
const openManualCard = document.querySelector('#open-manual-card');
const manualModal = document.querySelector('#manual-modal');
const closeManualModal = document.querySelector('#close-manual-modal');
const closeManualModalFooter = document.querySelector('#close-manual-modal-footer');
const reportsTotalSpend = document.querySelector('#reports-total-spend');
const reportsPotentialSavings = document.querySelector('#reports-potential-savings');
const reportsRiskExposure = document.querySelector('#reports-risk-exposure');
const reportsPendingMaintenance = document.querySelector('#reports-pending-maintenance');
const reportsHealthBadge = document.querySelector('#reports-health-badge');
const reportsTotalMachines = document.querySelector('#reports-total-machines');
const reportsMachinesRisk = document.querySelector('#reports-machines-risk');
const reportsInstalledFilters = document.querySelector('#reports-installed-filters');
const reportsAlertsCount = document.querySelector('#reports-alerts-count');
const reportsAvgFilterCost = document.querySelector('#reports-avg-filter-cost');
const reportsMonthlySpend = document.querySelector('#reports-monthly-spend');
const reportsAnnualSpend = document.querySelector('#reports-annual-spend');
const reportsInventoryTotal = document.querySelector('#reports-inventory-total');
const reportsLowStock = document.querySelector('#reports-low-stock');
const reportsReorderNeeded = document.querySelector('#reports-reorder-needed');
const reportsInventoryValue = document.querySelector('#reports-inventory-value');
const generateReportSummaryBtn = document.querySelector('#generate-report-summary');
const printReportBtn = document.querySelector('#print-report');
const reportOutputCard = document.querySelector('#report-output-card');
const reportOutput = document.querySelector('#report-output');
const accountsTotalUsers = document.querySelector('#accounts-total-users');
const accountsBusinesses = document.querySelector('#accounts-businesses');
const accountsDemoUsers = document.querySelector('#accounts-demo-users');
const accountsBrainUsers = document.querySelector('#accounts-brain-users');
const accountsStatus = document.querySelector('#accounts-status');
const accountsList = document.querySelector('#accounts-list');
const refreshAccountsBtn = document.querySelector('#refresh-accounts');
const generateMaintenanceReportBtn = document.querySelector('#generate-maintenance-report');
const printMaintenanceReportBtn = document.querySelector('#print-maintenance-report');
const closeMaintenanceReportBtn = document.querySelector('#close-maintenance-report');
const maintenanceReportOutputCard = document.querySelector('#maintenance-report-output-card');
const maintenanceReportOutput = document.querySelector('#maintenance-report-output');
const smartImportForm = document.querySelector('#smart-import-form');
const smartImportFileInput = document.querySelector('#smart-import-file');
const smartImportTextInput = document.querySelector('#smart-import-text');
const smartImportStatus = document.querySelector('#smart-import-status');
const smartImportPreview = document.querySelector('#smart-import-preview');
const applySmartImportBtn = document.querySelector('#apply-smart-import');
let alertsExpanded = false;
let archivedAlerts = loadStoredArray('filtracore_archivedAlerts');
let pendingImportPreview = null;
const setupState = loadStoredObject('filtracore_setupState', {
  dashboardReviewed: false,
  reportGenerated: false,
  widgetOpen: true
});

if (setupState.widgetOpen === undefined) {
  setupState.widgetOpen = true;
}

let smartSetupUserInteracted = false;

function showSection(id) {
  sections.forEach(section => {
    section.style.display = 'none';
  });

  if (id === 'dashboard') {
    document.querySelector('#dashboard').style.display = 'flex';
    document.querySelector('.kpi-grid').style.display = 'grid';
    if (enterpriseOverview) enterpriseOverview.style.display = 'grid';
    if (riskPanel) riskPanel.style.display = 'block';
  } else {
    document.querySelector('#dashboard').style.display = 'none';
    document.querySelector('.kpi-grid').style.display = 'none';
    if (enterpriseOverview) enterpriseOverview.style.display = 'none';
    if (riskPanel) riskPanel.style.display = 'none';
    document.querySelector('#' + id).style.display = 'block';
  }

}

function saveSetupState() {
  localStorage.setItem('filtracore_setupState', JSON.stringify(setupState));
}

function setSmartSetupOpen(isOpen, manual = false) {
  if (manual) {
    smartSetupUserInteracted = true;
  }

  setupState.widgetOpen = Boolean(isOpen);
  saveSetupState();

  if (smartSetupShell) {
    smartSetupShell.classList.toggle('is-open', setupState.widgetOpen);
  }

  if (smartSetupToggle) {
    smartSetupToggle.setAttribute('aria-expanded', String(setupState.widgetOpen));
  }
}

function hasConfiguredFilterSchedule() {
  return filters.some(filter => {
    return Number(filter.lifeMonths) > 0 && Boolean(filter.installedAt) && Boolean(filter.dueDate);
  });
}

function getSmartSetupTasks() {
  const hasMachine = machines.length > 0;
  const hasFilter = filters.length > 0;
  const hasSchedule = hasConfiguredFilterSchedule();
  const dashboardReviewed = hasSchedule && Boolean(setupState.dashboardReviewed);
  const reportGenerated = dashboardReviewed && Boolean(setupState.reportGenerated);

  return [
    {
      key: 'register-machine',
      title: 'Register Machine',
      description: 'Add the machine first with location, department, brand, model, and machine ID.',
      completed: hasMachine,
      actionLabel: 'Add Machine'
    },
    {
      key: 'add-filter',
      title: 'Add Filter',
      description: 'Add a filter and connect it to the registered machine.',
      completed: hasMachine && hasFilter,
      actionLabel: 'Install Filter'
    },
    {
      key: 'set-lifespan',
      title: 'Set Lifespan / Due Date',
      description: 'Define the filter lifespan, installation date, and replacement due date.',
      completed: hasMachine && hasFilter && hasSchedule,
      actionLabel: 'Set Schedule'
    },
    {
      key: 'review-dashboard',
      title: 'Review Dashboard Status',
      description: 'Check filter status, upcoming replacements, critical alerts, and machine health.',
      completed: dashboardReviewed,
      actionLabel: 'Mark Reviewed'
    },
    {
      key: 'generate-report',
      title: 'Generate Report',
      description: 'Create a maintenance report for management, compliance, or operational review.',
      completed: reportGenerated,
      actionLabel: 'Generate Report'
    }
  ];
}

function renderSmartSetup() {
  if (!smartSetupList || !smartSetupCount || !smartProgressBar) return;

  const tasks = getSmartSetupTasks();
  const completedCount = tasks.filter(task => task.completed).length;
  const nextTaskIndex = tasks.findIndex(task => !task.completed);
  const progress = Math.round((completedCount / tasks.length) * 100);
  const isSetupComplete = completedCount === tasks.length;

  smartSetupCount.textContent = `${completedCount}/${tasks.length} completed`;
  smartProgressBar.style.width = `${progress}%`;

  if (smartSetupToggleCount) {
    smartSetupToggleCount.textContent = `${completedCount}/${tasks.length}`;
  }

  if (smartSetupToggleBar) {
    smartSetupToggleBar.style.width = `${progress}%`;
  }

  if (smartSetupShell) {
    smartSetupShell.classList.toggle('is-complete', isSetupComplete);
  }

  if (isSetupComplete && setupState.widgetOpen) {
    setSmartSetupOpen(false);
  } else if (!isSetupComplete && !smartSetupUserInteracted && !setupState.widgetOpen) {
    setSmartSetupOpen(true);
  }

  smartSetupList.innerHTML = tasks.map((task, index) => {
    const isComplete = task.completed;
    const isActive = !isComplete && index === nextTaskIndex;
    const isLocked = !isComplete && nextTaskIndex !== -1 && index > nextTaskIndex;
    const statusLabel = isComplete ? 'Completed' : isActive ? 'Next step' : 'Locked';
    const actionLabel = isComplete ? 'View' : task.actionLabel;

    return `
      <div class="smart-setup-item ${isComplete ? 'is-complete' : ''} ${isActive ? 'is-active' : ''} ${isLocked ? 'is-locked' : ''}">
        <div class="smart-check" aria-hidden="true">${isComplete ? '✓' : index + 1}</div>
        <div class="smart-task-copy">
          <div class="smart-task-title-row">
            <h3>${escapeHTML(task.title)}</h3>
            <span>${escapeHTML(statusLabel)}</span>
          </div>
          <p>${escapeHTML(task.description)}</p>
        </div>
        <button type="button" class="smart-task-action" data-setup-action="${escapeHTML(task.key)}" ${isLocked ? 'disabled' : ''}>
          ${escapeHTML(actionLabel)}
        </button>
      </div>
    `;
  }).join('');
}

function handleSmartSetupAction(action) {
  if (window.matchMedia('(max-width: 760px)').matches) {
    setSmartSetupOpen(false, true);
  }

  if (action === 'register-machine') {
    openMachinesSection();
    document.querySelector('#machine-name')?.focus();
    return;
  }

  if (action === 'add-filter') {
    if (machines.length === 0) {
      openMachinesSection();
      document.querySelector('#machine-name')?.focus();
      return;
    }

    openFiltersSection();
    filterMachineSelect?.focus();
    return;
  }

  if (action === 'set-lifespan') {
    if (filters.length === 0) {
      openFiltersSection();
      filterProductSelect?.focus();
      return;
    }

    openFiltersSection();
    filterLifeMonthsInput?.focus();
    return;
  }

  if (action === 'review-dashboard') {
    showSection('dashboard');
    setActiveNavById('dashboard');
    setupState.dashboardReviewed = true;
    saveSetupState();
    renderSmartSetup();
    return;
  }

  if (action === 'generate-report') {
    showSection('reports');
    setActiveNavById('reports');
    renderReports();
    generateReportSummary();
  }
}

function renderPsiChart(psiHistory) {
  if (!Array.isArray(psiHistory) || psiHistory.length === 0) {
    return '<p><strong>PSI Chart:</strong> No PSI data yet.</p>';
  }

  const readings = psiHistory.map(item => Number(item.psi));
  const latestPsi = readings[readings.length - 1];
  const width = 320;
  const height = 110;
  const padding = 18;
  const maxPsi = 80;
  const minPsi = 0;

  let chartStatusClass = 'psi-chart-healthy';

  if (latestPsi <= 34) {
    chartStatusClass = 'psi-chart-critical';
  } else if (latestPsi <= 49 || latestPsi > 70) {
    chartStatusClass = 'psi-chart-warning';
  }

  const getX = (index) => {
    return readings.length === 1
      ? width / 2
      : padding + (index * (width - padding * 2)) / (readings.length - 1);
  };

  const getY = (psi) => {
    return height - padding - ((psi - minPsi) / (maxPsi - minPsi)) * (height - padding * 2);
  };

  const points = readings.map((psi, index) => `${getX(index)},${getY(psi)}`).join(' ');
  const dots = readings.map((psi, index) => {
    const isLatest = index === readings.length - 1;
    const dotClass = isLatest ? 'latest-point' : '';
    const radius = isLatest ? 6 : 4;
    return `<circle class="${dotClass}" cx="${getX(index)}" cy="${getY(psi)}" r="${radius}"></circle>`;
  }).join('');
  const criticalY = getY(34);

  return `
    <div class="psi-chart ${chartStatusClass}">
      <p><strong>PSI Chart:</strong> ${readings.join(' → ')}</p>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="PSI history chart">
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}"></line>
        <line class="critical-line" x1="${padding}" y1="${criticalY}" x2="${width - padding}" y2="${criticalY}"></line>
        <polyline points="${points}"></polyline>
        ${dots}
      </svg>
      <p class="chart-note">Dashed line = critical PSI threshold | Current PSI = ${latestPsi}</p>
    </div>
  `;
}

function getMachineOperationalStatus(machine) {
  const machineFilters = filters.filter(filter => filter.machineId === machine.id);

  if (machineFilters.length === 0) {
    return {
      status: 'Needs Setup',
      type: 'warning',
      filterName: 'No filter assigned',
      psi: 'N/A'
    };
  }

  let finalStatus = 'Healthy';
  let finalType = 'healthy';
  let latestPsi = 'N/A';
  let filterName = machineFilters[0].productName || 'Assigned';

  machineFilters.forEach(filter => {
    const lifecycleStatus = getFilterStatus(filter);
    const psiStatus = getPsiStatus(filter.psi, filter.psiMin, filter.psiMax);
    const psiTrend = getPsiTrend(filter.psiHistory);
    const psiPrediction = getPsiFailurePrediction(filter.psiHistory);

    if (filter.psi || filter.psi === 0) {
      latestPsi = `${filter.psi} PSI`;
    }

    if (filter.productName) {
      filterName = filter.productName;
    }

    const isCritical = lifecycleStatus === 'Expired'
      || lifecycleStatus === 'Critical'
      || psiStatus.type === 'critical'
      || psiPrediction.type === 'critical';

    const isWarning = lifecycleStatus === 'Due Soon'
      || psiStatus.type === 'warning'
      || psiTrend.type === 'warning'
      || psiPrediction.type === 'warning';

    if (isCritical) {
      finalStatus = 'At Risk';
      finalType = 'critical';
    } else if (finalType !== 'critical' && isWarning) {
      finalStatus = 'Watch';
      finalType = 'warning';
    }
  });

  return {
    status: finalStatus,
    type: finalType,
    filterName,
    psi: latestPsi
  };
}

function renderMachines() {
  totalMachinesKpi.textContent = machines.length;

  const machinesTotalKpi = document.querySelector('#machines-total-kpi');
  const machinesWithFiltersKpi = document.querySelector('#machines-with-filters-kpi');
  const machinesSetupKpi = document.querySelector('#machines-setup-kpi');
  const machinesRiskKpi = document.querySelector('#machines-risk-kpi');
  const searchValue = machineSearchInput ? machineSearchInput.value.trim().toLowerCase() : '';

  const machinesWithFilters = machines.filter(machine => {
    return filters.some(filter => filter.machineId === machine.id);
  }).length;

  const machinesNeedSetup = machines.length - machinesWithFilters;

  const machinesAtRisk = machines.filter(machine => {
    const status = getMachineOperationalStatus(machine);
    return status.type === 'critical' || status.type === 'warning';
  }).length;

  if (machinesTotalKpi) machinesTotalKpi.textContent = machines.length;
  if (machinesWithFiltersKpi) machinesWithFiltersKpi.textContent = machinesWithFilters;
  if (machinesSetupKpi) machinesSetupKpi.textContent = machinesNeedSetup;
  if (machinesRiskKpi) machinesRiskKpi.textContent = machinesAtRisk;
  if (dashboardMachinesRisk) dashboardMachinesRisk.textContent = machinesAtRisk;

  if (machines.length === 0) {
    machinesList.innerHTML = '<p class="empty-state">No machines registered yet.</p>';
    if (machineResultsCount) machineResultsCount.textContent = '0 results';
    if (dashboardMachinesRisk) dashboardMachinesRisk.textContent = '0';
    return;
  }

  const visibleMachines = machines.filter(machine => {
    const operational = getMachineOperationalStatus(machine);

    if (searchValue === 'at risk') {
      return operational.type === 'critical' || operational.type === 'warning';
    }

    const searchableText = [
      machine.name,
      machine.type,
      machine.location,
      machine.department,
      machine.brand,
      machine.model,
      machine.category,
      machine.serialNumber,
      machine.building,
      machine.floor,
      machine.zone,
      machine.exactLocation,
      machine.assetId,
      operational.filterName,
      operational.psi,
      operational.status
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (machineResultsCount) {
    machineResultsCount.textContent = `${visibleMachines.length} of ${machines.length} machines`;
  }

  if (visibleMachines.length === 0) {
    machinesList.innerHTML = '<p class="empty-state">No machines match your search.</p>';
    return;
  }

  machinesList.innerHTML = `
    <div class="fleet-table">
      <div class="fleet-row fleet-header">
        <span>Machine</span>
        <span>Type</span>
        <span>Location</span>
        <span>Filter</span>
        <span>PSI</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      ${visibleMachines.map(machine => {
        const operational = getMachineOperationalStatus(machine);
        const machineDetails = [
          machine.assetId ? `ID: ${machine.assetId}` : '',
          machine.category ? `Category: ${machine.category}` : '',
          machine.department ? `Dept: ${machine.department}` : '',
          machine.brand ? `${machine.brand}${machine.model ? ' / ' + machine.model : ''}` : machine.model || '',
          machine.serialNumber ? `SN: ${machine.serialNumber}` : '',
          [machine.building, machine.floor, machine.zone, machine.exactLocation].filter(Boolean).join(' / ')
        ].filter(Boolean).join(' • ');

        return `
          <div class="fleet-row">
            <span 
              class="fleet-machine-name clickable-machine-name" 
              onclick="startMaintenanceFromMachine(${Number(machine.id)})"
              title="Click to start maintenance"
            >
              ${escapeHTML(machine.name)}
              ${machineDetails ? `<small>${escapeHTML(machineDetails)}</small>` : ''}
            </span>
            <span>${escapeHTML(machine.type)}</span>
            <span>${escapeHTML(machine.location)}</span>
            <span>${escapeHTML(operational.filterName)}</span>
            <span>${escapeHTML(operational.psi)}</span>
            <span>
              <span class="status-pill status-${escapeHTML(operational.type)}">${escapeHTML(operational.status)}</span>
            </span>
            <span>
              <div class="machine-action-buttons">
                <button 
                  type="button" 
                  class="machine-qr-btn" 
                  onclick="openMachineQR(${Number(machine.id)})"
                >
                  QR
                </button>
                <button 
                  type="button" 
                  class="machine-delete-btn" 
                  onclick="deleteMachine(${Number(machine.id)})"
                >
                  Delete
                </button>
              </div>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function getMachineQRPayload(machine) {
  return `filtracore://machine/${machine.id}`;
}

function getMachineQRDisplayCode(machine) {
  return `FC-M-${machine.id}`;
}

function openMachineQRModal() {
  if (!machineQRModal) return;

  machineQRModal.classList.add('is-open');
  machineQRModal.setAttribute('aria-hidden', 'false');
}

function closeMachineQRModalWindow() {
  if (!machineQRModal) return;

  machineQRModal.classList.remove('is-open');
  machineQRModal.setAttribute('aria-hidden', 'true');
}

async function openMachineQR(machineId) {
  const machine = machines.find(item => item.id === Number(machineId));

  if (!machine) {
    alert('Machine not found.');
    return;
  }

  const fallbackPayload = getMachineQRPayload(machine);
  const fallbackDisplayCode = getMachineQRDisplayCode(machine);

  if (machineQRModalTitle) {
    machineQRModalTitle.textContent = `${machine.name} QR`;
  }

  if (machineQRModalSubtitle) {
    machineQRModalSubtitle.textContent = [machine.type, machine.location].filter(Boolean).join(' • ') || 'Scan this code from the mobile app.';
  }

  if (machineQRDisplayCode) {
    machineQRDisplayCode.textContent = fallbackDisplayCode;
  }

  if (machineQRPayload) {
    machineQRPayload.textContent = fallbackPayload;
  }

  if (machineQRCode) {
    machineQRCode.innerHTML = '<p class="empty-state">Loading QR...</p>';
  }

  openMachineQRModal();

  if (!apiAvailable) {
    if (machineQRCode) {
      machineQRCode.innerHTML = '<p class="empty-state">Connect to the FiltraCore API to generate the QR image.</p>';
    }

    return;
  }

  try {
    const qr = await apiRequest(`/api/machines/${encodeURIComponent(machine.id)}/qr`);

    if (machineQRCode) {
      machineQRCode.innerHTML = qr.svg || '<p class="empty-state">QR unavailable.</p>';
    }

    if (machineQRDisplayCode) {
      machineQRDisplayCode.textContent = qr.displayCode || fallbackDisplayCode;
    }

    if (machineQRPayload) {
      machineQRPayload.textContent = qr.payload || fallbackPayload;
    }
  } catch (error) {
    if (machineQRCode) {
      machineQRCode.innerHTML = `<p class="empty-state">${escapeHTML(error.message || 'Unable to load QR.')}</p>`;
    }
  }
}

function printMachineQR() {
  if (!machineQRCode || !machineQRCode.innerHTML.trim()) return;

  const title = machineQRModalTitle?.textContent || 'Machine QR';
  const code = machineQRDisplayCode?.textContent || '';
  const payload = machineQRPayload?.textContent || '';
  const printWindow = window.open('', '_blank', 'width=520,height=680');

  if (!printWindow) {
    alert('Allow pop-ups to print this QR label.');
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHTML(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #0f172a; }
          .label { width: 360px; border: 1px solid #cbd5e1; border-radius: 14px; padding: 24px; text-align: center; }
          .qr svg { width: 260px; height: 260px; }
          h1 { font-size: 22px; margin: 0 0 14px; }
          strong { display: block; margin-top: 12px; font-size: 20px; }
          p { margin: 8px 0 0; font-size: 11px; color: #64748b; overflow-wrap: anywhere; }
        </style>
      </head>
      <body>
        <div class="label">
          <h1>${escapeHTML(title)}</h1>
          <div class="qr">${machineQRCode.innerHTML}</div>
          <strong>${escapeHTML(code)}</strong>
          <p>${escapeHTML(payload)}</p>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function deleteMachine(machineId) {
  const machine = machines.find(item => item.id === Number(machineId));

  if (!machine) {
    alert('Machine not found.');
    return;
  }

  const relatedFilters = filters.filter(filter => filter.machineId === machine.id).length;
  const relatedMaintenance = maintenanceRecords.filter(record => record.machineId === machine.id).length;
  const message = [
    `Delete ${machine.name}?`,
    relatedFilters || relatedMaintenance
      ? `This will also remove ${relatedFilters} installed filter record(s) and ${relatedMaintenance} maintenance record(s) for this machine.`
      : 'This machine has no connected filter or maintenance records.'
  ].join('\n\n');

  if (!confirm(message)) {
    return;
  }

  if (apiAvailable) {
    try {
      const state = await apiRequest(`/api/machines/${encodeURIComponent(machine.id)}`, {
        method: 'DELETE'
      });

      applyServerState(state);
      renderApp();
    } catch (error) {
      showSaveError(error);
    }

    return;
  }

  replaceCollection(machines, machines.filter(item => item.id !== machine.id));
  replaceCollection(filters, filters.filter(filter => filter.machineId !== machine.id));
  replaceCollection(maintenanceRecords, maintenanceRecords.filter(record => record.machineId !== machine.id));
  saveLocalData();
  renderApp();
}

if (machineSearchInput) {
  machineSearchInput.addEventListener('input', () => {
    renderMachines();
  });
}

function filterMachinesByRisk() {
  showSection('machines');
  setActiveNavById('machines');

  if (machineSearchInput) {
    machineSearchInput.value = 'at risk';
    renderMachines();
    machineSearchInput.focus();
  }

  const machinesSection = document.querySelector('#machines');
  if (machinesSection) {
    machinesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

if (machinesRiskFilterBtn) {
  machinesRiskFilterBtn.addEventListener('click', filterMachinesByRisk);
}

if (dashboardMachinesRiskFilterBtn) {
  dashboardMachinesRiskFilterBtn.addEventListener('click', filterMachinesByRisk);
}

if (dashboardAlertsFilterBtn) {
  dashboardAlertsFilterBtn.addEventListener('click', openAlertsModal);
}

function updateMachineOptions() {
  if (!filterMachineSelect) return;

  filterMachineSelect.innerHTML = '<option value="">Select machine</option>';

  machines.forEach(machine => {
    filterMachineSelect.innerHTML += `
      <option value="${escapeHTML(machine.id)}">
        ${escapeHTML(machine.name)} - ${escapeHTML(machine.type)}
      </option>
    `;
  });
}

function updateInventoryOptions() {
  if (!filterProductSelect) return;

  filterProductSelect.innerHTML = '<option value="">Select filter product</option>';

  inventory.forEach(item => {
    const stock = Number(item.stock) || 0;
    const labelParts = [
      item.name,
      item.reorderNumber ? `#${item.reorderNumber}` : '',
      `Stock: ${stock}`
    ].filter(Boolean);
    filterProductSelect.innerHTML += `
      <option value="${escapeHTML(item.id)}">
        ${escapeHTML(labelParts.join(' · '))}
      </option>
    `;
  });
}

function updateMaintenanceOptions() {
  if (maintenanceMachineSelect) {
    maintenanceMachineSelect.innerHTML = '<option value="">Select machine</option>';

    machines.forEach(machine => {
      maintenanceMachineSelect.innerHTML += `
        <option value="${escapeHTML(machine.id)}">
          ${escapeHTML(machine.name)} - ${escapeHTML(machine.type)}
        </option>
      `;
    });
  }

  if (maintenanceFilterSelect) {
    maintenanceFilterSelect.innerHTML = '<option value="">Select filter (optional)</option>';

    filters.forEach(filter => {
      const machine = machines.find(machine => machine.id === filter.machineId);
      maintenanceFilterSelect.innerHTML += `
        <option value="${escapeHTML(filter.id)}">
          ${escapeHTML(filter.productName || 'Filter')} ${machine ? '- ' + escapeHTML(machine.name) : ''}
        </option>
      `;
    });
  }

  if (maintenanceReplacementProductSelect) {
    maintenanceReplacementProductSelect.innerHTML = '<option value="">Only select if replacing filter</option>';

    inventory.forEach(item => {
      const stock = Number(item.stock) || 0;
      maintenanceReplacementProductSelect.innerHTML += `
        <option value="${escapeHTML(item.id)}" ${stock <= 0 ? 'disabled' : ''}>
          ${escapeHTML(item.name)} (Stock: ${stock})
        </option>
      `;
    });
  }
}

function updateMaintenancePsiPreview() {
  const filterId = Number(maintenanceFilterSelect?.value) || null;

  if (!filterId) {
    if (maintenanceCurrentPsiInput) {
      maintenanceCurrentPsiInput.value = '';
      maintenanceCurrentPsiInput.placeholder = 'Select a filter to view PSI';
    }

    if (maintenancePsiChart) {
      maintenancePsiChart.innerHTML = '<p class="empty-state">Select a filter to view PSI history.</p>';
    }

    return;
  }

  const filter = filters.find(filter => filter.id === filterId);

  if (!filter) {
    if (maintenanceCurrentPsiInput) {
      maintenanceCurrentPsiInput.value = '';
      maintenanceCurrentPsiInput.placeholder = 'Filter not found';
    }

    if (maintenancePsiChart) {
      maintenancePsiChart.innerHTML = '<p class="empty-state">Filter not found.</p>';
    }

    return;
  }

  if (maintenanceCurrentPsiInput) {
    if (filter.psi || filter.psi === 0) {
      const psiStatus = getPsiStatus(filter.psi, filter.psiMin, filter.psiMax);
      maintenanceCurrentPsiInput.value = `${filter.psi} PSI - ${psiStatus.status}`;
    } else {
      maintenanceCurrentPsiInput.value = 'No PSI recorded';
    }
  }

  if (maintenancePsiChart) {
    maintenancePsiChart.innerHTML = renderPsiChart(filter.psiHistory);
  }
}

if (maintenanceFilterSelect) {
  maintenanceFilterSelect.addEventListener('change', updateMaintenancePsiPreview);
}

if (maintenanceMachineSelect) {
  maintenanceMachineSelect.addEventListener('change', () => {
    const machineId = Number(maintenanceMachineSelect.value) || null;
    const machineFilters = filters.filter(filter => filter.machineId === machineId);

    if (maintenanceFilterSelect && machineFilters.length > 0) {
      maintenanceFilterSelect.value = String(machineFilters[machineFilters.length - 1].id);
    }

    updateMaintenancePsiPreview();
  });
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + Number(months || 0));
  return result;
}

function getDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

function parseDateInput(value) {
  if (!value) return new Date();

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateInput(date) {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  const localDate = new Date(parsedDate.getTime() - parsedDate.getTimezoneOffset() * 60000);
  return localDate.toISOString().split('T')[0];
}

function getSelectedFilterProduct() {
  const productId = Number(filterProductSelect?.value);
  return inventory.find(item => item.id === productId);
}

function syncFilterScheduleFields(forceDueDate = false) {
  if (!filterLifeMonthsInput || !filterInstalledAtInput || !filterDueDateInput) return;

  const product = getSelectedFilterProduct();
  const defaultLifeMonths = product ? getDefaultLifeMonths(product.category) : 6;

  if (!filterLifeMonthsInput.value) {
    filterLifeMonthsInput.value = product?.lifeMonths || defaultLifeMonths;
  }

  if (!filterInstalledAtInput.value) {
    filterInstalledAtInput.value = formatDateInput(new Date());
  }

  const installedAt = parseDateInput(filterInstalledAtInput.value);
  const lifeMonths = Number(filterLifeMonthsInput.value || product?.lifeMonths || defaultLifeMonths);

  if (forceDueDate || !filterDueDateInput.value) {
    filterDueDateInput.value = formatDateInput(addMonths(installedAt, lifeMonths));
  }
}

if (filterProductSelect) {
  filterProductSelect.addEventListener('change', () => {
    if (filterLifeMonthsInput) filterLifeMonthsInput.value = '';
    if (filterQuantityInput && !filterQuantityInput.value) filterQuantityInput.value = '1';
    if (filterPsiMinInput && !filterPsiMinInput.value) filterPsiMinInput.value = '50';
    if (filterPsiMaxInput && !filterPsiMaxInput.value) filterPsiMaxInput.value = '70';
    syncFilterScheduleFields(true);
  });
}

if (filterLifeMonthsInput) {
  filterLifeMonthsInput.addEventListener('input', () => {
    syncFilterScheduleFields(true);
  });
}

if (filterInstalledAtInput) {
  filterInstalledAtInput.addEventListener('change', () => {
    syncFilterScheduleFields(true);
  });
}

function getFilterStatus(filter) {
  const today = new Date();
  const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
  const daysRemaining = getDaysBetween(today, dueDate);

  if (daysRemaining <= 0) return 'Expired';
  if (daysRemaining <= 30) return 'Critical';
  if (daysRemaining <= 90) return 'Due Soon';
  return 'Active';
}

function getFilterOperationalStatus(filter) {
  const lifecycleStatus = getFilterStatus(filter);
  const psiStatus = getPsiStatus(filter.psi, filter.psiMin, filter.psiMax);
  const psiTrend = getPsiTrend(filter.psiHistory);
  const psiPrediction = getPsiFailurePrediction(filter.psiHistory);

  if (
    lifecycleStatus === 'Expired' ||
    lifecycleStatus === 'Critical' ||
    psiStatus.type === 'critical' ||
    psiPrediction.type === 'critical'
  ) {
    return {
      status: 'Critical',
      type: 'critical',
      reason: lifecycleStatus !== 'Active' ? lifecycleStatus : psiStatus.message
    };
  }

  if (
    lifecycleStatus === 'Due Soon' ||
    psiStatus.type === 'warning' ||
    psiTrend.type === 'warning' ||
    psiPrediction.type === 'warning'
  ) {
    return {
      status: 'Watch',
      type: 'warning',
      reason: lifecycleStatus !== 'Active' ? lifecycleStatus : psiStatus.message
    };
  }

  return {
    status: 'Healthy',
    type: 'healthy',
    reason: 'Lifecycle and PSI are within expected range.'
  };
}


function getDefaultLifeMonths(category) {
  const normalizedCategory = String(category || '').toLowerCase();

  if (normalizedCategory.includes('ice')) return 12;
  if (normalizedCategory.includes('coffee')) return 6;
  if (normalizedCategory.includes('soda')) return 6;
  if (normalizedCategory.includes('refrigeration')) return 12;
  if (normalizedCategory.includes('water')) return 6;

  return 6;
}

function getPsiStatus(psi, minValue = 50, maxValue = 70) {
  const value = Number(psi);
  const min = Number(minValue) || 50;
  const max = Number(maxValue) || 70;
  const criticalMin = Math.max(0, min - 16);

  if (!psi && psi !== 0) {
    return {
      status: 'Not recorded',
      type: 'neutral',
      message: 'No PSI reading recorded yet.'
    };
  }

  if (value <= criticalMin) {
    return {
      status: 'Critical',
      type: 'critical',
      message: 'PSI is critically low. Inspect filter, water line, or pressure supply immediately.'
    };
  }

  if (value < min) {
    return {
      status: 'Warning',
      type: 'warning',
      message: 'PSI is below the healthy range. Monitor and schedule inspection.'
    };
  }

  if (value <= max) {
    return {
      status: 'Healthy',
      type: 'healthy',
      message: 'PSI is within the expected operating range.'
    };
  }

  return {
    status: 'High Pressure',
    type: 'warning',
    message: 'PSI is above the expected range. Check regulator or incoming pressure.'
  };
}

function getPsiTrend(psiHistory) {
  if (!Array.isArray(psiHistory) || psiHistory.length < 2) {
    return {
      trend: 'No data',
      type: 'neutral',
      message: 'Not enough PSI readings to determine trend.'
    };
  }

  const lastReading = psiHistory[psiHistory.length - 1];
  const previousReading = psiHistory[psiHistory.length - 2];
  const lastPsi = Number(lastReading.psi);
  const previousPsi = Number(previousReading.psi);
  const change = lastPsi - previousPsi;

  if (change <= -5) {
    return {
      trend: 'Dropping',
      type: 'warning',
      message: `PSI dropped by ${Math.abs(change)} since the last reading. Possible filter saturation or pressure restriction.`
    };
  }

  if (change >= 5) {
    return {
      trend: 'Increasing',
      type: 'warning',
      message: `PSI increased by ${change} since the last reading. Check regulator or incoming pressure.`
    };
  }

  return {
    trend: 'Stable',
    type: 'healthy',
    message: `PSI changed by ${change}. Pressure trend is stable.`
  };
}

function getPsiFailurePrediction(psiHistory) {
  if (!Array.isArray(psiHistory) || psiHistory.length < 2) {
    return {
      prediction: 'No prediction',
      type: 'neutral',
      message: 'Not enough PSI readings to predict failure.'
    };
  }

  const lastReading = psiHistory[psiHistory.length - 1];
  const previousReading = psiHistory[psiHistory.length - 2];
  const lastPsi = Number(lastReading.psi);
  const previousPsi = Number(previousReading.psi);
  const change = lastPsi - previousPsi;

  if (lastPsi <= 34) {
    return {
      prediction: 'Already critical',
      type: 'critical',
      message: 'PSI is already at or below the critical limit. Inspect immediately.'
    };
  }

  if (change >= 0) {
    return {
      prediction: 'Stable',
      type: 'healthy',
      message: 'PSI is not dropping. No immediate failure prediction.'
    };
  }

  const criticalLimit = 34;
  const psiUntilCritical = lastPsi - criticalLimit;
  const dropPerReading = Math.abs(change);
  const readingsUntilCritical = Math.ceil(psiUntilCritical / dropPerReading);

  return {
    prediction: `${readingsUntilCritical} readings`,
    type: readingsUntilCritical <= 2 ? 'critical' : 'warning',
    message: `If PSI keeps dropping at this rate, it may reach critical level in about ${readingsUntilCritical} readings.`
  };
}

async function updateFilterPsi(filterId) {
  const input = document.querySelector(`#psi-update-${filterId}`);

  if (!input || input.value === '') {
    alert('Enter a PSI value');
    return;
  }

  const newPsi = Number(input.value);
  const filter = filters.find(filter => filter.id === filterId);

  if (!filter) {
    alert('Filter not found');
    return;
  }

  if (apiAvailable) {
    try {
      input.disabled = true;
      const state = await apiRequest(`/api/filters/${Number(filterId)}/psi`, {
        method: 'PATCH',
        body: JSON.stringify({
          psi: newPsi
        })
      });

      applyServerState(state);
      renderApp();
    } catch (error) {
      showSaveError(error);
    } finally {
      input.disabled = false;
    }

    return;
  }

  filter.psi = newPsi;

  if (!Array.isArray(filter.psiHistory)) {
    filter.psiHistory = [];
  }

  filter.psiHistory.push({
    date: new Date().toISOString(),
    psi: newPsi
  });

  saveLocalData();
  renderApp();
}

function renderFilters() {
  if (!filtersList) return;

  const searchValue = filtersSearchInput ? filtersSearchInput.value.trim().toLowerCase() : '';

  let healthy = 0;
  let watch = 0;
  let critical = 0;

  filters.forEach(filter => {
    const operational = getFilterOperationalStatus(filter);

    if (operational.type === 'healthy') healthy++;
    if (operational.type === 'warning') watch++;
    if (operational.type === 'critical') critical++;
  });

  if (filtersTotalKpi) filtersTotalKpi.textContent = filters.length;
  if (filtersHealthyKpi) filtersHealthyKpi.textContent = healthy;
  if (filtersWatchKpi) filtersWatchKpi.textContent = watch;
  if (filtersCriticalKpi) filtersCriticalKpi.textContent = critical;

  if (filters.length === 0) {
    filtersList.innerHTML = '<p class="empty-state">No filters registered yet.</p>';
    if (filtersResultsCount) filtersResultsCount.textContent = '0 results';
    if (kpis[1]) kpis[1].textContent = 0;
    return;
  }

  const visibleFilters = filters.filter(filter => {
    const machine = machines.find(machine => machine.id === filter.machineId);
    const operational = getFilterOperationalStatus(filter);
    const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
    const daysRemaining = getDaysBetween(new Date(), dueDate);
    const psiText = filter.psi || filter.psi === 0 ? `${filter.psi} PSI` : 'Not recorded';

    const searchableText = [
      machine ? machine.name : 'Unknown Machine',
      filter.productName,
      filter.reorderNumber,
      filter.filterType,
      filter.vendorName,
      filter.filterQuantity,
      dueDate.toLocaleDateString(),
      daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days`,
      psiText,
      operational.status,
      operational.reason
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (filtersResultsCount) {
    filtersResultsCount.textContent = `${visibleFilters.length} of ${filters.length} filters`;
  }

  if (visibleFilters.length === 0) {
    filtersList.innerHTML = '<p class="empty-state">No filters match your search.</p>';
    return;
  }

  filtersList.innerHTML = `
    <div class="filters-table">
      <div class="filters-row filters-header">
        <span>Machine</span>
        <span>Filter</span>
        <span>Due Date</span>
        <span>Days Left</span>
        <span>PSI</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

      ${visibleFilters.map(filter => {
        const machine = machines.find(machine => machine.id === filter.machineId);
        const operational = getFilterOperationalStatus(filter);
        const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
        const daysRemaining = getDaysBetween(new Date(), dueDate);
        const psiText = filter.psi || filter.psi === 0 ? `${filter.psi} PSI` : 'Not recorded';

        return `
          <div class="filters-row">
            <span class="filters-machine-name">${escapeHTML(machine ? machine.name : 'Unknown Machine')}</span>
            <span class="filters-product-name">
              ${escapeHTML(filter.productName || 'N/A')}
              <small>${escapeHTML([filter.reorderNumber ? `Reorder ${filter.reorderNumber}` : '', filter.filterType, filter.vendorName].filter(Boolean).join(' · '))}</small>
            </span>
            <span>${escapeHTML(dueDate.toLocaleDateString())}</span>
            <span>${escapeHTML(daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days`)}</span>
            <span>${escapeHTML(psiText)}<small>Qty ${Number(filter.filterQuantity) || 1}</small></span>
            <span>
              <span class="status-pill status-${escapeHTML(operational.type)}">${escapeHTML(operational.status)}</span>
            </span>
            <span class="filter-actions">
              <input type="number" id="psi-update-${Number(filter.id)}" class="filter-psi-input" placeholder="PSI" />
              <button type="button" class="filter-action-btn filter-update-btn" onclick="updateFilterPsi(${Number(filter.id)})">Update PSI</button>
              <button type="button" class="filter-action-btn filter-maintenance-btn" onclick="startMaintenanceFromFilter(${Number(filter.id)})">Maintenance</button>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (kpis[1]) kpis[1].textContent = filters.length;
}

if (filtersSearchInput) {
  filtersSearchInput.addEventListener('input', () => {
    renderFilters();
  });
}

function filterFiltersByStatus(status) {
  showSection('filters');
  setActiveNavById('filters');

  if (filtersSearchInput) {
    filtersSearchInput.value = status;
    renderFilters();
    filtersSearchInput.focus();
  }

  const filtersSection = document.querySelector('#filters');
  if (filtersSection) {
    filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

if (filtersHealthyFilterBtn) {
  filtersHealthyFilterBtn.addEventListener('click', () => {
    filterFiltersByStatus('healthy');
  });
}

if (filtersWatchFilterBtn) {
  filtersWatchFilterBtn.addEventListener('click', () => {
    filterFiltersByStatus('watch');
  });
}

if (filtersCriticalFilterBtn) {
  filtersCriticalFilterBtn.addEventListener('click', () => {
    filterFiltersByStatus('critical');
  });
}

function startMaintenanceFromMachine(machineId) {
  const machine = machines.find(machine => machine.id === machineId);

  if (!machine) {
    alert('Machine not found');
    return;
  }

  const machineFilters = filters.filter(filter => filter.machineId === machine.id);
  const latestFilter = machineFilters.length > 0 ? machineFilters[machineFilters.length - 1] : null;
  const operational = getMachineOperationalStatus(machine);
  const today = new Date().toISOString().split('T')[0];

  showSection('maintenance');
  setActiveNavById('maintenance');
  updateMaintenanceOptions();

  if (maintenanceMachineSelect) {
    maintenanceMachineSelect.value = String(machine.id);
  }

  if (maintenanceFilterSelect && latestFilter) {
    maintenanceFilterSelect.value = String(latestFilter.id);
  }
  updateMaintenancePsiPreview();

  const maintenanceTypeInput = document.querySelector('#maintenance-type');
  const maintenanceDateInput = document.querySelector('#maintenance-date');
  const maintenanceNotesInput = document.querySelector('#maintenance-notes');

  if (maintenanceTypeInput) {
    if (operational.type === 'critical') {
      maintenanceTypeInput.value = 'Critical Inspection';
      if (maintenancePriorityInput) maintenancePriorityInput.value = 'Critical';
    } else if (operational.type === 'warning') {
      maintenanceTypeInput.value = 'Warning Review';
      if (maintenancePriorityInput) maintenancePriorityInput.value = 'Due Soon';
    } else {
      maintenanceTypeInput.value = 'General Inspection';
      if (maintenancePriorityInput) maintenancePriorityInput.value = 'Routine';
    }
  }

  if (maintenanceDateInput) {
    maintenanceDateInput.value = today;
  }

  if (maintenanceNotesInput) {
    maintenanceNotesInput.value = `Maintenance request for ${machine.name}. Current status: ${operational.status}. Filter: ${operational.filterName}. PSI: ${operational.psi}.`;
  }

  const maintenanceSection = document.querySelector('#maintenance');
  if (maintenanceSection) {
    maintenanceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function startMaintenanceFromFilter(filterId) {
  const filter = filters.find(filter => filter.id === filterId);

  if (!filter) {
    alert('Filter not found');
    return;
  }

  const machine = machines.find(machine => machine.id === filter.machineId);
  const operational = getFilterOperationalStatus(filter);
  const today = new Date().toISOString().split('T')[0];

  showSection('maintenance');
  setActiveNavById('maintenance');
  updateMaintenanceOptions();

  if (maintenanceMachineSelect && machine) {
    maintenanceMachineSelect.value = String(machine.id);
  }

  if (maintenanceFilterSelect) {
    maintenanceFilterSelect.value = String(filter.id);
  }
  updateMaintenancePsiPreview();

  const maintenanceTypeInput = document.querySelector('#maintenance-type');
  const maintenanceDateInput = document.querySelector('#maintenance-date');
  const maintenanceNotesInput = document.querySelector('#maintenance-notes');

  if (maintenanceTypeInput) {
    maintenanceTypeInput.value = operational.type === 'critical' ? 'Critical Inspection' : 'Warning Review';
  }

  if (maintenancePriorityInput) {
    maintenancePriorityInput.value = operational.type === 'critical' ? 'Critical' : 'Due Soon';
  }

  if (maintenanceDateInput) {
    maintenanceDateInput.value = today;
  }

  if (maintenanceNotesInput) {
    maintenanceNotesInput.value = `Filter Maintenance Request: ${filter.productName || 'Filter'} on ${machine ? machine.name : 'Unknown Machine'}. Status: ${operational.status}. Reason: ${operational.reason}`;
  }

  const maintenanceSection = document.querySelector('#maintenance');
  if (maintenanceSection) {
    maintenanceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderCostMetrics() {
  const totalSpendEl = document.querySelector('#total-spend');
  const averageCostEl = document.querySelector('#avg-filter-cost');

  const totalSpend = filters.reduce((sum, filter) => {
    return sum + Number(filter.cost || 0);
  }, 0);

  const averageCost = filters.length > 0 ? totalSpend / filters.length : 0;

  if (totalSpendEl) {
    totalSpendEl.textContent = `$${totalSpend.toFixed(2)}`;
  }

  if (averageCostEl) {
    averageCostEl.textContent = `$${averageCost.toFixed(2)}`;
  }

  const estimatedMonthlySpend = getEstimatedMonthlySpend();

  if (monthlySpendKpi) {
    monthlySpendKpi.textContent = `$${estimatedMonthlySpend.toFixed(2)}`;
  }

  if (annualSpendKpi) {
    annualSpendKpi.textContent = `$${(estimatedMonthlySpend * 12).toFixed(2)}`;
  }
}

function getEstimatedMonthlySpend() {
  if (filters.length === 0) return 0;

  return filters.reduce((total, filter) => {
    const cost = Number(filter.cost || 0);
    const lifeMonths = Number(filter.lifeMonths || 1);
    return total + (cost / lifeMonths);
  }, 0);
}


function getCostPerMachine() {
  return machines.map(machine => {
    const machineFilters = filters.filter(filter => filter.machineId === machine.id);

    const totalCost = machineFilters.reduce((sum, filter) => {
      return sum + Number(filter.cost || 0);
    }, 0);

    return {
      machineId: machine.id,
      machineName: machine.name,
      totalCost,
      filterCount: machineFilters.length
    };
  });
}

function getInventoryPredictions() {
  return inventory.map(item => {
    const stock = Number(item.stock) || 0;
    const productFilters = filters.filter(filter => filter.productId === item.id);
    const itemLifeMonths = Number(item.lifeMonths || getDefaultLifeMonths(item.category));

    if (productFilters.length === 0) {
      return {
        productName: item.name,
        stock,
        monthlyUsage: 0,
        coverageMonths: null,
        status: 'No usage data yet'
      };
    }

    const monthlyUsage = productFilters.reduce((total, filter) => {
      const lifeMonths = Number(filter.lifeMonths || itemLifeMonths || 1);
      return total + (1 / lifeMonths);
    }, 0);

    const coverageMonths = monthlyUsage > 0 ? stock / monthlyUsage : null;

    let status = 'Stable';
    let action = 'No action needed';

    if (coverageMonths !== null && coverageMonths <= 1) {
      status = 'Critical runout risk';
      action = 'Reorder immediately';
    } else if (coverageMonths !== null && coverageMonths <= 3) {
      status = 'Reorder planning';
      action = 'Plan reorder soon';
    } else if (coverageMonths !== null && coverageMonths <= 6) {
      status = 'Monitor usage';
      action = 'Monitor monthly consumption';
    }

    return {
      productName: item.name,
      stock,
      monthlyUsage,
      coverageMonths,
      status,
      action
    };
  });
}

function getFacilityNameForMachine(machine) {
  const facility = facilities.find(item => Number(item.id) === Number(machine.facilityId));
  return facility?.name || machine.location || 'Unassigned Facility';
}

function renderEnterpriseDashboard() {
  if (facilityOverviewList) {
    if (!machines.length) {
      facilityOverviewList.innerHTML = '<p class="empty-state">No facility data yet.</p>';
    } else {
      const facilityMap = new Map();

      machines.forEach(machine => {
        const facilityName = getFacilityNameForMachine(machine);
        const current = facilityMap.get(facilityName) || {
          name: facilityName,
          machines: [],
          critical: 0,
          warning: 0,
          filters: 0
        };
        const status = getMachineOperationalStatus(machine);
        const machineFilters = filters.filter(filter => Number(filter.machineId) === Number(machine.id));

        current.machines.push({
          machine,
          filters: machineFilters
        });
        current.filters += machineFilters.length;
        if (status.type === 'critical') current.critical += 1;
        if (status.type === 'warning') current.warning += 1;
        facilityMap.set(facilityName, current);
      });

      facilityOverviewList.innerHTML = [...facilityMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map(facility => {
        const health = facility.critical > 0 ? 'Critical' : facility.warning > 0 ? 'Watch' : 'Healthy';
        const type = facility.critical > 0 ? 'critical' : facility.warning > 0 ? 'warning' : 'healthy';
        const machineRows = facility.machines.map(({ machine, filters: machineFilters }) => {
          const detail = [
            machine.category,
            machine.exactLocation || machine.location,
            machine.zone
          ].filter(Boolean).join(' · ');
          const filterChips = machineFilters.length
            ? machineFilters.map(filter => {
              const reorder = filter.reorderNumber || filter.productName || 'No reorder';
              const type = filter.filterType || filter.productName || 'Filter';
              const quantity = Number(filter.filterQuantity) || 1;

              return `
                <span class="facility-filter-chip">
                  ${escapeHTML(reorder)} · ${escapeHTML(type)} · Qty ${quantity}
                </span>
              `;
            }).join('')
            : '<span class="facility-filter-chip">No installed filters</span>';

          return `
            <div class="facility-machine-row">
              <div>
                <strong>${escapeHTML(machine.name)}</strong>
                <small>${escapeHTML(detail || 'Location pending')}</small>
              </div>
              <div class="facility-filter-list">
                ${filterChips}
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="facility-overview-row">
            <div class="facility-overview-head">
              <div>
                <h4>${escapeHTML(facility.name)}</h4>
                <p>${facility.machines.length} assets · ${facility.filters} installed filters</p>
              </div>
              <span class="status-pill status-${escapeHTML(type)}">${escapeHTML(health)}</span>
            </div>
            <div class="facility-machine-list">${machineRows}</div>
          </div>
        `;
      }).join('');
    }
  }

  if (psiAnalyticsGrid) {
    const psiFilters = filters.filter(filter => filter.psi || filter.psi === 0);
    const outOfRange = psiFilters.filter(filter => {
      const min = filter.psiMin ?? 50;
      const max = filter.psiMax ?? 70;
      return Number(filter.psi) < Number(min) || Number(filter.psi) > Number(max);
    });
    const averagePsi = psiFilters.length
      ? psiFilters.reduce((sum, filter) => sum + Number(filter.psi), 0) / psiFilters.length
      : 0;
    const trendWarnings = psiFilters.filter(filter => {
      const trend = getPsiTrend(filter.psiHistory);
      return trend.type === 'warning';
    }).length;

    psiAnalyticsGrid.innerHTML = `
      <div class="insight-metric">
        <span>Average PSI</span>
        <strong>${psiFilters.length ? averagePsi.toFixed(1) : 'N/A'}</strong>
      </div>
      <div class="insight-metric warning">
        <span>Out of Range</span>
        <strong>${outOfRange.length}</strong>
      </div>
      <div class="insight-metric">
        <span>Tracked Readings</span>
        <strong>${psiFilters.length}</strong>
      </div>
      <div class="insight-metric warning">
        <span>Trend Watch</span>
        <strong>${trendWarnings}</strong>
      </div>
    `;
  }

  if (upcomingReplacementsList) {
    const upcoming = filters.map(filter => {
      const machine = machines.find(item => item.id === filter.machineId);
      const dueDate = filter.dueDate ? new Date(filter.dueDate) : addMonths(filter.installedAt, filter.lifeMonths);
      const daysRemaining = getDaysBetween(new Date(), dueDate);
      const operational = getFilterOperationalStatus(filter);

      return {
        filter,
        machine,
        dueDate,
        daysRemaining,
        operational
      };
    }).filter(item => item.daysRemaining <= 90 || item.operational.type !== 'healthy')
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 6);

    if (!upcoming.length) {
      upcomingReplacementsList.innerHTML = '<p class="empty-state">No upcoming replacements.</p>';
    } else {
      upcomingReplacementsList.innerHTML = upcoming.map(item => {
        const type = item.operational.type === 'critical' || item.daysRemaining <= 0
          ? 'critical'
          : item.operational.type === 'warning' || item.daysRemaining <= 30
            ? 'warning'
            : 'healthy';
        const daysLabel = item.daysRemaining <= 0 ? 'Expired' : `${item.daysRemaining} days`;

        return `
          <div class="upcoming-replacement-row">
            <div>
              <h4>${escapeHTML(item.machine ? item.machine.name : 'Unknown Machine')}</h4>
              <p>${escapeHTML(item.filter.productName || 'Filter')} · Qty ${Number(item.filter.filterQuantity) || 1} · ${escapeHTML(daysLabel)}</p>
            </div>
            <button type="button" class="filter-action-btn filter-maintenance-btn" onclick="startMaintenanceFromFilter(${Number(item.filter.id)})">
              Log
            </button>
            <span class="status-pill status-${escapeHTML(type)}">${escapeHTML(item.operational.status)}</span>
          </div>
        `;
      }).join('');
    }
  }
}

function setSmartImportStatus(message, tone = '') {
  if (!smartImportStatus) return;

  smartImportStatus.textContent = message;
  smartImportStatus.dataset.tone = tone;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

function renderSmartImportPreview() {
  if (!smartImportPreview) return;

  const preview = pendingImportPreview;
  if (!preview || !Array.isArray(preview.records) || preview.records.length === 0) {
    smartImportPreview.innerHTML = '<p class="empty-state">No import preview yet.</p>';
    if (applySmartImportBtn) applySmartImportBtn.disabled = true;
    return;
  }

  const warnings = Array.isArray(preview.warnings) && preview.warnings.length
    ? `
      <div class="smart-import-warnings">
        ${preview.warnings.map(warning => `<p>${escapeHTML(warning)}</p>`).join('')}
      </div>
    `
    : '';

  smartImportPreview.innerHTML = `
    <div class="smart-import-summary">
      <div>
        <span>Source</span>
        <strong>${escapeHTML(preview.sourceName || 'Smart import')}</strong>
      </div>
      <div>
        <span>Detected</span>
        <strong>${preview.records.length}</strong>
      </div>
      <div>
        <span>AI Vision</span>
        <strong>${preview.aiUsed ? 'Used' : 'Fallback'}</strong>
      </div>
    </div>
    ${warnings}
    <div class="smart-import-table">
      <div class="smart-import-row smart-import-header">
        <span>Venue</span>
        <span>Machine</span>
        <span>Reorder #</span>
        <span>Filter Type</span>
        <span>Qty</span>
      </div>
      ${preview.records.map(record => `
        <div class="smart-import-row">
          <span>${escapeHTML(record.venue)}</span>
          <span>${escapeHTML(record.machine)}</span>
          <span>${escapeHTML(record.reorderNumber)}</span>
          <span>${escapeHTML(record.filterType)}</span>
          <span>${Number(record.quantity) || 1}</span>
        </div>
      `).join('')}
    </div>
  `;

  if (applySmartImportBtn) applySmartImportBtn.disabled = false;
}

async function buildSmartImportPayload() {
  const file = smartImportFileInput?.files?.[0] || null;
  const text = smartImportTextInput?.value || '';
  const dataUrl = file ? await readFileAsDataUrl(file) : '';

  return {
    text,
    dataUrl,
    fileName: file?.name || 'Manual import',
    mimeType: file?.type || ''
  };
}

async function previewSmartImport() {
  const payload = await buildSmartImportPayload();

  if (!payload.text.trim() && !payload.dataUrl) {
    setSmartImportStatus('Upload a file or paste sheet text first.', 'error');
    return;
  }

  setSmartImportStatus('Scanning import source...');
  if (applySmartImportBtn) applySmartImportBtn.disabled = true;

  const preview = await apiRequest('/api/import/preview', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  pendingImportPreview = preview;
  renderSmartImportPreview();

  if (preview.records?.length) {
    setSmartImportStatus(`Detected ${preview.records.length} records. Review and apply when ready.`, 'success');
  } else {
    setSmartImportStatus('No records detected. Try a spreadsheet, PDF text, or paste OCR text from the sheet.', 'error');
  }
}

async function applySmartImport() {
  if (!pendingImportPreview?.records?.length) {
    setSmartImportStatus('Preview an import before applying.', 'error');
    return;
  }

  setSmartImportStatus('Creating machine and filter records...');
  if (applySmartImportBtn) applySmartImportBtn.disabled = true;

  const state = await apiRequest('/api/import/apply', {
    method: 'POST',
    body: JSON.stringify(pendingImportPreview)
  });

  applyServerState(state);
  renderApp();
  const summary = state.importSummary || {};
  setSmartImportStatus(
    `Applied ${summary.applied || pendingImportPreview.records.length} records. Machines: ${summary.machinesCreated || 0} new, Filters: ${summary.filtersCreated || 0} new.`,
    'success'
  );
  pendingImportPreview = null;
  renderSmartImportPreview();
}

function renderReports() {
  const alerts = getVisibleAlerts();
  const riskData = getFinancialRisk();
  const risk = riskData.total;
  const savings = getPotentialSavings();
  const pendingMaintenance = getPendingMaintenanceItems();

  const machinesAtRisk = machines.filter(machine => {
    const status = getMachineOperationalStatus(machine);
    return status.type === 'critical' || status.type === 'warning';
  }).length;

  const totalSpend = filters.reduce((sum, filter) => {
    return sum + Number(filter.cost || 0);
  }, 0);

  const avgFilterCost = filters.length > 0 ? totalSpend / filters.length : 0;
  const monthlySpend = getEstimatedMonthlySpend();
  const annualSpend = monthlySpend * 12;

  const lowStockItems = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    return stock > 0 && stock <= reorderLevel;
  }).length;

  const reorderNeeded = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    return stock <= 0;
  }).length;

  const inventoryValue = inventory.reduce((total, item) => {
    const stock = Number(item.stock) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    return total + (stock * unitCost);
  }, 0);

  const health = getSystemHealth();

  if (reportsTotalSpend) reportsTotalSpend.textContent = `$${totalSpend.toFixed(2)}`;
  if (reportsPotentialSavings) reportsPotentialSavings.textContent = `$${savings.toFixed(2)}`;
  if (reportsRiskExposure) reportsRiskExposure.textContent = `$${risk.toFixed(2)}`;
  if (reportsPendingMaintenance) reportsPendingMaintenance.textContent = pendingMaintenance.length;

  if (reportsTotalMachines) reportsTotalMachines.textContent = machines.length;
  if (reportsMachinesRisk) reportsMachinesRisk.textContent = machinesAtRisk;
  if (reportsInstalledFilters) reportsInstalledFilters.textContent = filters.length;
  if (reportsAlertsCount) reportsAlertsCount.textContent = alerts.length;

  if (reportsAvgFilterCost) reportsAvgFilterCost.textContent = `$${avgFilterCost.toFixed(2)}`;
  if (reportsMonthlySpend) reportsMonthlySpend.textContent = `$${monthlySpend.toFixed(2)}`;
  if (reportsAnnualSpend) reportsAnnualSpend.textContent = `$${annualSpend.toFixed(2)}`;

  if (reportsInventoryTotal) reportsInventoryTotal.textContent = inventory.length;
  if (reportsLowStock) reportsLowStock.textContent = lowStockItems;
  if (reportsReorderNeeded) reportsReorderNeeded.textContent = reorderNeeded;
  if (reportsInventoryValue) reportsInventoryValue.textContent = `$${inventoryValue.toFixed(2)}`;

  if (reportsHealthBadge) {
    reportsHealthBadge.classList.remove('warning', 'critical');

    if (health >= 80) {
      reportsHealthBadge.textContent = `Healthy ${health}%`;
    } else if (health >= 50) {
      reportsHealthBadge.textContent = `Watch ${health}%`;
      reportsHealthBadge.classList.add('warning');
    } else {
      reportsHealthBadge.textContent = `Critical ${health}%`;
      reportsHealthBadge.classList.add('critical');
    }
  }
}

function renderCostPerMachine() {
  renderReports();
}

function generateReportSummary() {
  if (!reportOutputCard || !reportOutput) return;

  const alerts = getVisibleAlerts();
  const riskData = getFinancialRisk();
  const pendingMaintenance = getPendingMaintenanceItems();
  const machinesAtRisk = machines.filter(machine => {
    const status = getMachineOperationalStatus(machine);
    return status.type === 'critical' || status.type === 'warning';
  }).length;

  const totalSpend = filters.reduce((sum, filter) => sum + Number(filter.cost || 0), 0);
  const monthlySpend = getEstimatedMonthlySpend();
  const inventoryValue = inventory.reduce((total, item) => {
    const stock = Number(item.stock) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    return total + (stock * unitCost);
  }, 0);

  const criticalAlerts = alerts.filter(alert => alert.type === 'critical').length;
  const warningAlerts = alerts.filter(alert => alert.type === 'warning').length;

  reportOutput.innerHTML = `
    <h4>FiltraCore Operational Summary</h4>
    <ul>
      <li><strong>Total machines:</strong> ${machines.length}</li>
      <li><strong>Installed filters:</strong> ${filters.length}</li>
      <li><strong>Machines at risk:</strong> ${machinesAtRisk}</li>
      <li><strong>Active intelligence alerts:</strong> ${alerts.length} (${criticalAlerts} critical / ${warningAlerts} warning)</li>
      <li><strong>Pending maintenance items:</strong> ${pendingMaintenance.length}</li>
      <li><strong>Total installed filter spend:</strong> $${totalSpend.toFixed(2)}</li>
      <li><strong>Estimated monthly filter spend:</strong> $${monthlySpend.toFixed(2)}</li>
      <li><strong>Estimated risk exposure:</strong> $${riskData.total.toFixed(2)}</li>
      <li><strong>Inventory value:</strong> $${inventoryValue.toFixed(2)}</li>
    </ul>
  `;

  setupState.reportGenerated = true;
  saveSetupState();
  renderSmartSetup();
  reportOutputCard.style.display = 'block';
  reportOutputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (generateReportSummaryBtn) {
  generateReportSummaryBtn.addEventListener('click', generateReportSummary);
}

if (printReportBtn) {
  printReportBtn.addEventListener('click', () => {
    renderReports();
    window.print();
  });
}

function getInventoryStockStatus(item) {
  const stock = Number(item.stock) || 0;
  const reorderLevel = Number(item.reorderLevel) || 0;

  if (stock <= 0) {
    return {
      status: 'Reorder',
      type: 'reorder'
    };
  }

  if (stock <= reorderLevel) {
    return {
      status: 'Low Stock',
      type: 'low'
    };
  }

  return {
    status: 'Available',
    type: 'good'
  };
}

function renderInventory() {
  if (!inventoryList) return;

  const searchValue = inventorySearchInput ? inventorySearchInput.value.trim().toLowerCase() : '';

  const lowStockItems = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    return stock > 0 && stock <= reorderLevel;
  }).length;

  const reorderItems = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    return stock <= 0;
  }).length;

  const totalValue = inventory.reduce((total, item) => {
    const stock = Number(item.stock) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    return total + (stock * unitCost);
  }, 0);

  if (inventoryTotalKpi) inventoryTotalKpi.textContent = inventory.length;
  if (inventoryLowStockKpi) inventoryLowStockKpi.textContent = lowStockItems;
  if (inventoryValueKpi) inventoryValueKpi.textContent = `$${totalValue.toFixed(2)}`;
  if (inventoryReorderKpi) inventoryReorderKpi.textContent = reorderItems;

  if (inventory.length === 0) {
    inventoryList.innerHTML = '<p class="empty-state">No inventory items registered yet.</p>';
    if (inventoryResultsCount) inventoryResultsCount.textContent = '0 results';
    return;
  }

  const visibleInventory = inventory.filter(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    const unitCost = Number(item.unitCost ?? item.cost) || 0;
    const stockStatus = getInventoryStockStatus(item);

    const searchableText = [
      item.name,
      item.category,
      item.reorderNumber,
      item.filterType,
      item.vendorName,
      stock,
      unitCost,
      reorderLevel,
      stockStatus.status
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (inventoryResultsCount) {
    inventoryResultsCount.textContent = `${visibleInventory.length} of ${inventory.length} items`;
  }

  if (visibleInventory.length === 0) {
    inventoryList.innerHTML = '<p class="empty-state">No inventory items match your search.</p>';
    return;
  }

  inventoryList.innerHTML = `
    <div class="inventory-table">
      <div class="inventory-row inventory-header">
        <span>Filter</span>
        <span>Category</span>
        <span>Reorder #</span>
        <span>Stock</span>
        <span>Unit Cost</span>
        <span>Reorder Level</span>
        <span>Usage</span>
        <span>Status</span>
      </div>

      ${visibleInventory.map(item => {
        const stock = Number(item.stock) || 0;
        const reorderLevel = Number(item.reorderLevel) || 0;
        const unitCost = Number(item.unitCost ?? item.cost) || 0;
        const stockStatus = getInventoryStockStatus(item);
        const usage = inventoryUsage.find(entry => Number(entry.inventoryId) === Number(item.id));

        return `
          <div class="inventory-row">
            <span class="inventory-item-name">
              ${escapeHTML(item.name)}
              <small>${escapeHTML([item.filterType, item.vendorName].filter(Boolean).join(' · '))}</small>
            </span>
            <span>${escapeHTML(item.category || 'Uncategorized')}</span>
            <span>${escapeHTML(item.reorderNumber || 'N/A')}</span>
            <span>${stock}</span>
            <span>$${unitCost.toFixed(2)}</span>
            <span>${reorderLevel}</span>
            <span>${usage ? `${usage.totalUsed} used` : 'No usage'}</span>
            <span>
              <span class="stock-pill stock-${escapeHTML(stockStatus.type)}">${escapeHTML(stockStatus.status)}</span>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

if (inventorySearchInput) {
  inventorySearchInput.addEventListener('input', () => {
    renderInventory();
  });
}

function formatMoney(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function formatShortDate(value) {
  if (!value) return 'Not updated';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not updated' : date.toLocaleDateString();
}

function getSupplierById(id) {
  return suppliers.find(supplier => Number(supplier.id) === Number(id));
}

function getInventoryById(id) {
  return inventory.find(item => Number(item.id) === Number(id));
}

function getSupplierProductLabel(product) {
  const item = getInventoryById(product.inventoryId);
  const supplier = getSupplierById(product.supplierId);
  const productName = product.inventoryName || product.productName || item?.name || 'Inventory item';
  const supplierName = product.supplierName || supplier?.name || 'Supplier';
  return `${productName} · ${supplierName} · ${formatMoney(product.currentPrice)}`;
}

function getSupplierProductSearchText(product) {
  const item = getInventoryById(product.inventoryId);
  const supplier = getSupplierById(product.supplierId);

  return [
    product.productName,
    product.inventoryName,
    item?.name,
    item?.category,
    item?.reorderNumber,
    item?.filterType,
    product.supplierName,
    supplier?.name,
    supplier?.category,
    product.supplierSku,
    product.status,
    product.direction
  ].join(' ').toLowerCase();
}

function getSupplierComparisonRows() {
  const grouped = supplierProducts
    .filter(product => product.status !== 'inactive' && getInventoryById(product.inventoryId))
    .reduce((groups, product) => {
      const current = groups.get(Number(product.inventoryId)) || [];
      current.push(product);
      groups.set(Number(product.inventoryId), current);
      return groups;
    }, new Map());

  return Array.from(grouped.entries()).map(([inventoryId, products]) => {
    const sorted = products.slice().sort((a, b) => Number(a.currentPrice) - Number(b.currentPrice));
    const best = sorted[0];
    const highest = sorted[sorted.length - 1];
    const item = getInventoryById(inventoryId);
    const bestSupplier = getSupplierById(best.supplierId);
    const highestPrice = Number(highest?.currentPrice) || 0;
    const bestPrice = Number(best?.currentPrice) || 0;
    const spread = Math.max(highestPrice - bestPrice, 0);

    return {
      inventoryId,
      item,
      products: sorted,
      best,
      bestSupplierName: best.supplierName || bestSupplier?.name || 'Supplier',
      bestPrice,
      highestPrice,
      spread,
      spreadPercent: highestPrice > 0 ? (spread / highestPrice) * 100 : 0
    };
  }).sort((a, b) => b.spread - a.spread);
}

function getSupplierStats() {
  const monitoredIds = new Set(supplierProducts.map(product => Number(product.inventoryId)).filter(Boolean));
  const comparisonRows = getSupplierComparisonRows();
  const priceChanges = supplierProducts.filter(product => product.lastPrice !== null && Number(product.currentPrice) !== Number(product.lastPrice)).length;
  const increaseAlerts = supplierProducts.filter(product => product.direction === 'up').length;
  const criticalProducts = inventory.filter(item => {
    if (!monitoredIds.has(Number(item.id))) return false;
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;
    return stock <= reorderLevel;
  }).length;
  const bestCounts = comparisonRows.reduce((counts, row) => {
    const current = counts.get(row.bestSupplierName) || 0;
    counts.set(row.bestSupplierName, current + 1);
    return counts;
  }, new Map());
  const bestSupplier = Array.from(bestCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  return {
    monitoredProducts: monitoredIds.size,
    priceChanges,
    increaseAlerts,
    criticalProducts,
    bestSupplier
  };
}

function updatePurchaseOrderProductOptions() {
  if (!purchaseOrderProductSelect) return;

  const selectedSupplierId = Number(purchaseOrderSupplierSelect?.value) || null;
  const selectedProductId = purchaseOrderProductSelect.value;
  const products = supplierProducts.filter(product => (
    product.status !== 'inactive'
    && (!selectedSupplierId || Number(product.supplierId) === selectedSupplierId)
  ));

  purchaseOrderProductSelect.innerHTML = `
    <option value="">Optional tracked product</option>
    ${products.map(product => `
      <option value="${Number(product.id)}">${escapeHTML(getSupplierProductLabel(product))}</option>
    `).join('')}
  `;

  if (products.some(product => String(product.id) === String(selectedProductId))) {
    purchaseOrderProductSelect.value = selectedProductId;
  }
}

function updateSupplierOptions() {
  if (supplierProductInventorySelect) {
    const selectedValue = supplierProductInventorySelect.value;
    supplierProductInventorySelect.innerHTML = `
      <option value="">Select item</option>
      ${inventory.map(item => `
        <option value="${Number(item.id)}">${escapeHTML(item.name)} · ${escapeHTML(item.reorderNumber || item.category || 'Inventory')}</option>
      `).join('')}
    `;
    supplierProductInventorySelect.value = selectedValue;
  }

  const supplierOptions = suppliers.map(supplier => `
    <option value="${Number(supplier.id)}">${escapeHTML(supplier.name)}${supplier.status === 'inactive' ? ' · inactive' : ''}</option>
  `).join('');

  if (supplierProductSupplierSelect) {
    const selectedValue = supplierProductSupplierSelect.value;
    supplierProductSupplierSelect.innerHTML = `<option value="">Select supplier</option>${supplierOptions}`;
    supplierProductSupplierSelect.value = selectedValue;
  }

  if (purchaseOrderSupplierSelect) {
    const selectedValue = purchaseOrderSupplierSelect.value;
    purchaseOrderSupplierSelect.innerHTML = `<option value="">Select supplier</option>${supplierOptions}`;
    purchaseOrderSupplierSelect.value = selectedValue;
  }

  updatePurchaseOrderProductOptions();
}

function renderSuppliers() {
  if (!suppliersList && !supplierProductsList && !supplierComparisonList) return;

  const searchValue = suppliersSearchInput ? suppliersSearchInput.value.trim().toLowerCase() : '';
  const stats = getSupplierStats();
  const comparisonRows = getSupplierComparisonRows();

  if (suppliersTotalKpi) suppliersTotalKpi.textContent = suppliers.length;
  if (supplierProductsKpi) supplierProductsKpi.textContent = stats.monitoredProducts;
  if (supplierPriceChangesKpi) supplierPriceChangesKpi.textContent = stats.priceChanges;
  if (supplierIncreaseAlertsKpi) supplierIncreaseAlertsKpi.textContent = stats.increaseAlerts;
  if (supplierCriticalProductsKpi) supplierCriticalProductsKpi.textContent = stats.criticalProducts;
  if (supplierBestSuggestionKpi) supplierBestSuggestionKpi.textContent = stats.bestSupplier;

  const visibleSuppliers = suppliers.filter(supplier => [
    supplier.name,
    supplier.contact,
    supplier.email,
    supplier.phone,
    supplier.website,
    supplier.category,
    supplier.status,
    supplier.notes
  ].join(' ').toLowerCase().includes(searchValue));

  const visibleProducts = supplierProducts.filter(product => getSupplierProductSearchText(product).includes(searchValue));
  const visibleComparisons = comparisonRows.filter(row => [
    row.item?.name,
    row.item?.category,
    row.item?.reorderNumber,
    row.bestSupplierName,
    ...row.products.map(product => getSupplierProductSearchText(product))
  ].join(' ').toLowerCase().includes(searchValue));
  const visibleOrders = purchaseOrders.filter(order => [
    order.poNumber,
    order.supplierName,
    getSupplierById(order.supplierId)?.name,
    order.status,
    order.notes,
    ...(order.items || []).map(item => item.inventoryName)
  ].join(' ').toLowerCase().includes(searchValue));

  if (suppliersResultsCount) {
    const totalVisible = visibleSuppliers.length + visibleProducts.length + visibleOrders.length;
    suppliersResultsCount.textContent = `${totalVisible} records`;
  }

  if (supplierComparisonList) {
    supplierComparisonList.innerHTML = visibleComparisons.length === 0
      ? '<p class="empty-state">No supplier pricing matches this view.</p>'
      : visibleComparisons.map(row => {
        const item = row.item || {};
        const stockStatus = getInventoryStockStatus(item);

        return `
          <div class="supplier-comparison-card">
            <div>
              <span class="supplier-eyebrow">${escapeHTML(item.reorderNumber || item.category || 'Inventory')}</span>
              <strong>${escapeHTML(item.name || 'Inventory item')}</strong>
              <small>${row.products.length} suppliers · ${escapeHTML(stockStatus.status)}</small>
            </div>
            <div class="supplier-best-price">
              <span>Recommended</span>
              <strong>${escapeHTML(row.bestSupplierName)}</strong>
              <small>${formatMoney(row.bestPrice)} · saves ${formatMoney(row.spread)}</small>
            </div>
          </div>
        `;
      }).join('');
  }

  if (supplierProductsList) {
    supplierProductsList.innerHTML = visibleProducts.length === 0
      ? '<p class="empty-state">No supplier products tracked yet.</p>'
      : `
        <div class="supplier-products-table">
          <div class="supplier-product-row supplier-product-header">
            <span>Product</span>
            <span>Supplier</span>
            <span>Current</span>
            <span>Last</span>
            <span>Change</span>
            <span>Updated</span>
          </div>
          ${visibleProducts.map(product => {
            const item = getInventoryById(product.inventoryId);
            const supplier = getSupplierById(product.supplierId);
            const directionClass = product.direction === 'up' ? 'increase' : product.direction === 'down' ? 'decrease' : 'flat';
            const directionLabel = product.direction === 'up' ? 'Up' : product.direction === 'down' ? 'Down' : 'Flat';

            return `
              <div class="supplier-product-row">
                <span class="supplier-product-name">
                  ${escapeHTML(product.inventoryName || item?.name || product.productName || 'Inventory item')}
                  <small>${escapeHTML([item?.reorderNumber, product.supplierSku].filter(Boolean).join(' · ') || 'No SKU')}</small>
                </span>
                <span>${escapeHTML(product.supplierName || supplier?.name || 'Supplier')}</span>
                <span>${formatMoney(product.currentPrice)}</span>
                <span>${product.lastPrice === null ? 'N/A' : formatMoney(product.lastPrice)}</span>
                <span><span class="price-badge ${directionClass}">${directionLabel} ${product.variationPercent ? `${product.variationPercent > 0 ? '+' : ''}${product.variationPercent.toFixed(1)}%` : '0.0%'}</span></span>
                <span>${escapeHTML(formatShortDate(product.lastUpdatedAt))}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
  }

  if (suppliersList) {
    suppliersList.innerHTML = visibleSuppliers.length === 0
      ? '<p class="empty-state">No suppliers registered yet.</p>'
      : visibleSuppliers.map(supplier => {
        const productCount = supplierProducts.filter(product => Number(product.supplierId) === Number(supplier.id)).length;

        return `
          <article class="supplier-directory-card">
            <div>
              <span class="status-badge supplier-status-${escapeHTML(supplier.status)}">${escapeHTML(supplier.status)}</span>
              <h4>${escapeHTML(supplier.name)}</h4>
              <p>${escapeHTML(supplier.category || 'Uncategorized supplier')}</p>
            </div>
            <div class="supplier-contact-stack">
              <span>${escapeHTML(supplier.contact || 'No contact')}</span>
              <span>${escapeHTML(supplier.email || supplier.phone || 'No contact details')}</span>
              <span>${productCount} products linked</span>
            </div>
          </article>
        `;
      }).join('');
  }

  if (purchaseOrdersList) {
    purchaseOrdersList.innerHTML = visibleOrders.length === 0
      ? '<p class="empty-state">No purchase orders yet.</p>'
      : visibleOrders.slice(0, 8).map(order => `
        <article class="purchase-order-card">
          <div>
            <span class="status-badge po-status-${escapeHTML(String(order.status).toLowerCase())}">${escapeHTML(order.status)}</span>
            <strong>${escapeHTML(order.poNumber || `PO-${order.id}`)}</strong>
            <small>${escapeHTML(order.supplierName || getSupplierById(order.supplierId)?.name || 'Supplier')}</small>
          </div>
          <div>
            <strong>${formatMoney(order.totalAmount)}</strong>
            <small>${escapeHTML(order.expectedDate ? `Expected ${formatShortDate(order.expectedDate)}` : 'No expected date')}</small>
          </div>
        </article>
      `).join('');
  }
}

if (suppliersSearchInput) {
  suppliersSearchInput.addEventListener('input', () => {
    renderSuppliers();
  });
}

if (purchaseOrderSupplierSelect) {
  purchaseOrderSupplierSelect.addEventListener('change', updatePurchaseOrderProductOptions);
}

function getMaintenanceTypeStatus(type) {
  const normalizedType = String(type || '').toLowerCase();

  if (normalizedType.includes('critical')) {
    return {
      label: 'Critical',
      type: 'critical'
    };
  }

  if (normalizedType.includes('replace')) {
    return {
      label: 'Replacement',
      type: 'replacement'
    };
  }

  if (normalizedType.includes('warning') || normalizedType.includes('review') || normalizedType.includes('inspection')) {
    return {
      label: 'Review',
      type: 'review'
    };
  }

  return {
    label: 'General',
    type: 'general'
  };
}

function getPendingMaintenanceItems() {
  return filters.map(filter => {
    const machine = machines.find(machine => machine.id === filter.machineId);
    const operational = getFilterOperationalStatus(filter);

    return {
      filter,
      machine,
      operational
    };
  }).filter(item => item.operational.type === 'warning' || item.operational.type === 'critical');
}

function renderMaintenance() {
  if (!maintenanceList) return;

  const searchValue = maintenanceSearchInput ? maintenanceSearchInput.value.trim().toLowerCase() : '';
  const pendingMaintenance = getPendingMaintenanceItems();

  const warningReviews = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'review';
  }).length;

  const criticalInspections = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'critical';
  }).length;

  const replacements = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'replacement';
  }).length;

  if (maintenanceTotalKpi) maintenanceTotalKpi.textContent = maintenanceRecords.length;
  if (maintenanceWarningKpi) maintenanceWarningKpi.textContent = warningReviews;
  if (maintenanceCriticalKpi) maintenanceCriticalKpi.textContent = criticalInspections;
  if (maintenanceReplacementKpi) maintenanceReplacementKpi.textContent = replacements;

  const visiblePending = pendingMaintenance.filter(item => {
    const searchableText = [
      item.machine ? item.machine.name : 'Unknown Machine',
      item.filter.productName,
      item.operational.status,
      item.operational.reason,
      item.filter.psi || item.filter.psi === 0 ? `${item.filter.psi} PSI` : 'No PSI'
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  const visibleRecords = maintenanceRecords.filter(record => {
    const machine = machines.find(machine => machine.id === record.machineId);
    const filter = filters.find(filter => filter.id === record.filterId);
    const typeStatus = getMaintenanceTypeStatus(record.type);
    const dateText = record.date ? new Date(record.date).toLocaleDateString() : 'Not recorded';

    const searchableText = [
      dateText,
      machine ? machine.name : 'Unknown Machine',
      filter ? filter.productName : 'Not assigned',
      record.type,
      record.technicianName,
      record.inspectionStatus,
      record.priority,
      record.notes,
      typeStatus.label
    ].join(' ').toLowerCase();

    return searchableText.includes(searchValue);
  });

  if (maintenanceResultsCount) {
    const totalVisible = visiblePending.length + visibleRecords.length;
    const totalItems = pendingMaintenance.length + maintenanceRecords.length;
    maintenanceResultsCount.textContent = `${totalVisible} of ${totalItems} items`;
  }

  if (pendingMaintenance.length === 0 && maintenanceRecords.length === 0) {
    maintenanceList.innerHTML = '<p class="empty-state">No pending maintenance or maintenance records yet.</p>';
    return;
  }

  if (visiblePending.length === 0 && visibleRecords.length === 0) {
    maintenanceList.innerHTML = '<p class="empty-state">No maintenance items match your search.</p>';
    return;
  }

  const pendingSection = visiblePending.length === 0 ? `
    <div class="maintenance-table">
      <div class="maintenance-header-clean">
        <span>Priority</span>
        <span>Machine</span>
        <span>Filter</span>
        <span>Type</span>
        <span>Reason</span>
        <span>Action</span>
      </div>
      <div class="maintenance-row">
        <span>—</span>
        <span class="maintenance-machine-name">No pending items</span>
        <span>—</span>
        <span>—</span>
        <span class="maintenance-notes-cell">All filters are currently healthy.</span>
        <span>—</span>
      </div>
    </div>
  ` : `
    <div class="maintenance-table">
      <div class="maintenance-header-clean">
        <span>Priority</span>
        <span>Machine</span>
        <span>Filter</span>
        <span>Type</span>
        <span>Reason</span>
        <span>Action</span>
      </div>

      ${visiblePending.map(item => {
        const statusClass = item.operational.type === 'critical' ? 'critical' : 'review';
        const actionLabel = item.operational.type === 'critical' ? 'Critical Inspection' : 'Warning Review';

        return `
          <div class="maintenance-row">
            <span>
              <span class="maintenance-pill maintenance-${escapeHTML(statusClass)}">${escapeHTML(item.operational.status)}</span>
            </span>
            <span class="maintenance-machine-name">${escapeHTML(item.machine ? item.machine.name : 'Unknown Machine')}</span>
            <span class="maintenance-filter-name">${escapeHTML(item.filter.productName || 'N/A')}</span>
            <span>${escapeHTML(actionLabel)}</span>
            <span class="maintenance-notes-cell">${escapeHTML(item.operational.reason)}</span>
            <span>
              <button type="button" class="filter-action-btn filter-maintenance-btn" onclick="startMaintenanceFromFilter(${Number(item.filter.id)})">
                Log Maintenance
              </button>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const historySection = visibleRecords.length === 0 ? `
    <p class="empty-state">No maintenance history yet.</p>
  ` : `
    <div class="maintenance-table">
      <div class="maintenance-header-clean maintenance-history-header-clean">
        <span>Date</span>
        <span>Machine</span>
        <span>Filter</span>
        <span>Type</span>
        <span>Notes</span>
        <span>Status</span>
      </div>

      ${visibleRecords.map(record => {
        const machine = machines.find(machine => machine.id === record.machineId);
        const filter = filters.find(filter => filter.id === record.filterId);
        const typeStatus = getMaintenanceTypeStatus(record.type);
        const dateText = record.date ? new Date(record.date).toLocaleDateString() : 'Not recorded';

        return `
          <div class="maintenance-row">
            <span>${escapeHTML(dateText)}</span>
            <span class="maintenance-machine-name">${escapeHTML(machine ? machine.name : 'Unknown Machine')}</span>
            <span class="maintenance-filter-name">${escapeHTML(filter ? filter.productName : 'Not assigned')}</span>
            <span>${escapeHTML(record.type || 'General')}</span>
            <span class="maintenance-notes-cell">
              ${escapeHTML(record.notes || 'No notes')}
              <small>${escapeHTML([record.technicianName ? `Tech: ${record.technicianName}` : '', record.inspectionStatus ? `Inspection: ${record.inspectionStatus}` : '', record.priority].filter(Boolean).join(' · '))}</small>
            </span>
            <span>
              <span class="maintenance-pill maintenance-${escapeHTML(typeStatus.type)}">${escapeHTML(typeStatus.label)}</span>
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  maintenanceList.innerHTML = `
    <div class="maintenance-stack">
      <div class="maintenance-block">
        <div class="panel-heading panel-heading-clean">
          <h3>Pending Maintenance</h3>
          <p>Filters currently in Watch or Critical status that need attention.</p>
        </div>
        ${pendingSection}
      </div>

      <div class="maintenance-block">
        <div class="panel-heading panel-heading-clean">
          <h3>Maintenance History</h3>
          <p>Actions already logged in the system.</p>
        </div>
        ${historySection}
      </div>
    </div>
  `;
}


function generateMaintenanceReport() {
  if (!maintenanceReportOutputCard || !maintenanceReportOutput) return;

  const pendingMaintenance = getPendingMaintenanceItems();

  const warningReviews = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'review';
  }).length;

  const criticalInspections = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'critical';
  }).length;

  const replacements = maintenanceRecords.filter(record => {
    const typeStatus = getMaintenanceTypeStatus(record.type);
    return typeStatus.type === 'replacement';
  }).length;

  const psiCorrections = maintenanceRecords.filter(record => record.correctedPsi !== null && record.correctedPsi !== undefined).length;

  const pendingRows = pendingMaintenance.length === 0 ? `
    <tr>
      <td colspan="6">No pending maintenance. All filters are currently healthy.</td>
    </tr>
  ` : pendingMaintenance.map(item => {
    const currentPsi = item.filter.psi || item.filter.psi === 0 ? `${item.filter.psi} PSI` : 'No PSI recorded';
    const action = item.operational.type === 'critical' ? 'Inspect immediately / prepare replacement' : 'Review and correct PSI';

    return `
      <tr>
        <td>${escapeHTML(item.operational.status)}</td>
        <td>${escapeHTML(item.machine ? item.machine.name : 'Unknown Machine')}</td>
        <td>${escapeHTML(item.filter.productName || 'N/A')}</td>
        <td>${escapeHTML(currentPsi)}</td>
        <td>${escapeHTML(item.operational.reason)}</td>
        <td>${escapeHTML(action)}</td>
      </tr>
    `;
  }).join('');

  const historyRows = maintenanceRecords.length === 0 ? `
    <tr>
      <td colspan="8">No maintenance history recorded yet.</td>
    </tr>
  ` : maintenanceRecords.slice().reverse().map(record => {
    const machine = machines.find(machine => machine.id === record.machineId);
    const filter = filters.find(filter => filter.id === record.filterId);
    const dateText = record.date ? new Date(record.date).toLocaleDateString() : 'Not recorded';
    const psiText = record.correctedPsi !== null && record.correctedPsi !== undefined
      ? `${record.previousPsi !== null && record.previousPsi !== undefined ? record.previousPsi : 'N/A'} → ${record.correctedPsi}`
      : 'N/A';
    const replacementText = record.replacedWith
      ? `${record.replacedFrom || 'Unknown'} → ${record.replacedWith}`
      : 'N/A';

    return `
      <tr>
        <td>${escapeHTML(dateText)}</td>
        <td>${escapeHTML(machine ? machine.name : 'Unknown Machine')}</td>
        <td>${escapeHTML(filter ? filter.productName : 'Not assigned')}</td>
        <td>${escapeHTML(record.type || 'General')}</td>
        <td>${escapeHTML(psiText)}</td>
        <td>${escapeHTML(replacementText)}</td>
        <td>${escapeHTML(record.notes || 'No notes')}</td>
        <td>${escapeHTML(getMaintenanceTypeStatus(record.type).label)}</td>
      </tr>
    `;
  }).join('');

  maintenanceReportOutput.innerHTML = `
    <div class="maintenance-report-summary">
      <h4>FiltraCore Maintenance Report</h4>
      <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
      <div class="maintenance-report-metrics">
        <div><span>Total Records</span><strong>${maintenanceRecords.length}</strong></div>
        <div><span>Warning Reviews</span><strong>${warningReviews}</strong></div>
        <div><span>Critical Inspections</span><strong>${criticalInspections}</strong></div>
        <div><span>Filter Replacements</span><strong>${replacements}</strong></div>
        <div><span>PSI Corrections</span><strong>${psiCorrections}</strong></div>
        <div><span>Pending Items</span><strong>${pendingMaintenance.length}</strong></div>
      </div>
    </div>

    <div class="maintenance-report-section">
      <h4>Pending Maintenance</h4>
      <table class="maintenance-report-table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Machine</th>
            <th>Filter</th>
            <th>Current PSI</th>
            <th>Reason</th>
            <th>Recommended Action</th>
          </tr>
        </thead>
        <tbody>${pendingRows}</tbody>
      </table>
    </div>

    <div class="maintenance-report-section">
      <h4>Maintenance History</h4>
      <table class="maintenance-report-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Machine</th>
            <th>Filter</th>
            <th>Type</th>
            <th>PSI Change</th>
            <th>Replacement</th>
            <th>Notes</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>
    </div>
  `;

  setupState.reportGenerated = true;
  saveSetupState();
  renderSmartSetup();
  maintenanceReportOutputCard.style.display = 'block';
  if (closeMaintenanceReportBtn) {
    closeMaintenanceReportBtn.style.display = 'inline-block';
  }
  maintenanceReportOutputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

if (maintenanceSearchInput) {
  maintenanceSearchInput.addEventListener('input', () => {
    renderMaintenance();
  });
}

if (generateMaintenanceReportBtn) {
  generateMaintenanceReportBtn.addEventListener('click', generateMaintenanceReport);
}

if (printMaintenanceReportBtn) {
  printMaintenanceReportBtn.addEventListener('click', () => {
    generateMaintenanceReport();
    window.print();
  });
}

if (closeMaintenanceReportBtn) {
  closeMaintenanceReportBtn.addEventListener('click', () => {
    if (maintenanceReportOutputCard) {
      maintenanceReportOutputCard.style.display = 'none';
    }

    closeMaintenanceReportBtn.style.display = 'none';
  });
}

function getReorderAlerts() {
  const alerts = [];

  inventory.forEach(item => {
    const stock = Number(item.stock) || 0;
    const reorderLevel = Number(item.reorderLevel) || 0;

    if (stock <= reorderLevel) {
      alerts.push({
        type: 'warning',
        machine: 'Inventory',
        message: `${item.name} low stock (${stock} left). Reorder level is ${reorderLevel}.`
      });
    }
  });

  getInventoryPredictions().forEach(item => {
    if (item.coverageMonths !== null && item.coverageMonths <= 1) {
      alerts.push({
        type: 'critical',
        machine: 'Inventory Prediction',
        message: `${item.productName} has only ${item.coverageMonths.toFixed(1)} months of stock coverage. Recommended action: reorder immediately.`
      });
    } else if (item.coverageMonths !== null && item.coverageMonths <= 3) {
      alerts.push({
        type: 'warning',
        machine: 'Inventory Prediction',
        message: `${item.productName} has ${item.coverageMonths.toFixed(1)} months of stock coverage. Recommended action: plan reorder soon.`
      });
    } else if (item.coverageMonths !== null && item.coverageMonths <= 6) {
      alerts.push({
        type: 'warning',
        machine: 'Inventory Prediction',
        message: `${item.productName} has ${item.coverageMonths.toFixed(1)} months of stock coverage. Recommended action: monitor monthly consumption.`
      });
    }
  });

  return alerts;
}

function getSystemAlerts() {
  const alerts = [];

  machines.forEach(machine => {
    const machineFilters = filters.filter(filter => filter.machineId === machine.id);

    if (machineFilters.length === 0) {
      alerts.push({
        type: 'critical',
        machine: machine.name,
        message: 'No filters assigned. Machine is unprotected.'
      });
      return;
    }

    machineFilters.forEach(filter => {
      const status = getFilterStatus(filter);
      const psiStatus = getPsiStatus(filter.psi, filter.psiMin, filter.psiMax);
      const psiTrend = getPsiTrend(filter.psiHistory);
      const psiPrediction = getPsiFailurePrediction(filter.psiHistory);

      let finalType = 'healthy';
      const messages = [];

      if (status === 'Expired' || status === 'Critical' || psiStatus.type === 'critical' || psiPrediction.type === 'critical') {
        finalType = 'critical';
      } else if (status === 'Due Soon' || psiStatus.type === 'warning' || psiTrend.type === 'warning' || psiPrediction.type === 'warning') {
        finalType = 'warning';
      }

      if (filter.productName) {
        messages.push(`Filter: ${filter.productName}`);
      }

      if (status !== 'Active') {
        messages.push(`Lifecycle: ${status}`);
      }

      if (filter.psi || filter.psi === 0) {
        messages.push(`Current PSI: ${filter.psi}`);
      }

      if (psiStatus.status !== 'Healthy' && psiStatus.status !== 'Not recorded') {
        messages.push(`PSI Status: ${psiStatus.status}`);
      }

      if (psiTrend.trend === 'Dropping' || psiTrend.trend === 'Increasing') {
        messages.push(`Trend: ${psiTrend.trend}`);
      }

      if (psiPrediction.prediction !== 'Stable' && psiPrediction.prediction !== 'No prediction') {
        messages.push(`Prediction: ${psiPrediction.prediction}`);
      }

      if (finalType === 'healthy') {
        return;
      }

      let finalMessage = messages.join(' | ');

      if (finalType === 'critical') {
        finalMessage += '. Recommended action: inspect immediately and prepare replacement.';
      } else if (finalType === 'warning') {
        finalMessage += '. Recommended action: monitor and schedule maintenance.';
      }

      alerts.push({
        type: finalType,
        machine: machine.name,
        message: finalMessage
      });
    });
  });

  return alerts;
}

function getMachineRiskModel(machineName) {
  const machine = machines.find(machine => machine.name === machineName);
  const type = String(machine?.type || '').toLowerCase();

  const models = {
    ice: {
      warning: {
        labor: 35,
        operational: 40,
        equipment: 25
      },
      critical: {
        labor: 70,
        operational: 120,
        equipment: 80
      },
      reason: 'Ice equipment has higher operational impact because loss of ice can affect beverage service, food holding, and guest operations.'
    },
    coffee: {
      warning: {
        labor: 25,
        operational: 30,
        equipment: 20
      },
      critical: {
        labor: 60,
        operational: 80,
        equipment: 50
      },
      reason: 'Coffee equipment risk is based on service disruption, taste and water quality issues, and possible equipment scaling.'
    },
    soda: {
      warning: {
        labor: 30,
        operational: 45,
        equipment: 25
      },
      critical: {
        labor: 65,
        operational: 110,
        equipment: 70
      },
      reason: 'Soda systems affect beverage service, water quality, carbonation consistency, and guest-facing operations.'
    },
    refrigeration: {
      warning: {
        labor: 40,
        operational: 60,
        equipment: 40
      },
      critical: {
        labor: 90,
        operational: 180,
        equipment: 120
      },
      reason: 'Refrigeration has higher risk because failure can affect food safety, product loss, and operational compliance.'
    },
    water: {
      warning: {
        labor: 25,
        operational: 35,
        equipment: 20
      },
      critical: {
        labor: 55,
        operational: 90,
        equipment: 55
      },
      reason: 'Water systems affect service quality, filtration reliability, and downstream equipment protection.'
    },
    default: {
      warning: {
        labor: 25,
        operational: 25,
        equipment: 15
      },
      critical: {
        labor: 50,
        operational: 60,
        equipment: 40
      },
      reason: 'General filter risk is based on inspection labor, maintenance planning, and possible equipment stress.'
    }
  };

  if (type.includes('ice')) return models.ice;
  if (type.includes('coffee')) return models.coffee;
  if (type.includes('soda')) return models.soda;
  if (type.includes('refrigeration')) return models.refrigeration;
  if (type.includes('water')) return models.water;

  return models.default;
}

function getFinancialRisk(alerts = getVisibleAlerts()) {
  let total = 0;
  const reasons = [];

  alerts.forEach(alert => {
    const model = getMachineRiskModel(alert.machine);
    const components = alert.type === 'critical' ? model.critical : model.warning;
    const cost = components.labor + components.operational + components.equipment;

    total += cost;

    reasons.push({
      machine: alert.machine,
      type: alert.type,
      cost,
      message: alert.message,
      costReason: `${model.reason} Breakdown: labor $${components.labor}, operational impact $${components.operational}, equipment risk $${components.equipment}.`
    });
  });

  return {
    total,
    reasons
  };
}

function getPotentialSavings() {
  return getFinancialRisk().total;
}

function renderFinancialMetrics() {
  const riskData = getFinancialRisk();
  const risk = riskData.total;
  const savings = getPotentialSavings();

  if (riskExposureEl) {
    riskExposureEl.textContent = `$${risk.toFixed(2)}`;
  }

  if (savingsEl) {
    savingsEl.textContent = `$${savings.toFixed(2)}`;
  }
}

function getAlertKey(alert) {
  return `${alert.type}|${alert.machine}|${alert.message}`;
}

function getAllAlerts() {
  return [...getSystemAlerts(), ...getReorderAlerts()];
}

function getVisibleAlerts() {
  return getAllAlerts().filter(alert => !archivedAlerts.includes(getAlertKey(alert)));
}

function archiveAlert(alertKey) {
  if (!archivedAlerts.includes(alertKey)) {
    archivedAlerts.push(alertKey);
  }

  localStorage.setItem('filtracore_archivedAlerts', JSON.stringify(archivedAlerts));
  renderRiskScore();
  renderFinancialMetrics();
  renderReports();
  renderSmartSetup();
  renderAlertsModal();
}

function archiveAllVisibleAlerts() {
  getVisibleAlerts().forEach(alert => {
    const key = getAlertKey(alert);

    if (!archivedAlerts.includes(key)) {
      archivedAlerts.push(key);
    }
  });

  localStorage.setItem('filtracore_archivedAlerts', JSON.stringify(archivedAlerts));
  renderRiskScore();
  renderFinancialMetrics();
  renderReports();
  renderSmartSetup();
  renderAlertsModal();
}

function renderAlertsModal() {
  if (!modalAlertsList) return;

  const alerts = getVisibleAlerts();
  const criticalCount = alerts.filter(alert => alert.type === 'critical').length;
  const warningCount = alerts.filter(alert => alert.type === 'warning').length;
  const riskData = getFinancialRisk(alerts);
  const risk = riskData.total;

  if (modalAlertCount) modalAlertCount.textContent = alerts.length;
  if (modalCriticalCount) modalCriticalCount.textContent = criticalCount;
  if (modalWarningCount) modalWarningCount.textContent = warningCount;
  if (modalRiskExposure) modalRiskExposure.textContent = `$${risk.toFixed(2)}`;

  if (alerts.length === 0) {
    modalAlertsList.innerHTML = '<p class="empty-state">All systems operational.</p>';
    return;
  }

  alerts.sort((a, b) => {
    const priority = {
      critical: 1,
      warning: 2
    };

    return priority[a.type] - priority[b.type];
  });

    modalAlertsList.innerHTML = alerts.map(alert => {
      const alertKey = getAlertKey(alert);
      const safeAlertKey = escapeInlineValue(alertKey);
      const safeMachine = escapeInlineValue(alert.machine);
      const safeType = escapeInlineValue(alert.type);
      const safeMessage = escapeInlineValue(alert.message);
      const riskReason = riskData.reasons.find(reason => getAlertKey(reason) === alertKey);

      return `
        <div class="modal-alert-card alert-${escapeHTML(alert.type)}">
          <div class="alert-card-header">
            <div>
              <h3>${escapeHTML(alert.machine)}</h3>
              <p><strong>${escapeHTML(alert.type.toUpperCase())}</strong></p>
            </div>

            <div class="alert-actions">
              <button type="button" class="view-machine-btn" onclick="goToMachine('${safeMachine}')">
                View Machine
              </button>
              <button type="button" class="start-maintenance-btn" onclick="startMaintenanceFromAlert('${safeMachine}', '${safeType}', '${safeMessage}')">
                Start Maintenance
              </button>
              <button type="button" class="archive-alert-btn" onclick="archiveAlert('${safeAlertKey}')">
                Archive
              </button>
            </div>
          </div>
          <p>${escapeHTML(alert.message)}</p>
          ${riskReason ? `
            <div class="risk-breakdown">
              <p><strong>Risk Exposure:</strong> $${riskReason.cost.toFixed(2)}</p>
              <p><strong>Why this amount?</strong> ${escapeHTML(riskReason.costReason)}</p>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
}

function openAlertsModal() {
  if (!alertsModal) return;

  renderRiskScore();
  renderFinancialMetrics();
  renderAlertsModal();
  alertsModal.classList.add('is-open');
  alertsModal.setAttribute('aria-hidden', 'false');
}

function closeAlertsModalWindow() {
  if (!alertsModal) return;

  alertsModal.classList.remove('is-open');
  alertsModal.setAttribute('aria-hidden', 'true');
}

function goToMachine(machineName) {
  closeAlertsModalWindow();
  showSection('machines');
  setActiveNavById('machines');

  if (machineSearchInput) {
    machineSearchInput.value = machineName;
    renderMachines();
    machineSearchInput.focus();
  }

  const machinesSection = document.querySelector('#machines');
  if (machinesSection) {
    machinesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function startMaintenanceFromAlert(machineName, alertType, alertMessage) {
  closeAlertsModalWindow();
  showSection('maintenance');
  setActiveNavById('maintenance');
  updateMaintenanceOptions();

  const machine = machines.find(machine => machine.name === machineName);
  const machineFilters = machine ? filters.filter(filter => filter.machineId === machine.id) : [];
  const latestFilter = machineFilters.length > 0 ? machineFilters[machineFilters.length - 1] : null;
  const today = new Date().toISOString().split('T')[0];

  if (maintenanceMachineSelect && machine) {
    maintenanceMachineSelect.value = String(machine.id);
  }

  if (maintenanceFilterSelect && latestFilter) {
    maintenanceFilterSelect.value = String(latestFilter.id);
  }
  updateMaintenancePsiPreview();

  const maintenanceTypeInput = document.querySelector('#maintenance-type');
  const maintenanceDateInput = document.querySelector('#maintenance-date');
  const maintenanceNotesInput = document.querySelector('#maintenance-notes');

  if (maintenanceTypeInput) {
    maintenanceTypeInput.value = alertType === 'critical' ? 'Critical Inspection' : 'Warning Review';
  }

  if (maintenancePriorityInput) {
    maintenancePriorityInput.value = alertType === 'critical' ? 'Critical' : 'Due Soon';
  }

  if (maintenanceDateInput) {
    maintenanceDateInput.value = today;
  }

  if (maintenanceNotesInput) {
    maintenanceNotesInput.value = `Alert from Intelligence Report: ${alertMessage}`;
  }

  const maintenanceSection = document.querySelector('#maintenance');
  if (maintenanceSection) {
    maintenanceSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openManualModal() {
  if (!manualModal) return;

  manualModal.classList.add('is-open');
  manualModal.setAttribute('aria-hidden', 'false');
}

function closeManualModalWindow() {
  if (!manualModal) return;

  manualModal.classList.remove('is-open');
  manualModal.setAttribute('aria-hidden', 'true');
}

function getSystemHealth() {
  if (machines.length === 0) return 100;

  const alerts = getVisibleAlerts();
  let score = 100;

  alerts.forEach(alert => {
    if (alert.type === 'critical') score -= 25;
    if (alert.type === 'warning') score -= 10;
  });

  if (score < 0) score = 0;

  return score;
}

function renderRiskScore() {
  const healthEl = document.querySelector('#system-health');
  const alerts = getVisibleAlerts();

  const criticalCount = alerts.filter(alert => alert.type === 'critical').length;
  const warningCount = alerts.filter(alert => alert.type === 'warning').length;

  if (alertCountEl) {
    alertCountEl.textContent = alerts.length;
  }

  if (dashboardAlertsCount) {
    dashboardAlertsCount.textContent = alerts.length;
  }

  if (alertSummaryEl) {
    alertSummaryEl.textContent = alerts.length === 0
      ? 'All systems operational'
      : `${criticalCount} critical / ${warningCount} warning`;
  }

  if (healthEl) {
    const health = getSystemHealth();
    healthEl.textContent = `System Health: ${health}%`;

    healthEl.classList.remove('health-good', 'health-warning', 'health-critical');

    if (health >= 80) {
      healthEl.classList.add('health-good');
    } else if (health >= 50) {
      healthEl.classList.add('health-warning');
    } else {
      healthEl.classList.add('health-critical');
    }
  }

  if (!riskList) return;

  if (machines.length === 0) {
    riskList.classList.remove('alerts-collapsed');
    riskList.innerHTML = '<p class="empty-state">No machines registered yet.</p>';
    return;
  }

  if (alerts.length === 0) {
    riskList.classList.remove('alerts-collapsed');
    riskList.innerHTML = '<p class="empty-state">All systems operational.</p>';
    return;
  }

  if (!alertsExpanded) {
    riskList.classList.add('alerts-collapsed');
    riskList.innerHTML = `<p class="empty-state">${alerts.length} active alerts. Use Show Alerts to review them.</p>`;
    return;
  }

  riskList.classList.remove('alerts-collapsed');

  alerts.sort((a, b) => {
    const priority = {
      critical: 1,
      warning: 2
    };

    return priority[a.type] - priority[b.type];
  });

  riskList.innerHTML = alerts.map(alert => {
    const alertKey = getAlertKey(alert);
    const safeAlertKey = escapeInlineValue(alertKey);

    return `
      <div class="machine-card alert-${escapeHTML(alert.type)}">
        <div class="alert-card-header">
          <div>
            <h3>${escapeHTML(alert.machine)}</h3>
            <p><strong>${escapeHTML(alert.type.toUpperCase())}</strong></p>
          </div>
          <button type="button" class="archive-alert-btn" onclick="archiveAlert('${safeAlertKey}')">Archive</button>
        </div>
        <p>${escapeHTML(alert.message)}</p>
      </div>
    `;
  }).join('');
}

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (loginError) {
      loginError.textContent = '';
    }

    try {
      if (loginSubmitButton) {
        loginSubmitButton.disabled = true;
        loginSubmitButton.textContent = 'Signing In...';
      }

      await signIn(loginEmailInput.value.trim(), loginPasswordInput.value);
    } catch (error) {
      if (loginError) {
        loginError.textContent = error.message || 'Unable to sign in.';
      }
    } finally {
      if (loginSubmitButton) {
        loginSubmitButton.disabled = false;
        loginSubmitButton.textContent = 'Sign In';
      }
    }
  });
}

authModeSigninBtn?.addEventListener('click', () => setAuthMode('signin'));
authModeSignupBtn?.addEventListener('click', () => setAuthMode('signup'));
backToLoginBtn?.addEventListener('click', () => setAuthMode('signin'));

if (signupForm) {
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (signupError) {
      signupError.textContent = '';
    }

    const password = signupPasswordInput?.value || '';
    const confirmPassword = signupConfirmPasswordInput?.value || '';

    if (password !== confirmPassword) {
      if (signupError) signupError.textContent = 'Passwords do not match.';
      signupConfirmPasswordInput?.focus();
      return;
    }

    try {
      if (signupSubmitButton) {
        signupSubmitButton.disabled = true;
        signupSubmitButton.textContent = 'Creating...';
      }

      await signUpPublicAccount({
        businessType: signupBusinessTypeInput?.value || 'Restaurant',
        businessName: signupBusinessNameInput?.value.trim() || '',
        fullName: signupFullNameInput?.value.trim() || '',
        email: signupEmailInput?.value.trim() || '',
        password
      });
    } catch (error) {
      if (signupError) {
        signupError.textContent = error.message || 'Unable to create account.';
      }
      if (signupPasswordInput) signupPasswordInput.value = '';
      if (signupConfirmPasswordInput) signupConfirmPasswordInput.value = '';
      signupPasswordInput?.focus();
    } finally {
      if (signupSubmitButton) {
        signupSubmitButton.disabled = false;
        signupSubmitButton.textContent = 'Create Account';
      }
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    await signOut();
  });
}

if (restaurantLogoutButton) {
  restaurantLogoutButton.addEventListener('click', async () => {
    await signOut();
  });
}

if (clientAddWorkspaceButton) {
  clientAddWorkspaceButton.addEventListener('click', () => {
    openClientWorkspaceModal();
  });
}

if (clientWorkspaceCloseButton) {
  clientWorkspaceCloseButton.addEventListener('click', () => {
    closeClientWorkspaceModal();
  });
}

if (clientWorkspaceModal) {
  clientWorkspaceModal.addEventListener('click', (e) => {
    if (e.target === clientWorkspaceModal) {
      closeClientWorkspaceModal();
    }
  });
}

if (switchRestaurantButton) {
  switchRestaurantButton.addEventListener('click', async () => {
    clearSelectedRestaurant();
    await loadAdminUsers();
    updateAuthUI();
    renderApp();
  });
}

if (refreshAccountsBtn) {
  refreshAccountsBtn.addEventListener('click', async () => {
    await loadAdminUsers();
  });
}

if (refreshRestaurantsBtn) {
  refreshRestaurantsBtn.addEventListener('click', async () => {
    await loadAdminUsers();
  });
}

if (restaurantList) {
  restaurantList.addEventListener('click', async (e) => {
    const card = e.target.closest('.restaurant-card');
    if (!card) return;

    await openRestaurant(card.dataset.tenantId);
  });
}

if (restaurantLogoInput) {
  restaurantLogoInput.addEventListener('change', () => {
    loadRestaurantLogoFile(restaurantLogoInput.files?.[0] || null);
  });
}

if (clientWorkspaceLogoInput) {
  clientWorkspaceLogoInput.addEventListener('change', () => {
    loadClientWorkspaceLogoFile(clientWorkspaceLogoInput.files?.[0] || null);
  });
}

if (restaurantForm) {
  restaurantForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createRestaurantAccount();
  });
}

if (clientWorkspaceForm) {
  clientWorkspaceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await createClientWorkspace();
  });
}

if (smartImportForm) {
  smartImportForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
      setFormBusy(smartImportForm, true);
      await previewSmartImport();
    } catch (error) {
      console.error(error);
      setSmartImportStatus(error.message || 'Unable to preview import.', 'error');
    } finally {
      setFormBusy(smartImportForm, false);
      if (applySmartImportBtn && pendingImportPreview?.records?.length) {
        applySmartImportBtn.disabled = false;
      }
    }
  });
}

if (applySmartImportBtn) {
  applySmartImportBtn.addEventListener('click', async () => {
    try {
      await applySmartImport();
    } catch (error) {
      console.error(error);
      setSmartImportStatus(error.message || 'Unable to apply import.', 'error');
      if (pendingImportPreview?.records?.length) {
        applySmartImportBtn.disabled = false;
      }
    }
  });
}

links.forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();

    // remove active from all
    links.forEach(l => l.classList.remove('active'));

    // add active to clicked
    link.classList.add('active');

    const id = link.getAttribute('href').replace('#', '');
    showSection(id);
  });
});

if (machineForm) {
  machineForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const machine = {
      id: Date.now(),
      name: document.querySelector('#machine-name').value.trim(),
      type: document.querySelector('#machine-type').value.trim(),
      category: document.querySelector('#machine-category')?.value.trim() || document.querySelector('#machine-type').value.trim(),
      location: document.querySelector('#machine-location').value.trim(),
      department: document.querySelector('#machine-department').value.trim(),
      brand: document.querySelector('#machine-brand').value.trim(),
      model: document.querySelector('#machine-model').value.trim(),
      serialNumber: document.querySelector('#machine-serial-number')?.value.trim() || '',
      building: document.querySelector('#machine-building')?.value.trim() || '',
      floor: document.querySelector('#machine-floor')?.value.trim() || '',
      zone: document.querySelector('#machine-zone')?.value.trim() || '',
      exactLocation: document.querySelector('#machine-exact-location')?.value.trim() || document.querySelector('#machine-location').value.trim(),
      assetId: document.querySelector('#machine-asset-id').value.trim()
    };

    if (isAtMachineLimit()) {
      showSaveError(new Error(machineLimitMessage()));
      return;
    }

    if (apiAvailable) {
      try {
        setFormBusy(machineForm, true);
        const state = await apiRequest('/api/machines', {
          method: 'POST',
          body: JSON.stringify(machine)
        });

        applyServerState(state);
        machineForm.reset();
        renderApp();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(machineForm, false);
      }

      return;
    }

    machines.push(machine);
    saveLocalData();
    machineForm.reset();
    renderApp();
  });
}

if (filterForm) {
  filterForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    syncFilterScheduleFields(false);

    const machineId = Number(document.querySelector('#filter-machine').value);
    const productId = Number(document.querySelector('#filter-product').value);
    const product = inventory.find(item => item.id === productId);
    const psiInput = document.querySelector('#filter-psi');
    const psi = psiInput && psiInput.value !== '' ? Number(psiInput.value) : null;
    const filterQuantity = Math.max(1, Number(filterQuantityInput?.value || 1));
    const psiMin = filterPsiMinInput && filterPsiMinInput.value !== '' ? Number(filterPsiMinInput.value) : 50;
    const psiMax = filterPsiMaxInput && filterPsiMaxInput.value !== '' ? Number(filterPsiMaxInput.value) : 70;
    const lifeMonths = Number(filterLifeMonthsInput?.value || product?.lifeMonths || getDefaultLifeMonths(product?.category));
    const installedAt = parseDateInput(filterInstalledAtInput?.value);
    const dueDate = filterDueDateInput?.value
      ? parseDateInput(filterDueDateInput.value)
      : addMonths(installedAt, lifeMonths);

    if (!machineId) {
      alert('Select a valid machine');
      return;
    }

    if (!product) {
      alert('Select a valid filter product');
      return;
    }

    if (Number(product.stock) < filterQuantity) {
      alert('No stock available for this filter product');
      return;
    }

    if (!lifeMonths || lifeMonths < 1 || Number.isNaN(installedAt.getTime()) || Number.isNaN(dueDate.getTime())) {
      alert('Complete lifespan, installation date, and replacement due date');
      return;
    }

    if (apiAvailable) {
      try {
        setFormBusy(filterForm, true);
        const state = await apiRequest('/api/filters', {
          method: 'POST',
          body: JSON.stringify({
            machineId,
            productId,
            psi,
            filterQuantity,
            psiMin,
            psiMax,
            vendorName: product.vendorName || '',
            lifeMonths,
            installedAt: installedAt.toISOString(),
            dueDate: dueDate.toISOString()
          })
        });

        applyServerState(state);
        filterForm.reset();
        renderApp();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(filterForm, false);
      }

      return;
    }

    product.stock = Number(product.stock) - filterQuantity;

    const filter = {
      id: Date.now(),
      machineId,
      productId: product.id,
      productName: product.name,
      reorderNumber: product.reorderNumber || '',
      filterType: product.filterType || product.category || '',
      filterQuantity,
      psiMin,
      psiMax,
      vendorName: product.vendorName || '',
      cost: Number(product.unitCost || 0),
      lifeMonths,
      psi,
      psiHistory: psi !== null ? [
        {
          date: new Date().toISOString(),
          psi
        }
      ] : [],
      installedAt: installedAt.toISOString(),
      dueDate: dueDate.toISOString()
    };

    filters.push(filter);
    const usage = inventoryUsage.find(entry => Number(entry.inventoryId) === Number(product.id));
    if (usage) {
      usage.totalUsed += filterQuantity;
      usage.events += 1;
      usage.lastUsedAt = installedAt.toISOString();
    } else {
      inventoryUsage.push({
        inventoryId: product.id,
        totalUsed: filterQuantity,
        events: 1,
        lastUsedAt: installedAt.toISOString()
      });
    }
    saveLocalData();
    filterForm.reset();
    renderApp();
  });
}

if (inventoryForm) {
  inventoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const category = document.querySelector('#inventory-category').value;

    const item = {
      id: Date.now(),
      name: document.querySelector('#inventory-name').value.trim(),
      category: category.trim(),
      reorderNumber: document.querySelector('#inventory-reorder-number')?.value.trim() || '',
      filterType: document.querySelector('#inventory-filter-type')?.value.trim() || category.trim(),
      vendorName: document.querySelector('#inventory-vendor-name')?.value.trim() || '',
      stock: Number(document.querySelector('#inventory-stock').value),
      unitCost: Number(document.querySelector('#inventory-cost').value),
      reorderLevel: Number(document.querySelector('#inventory-reorder').value),
      lifeMonths: getDefaultLifeMonths(category)
    };

    if (apiAvailable) {
      try {
        setFormBusy(inventoryForm, true);
        const state = await apiRequest('/api/inventory', {
          method: 'POST',
          body: JSON.stringify(item)
        });

        applyServerState(state);
        inventoryForm.reset();
        renderApp();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(inventoryForm, false);
      }

      return;
    }

    inventory.push(item);
    saveLocalData();
    inventoryForm.reset();
    renderApp();
    console.log('Inventory item saved:', item);
  });
}

if (supplierForm) {
  supplierForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const supplierPayload = {
      name: supplierNameInput?.value.trim() || '',
      contact: supplierContactInput?.value.trim() || '',
      email: supplierEmailInput?.value.trim() || '',
      phone: supplierPhoneInput?.value.trim() || '',
      website: supplierWebsiteInput?.value.trim() || '',
      category: supplierCategoryInput?.value.trim() || '',
      status: supplierStatusInput?.value || 'active',
      notes: supplierNotesInput?.value.trim() || ''
    };

    if (!supplierPayload.name) {
      alert('Enter supplier name');
      return;
    }

    if (apiAvailable) {
      try {
        setFormBusy(supplierForm, true);
        const state = await apiRequest('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify(supplierPayload)
        });

        applyServerState(state);
        supplierForm.reset();
        renderApp();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(supplierForm, false);
      }

      return;
    }

    suppliers.push(normalizeSupplier({
      id: Date.now(),
      ...supplierPayload,
      createdAt: new Date().toISOString()
    }));
    saveLocalData();
    supplierForm.reset();
    renderApp();
  });
}

if (supplierProductForm) {
  supplierProductForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const inventoryId = Number(supplierProductInventorySelect?.value);
    const supplierId = Number(supplierProductSupplierSelect?.value);
    const currentPrice = Number(supplierProductPriceInput?.value);
    const supplierSku = supplierProductSkuInput?.value.trim() || '';
    const notes = supplierProductNotesInput?.value.trim() || '';

    if (!inventoryId || !supplierId || !Number.isFinite(currentPrice)) {
      alert('Select inventory, supplier, and current price');
      return;
    }

    const payload = {
      inventoryId,
      supplierId,
      supplierSku,
      currentPrice,
      notes,
      status: 'active'
    };

    if (apiAvailable) {
      try {
        setFormBusy(supplierProductForm, true);
        const state = await apiRequest('/api/supplier-products', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        applyServerState(state);
        supplierProductForm.reset();
        renderApp();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(supplierProductForm, false);
      }

      return;
    }

    const item = getInventoryById(inventoryId);
    const supplier = getSupplierById(supplierId);
    const existing = supplierProducts.find(product => (
      Number(product.inventoryId) === inventoryId
      && Number(product.supplierId) === supplierId
      && String(product.supplierSku || '') === supplierSku
    ));

    if (existing) {
      existing.lastPrice = existing.currentPrice;
      existing.currentPrice = currentPrice;
      existing.variationPercent = existing.lastPrice
        ? ((currentPrice - existing.lastPrice) / existing.lastPrice) * 100
        : 0;
      existing.direction = existing.variationPercent > 0 ? 'up' : existing.variationPercent < 0 ? 'down' : 'flat';
      existing.notes = notes;
      existing.lastUpdatedAt = new Date().toISOString();
    } else {
      supplierProducts.push(normalizeSupplierProduct({
        id: Date.now(),
        inventoryId,
        supplierId,
        supplierName: supplier?.name || '',
        inventoryName: item?.name || '',
        inventoryCategory: item?.category || '',
        stock: item?.stock || 0,
        reorderLevel: item?.reorderLevel || 0,
        supplierSku,
        productName: item?.name || '',
        currentPrice,
        lastPrice: null,
        notes,
        status: 'active',
        lastUpdatedAt: new Date().toISOString()
      }));
    }

    priceHistory.unshift(normalizePriceHistoryEntry({
      id: Date.now(),
      supplierProductId: existing?.id || supplierProducts[supplierProducts.length - 1]?.id,
      supplierId,
      inventoryId,
      price: currentPrice,
      previousPrice: existing?.lastPrice ?? null,
      changedAt: new Date().toISOString(),
      source: 'manual',
      notes
    }));
    saveLocalData();
    supplierProductForm.reset();
    renderApp();
  });
}

if (purchaseOrderForm) {
  purchaseOrderForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const supplierId = Number(purchaseOrderSupplierSelect?.value);
    const supplierProductId = Number(purchaseOrderProductSelect?.value) || null;
    const supplierProduct = supplierProducts.find(product => Number(product.id) === supplierProductId);
    const quantity = Math.max(1, Number(purchaseOrderQuantityInput?.value) || 1);
    const payload = {
      supplierId,
      status: purchaseOrderStatusInput?.value || 'Draft',
      expectedDate: purchaseOrderExpectedDateInput?.value || null,
      notes: purchaseOrderNotesInput?.value.trim() || '',
      items: supplierProduct ? [{
        supplierProductId: supplierProduct.id,
        inventoryId: supplierProduct.inventoryId,
        quantity,
        unitPrice: supplierProduct.currentPrice
      }] : []
    };

    if (!supplierId) {
      alert('Select supplier for purchase order');
      return;
    }

    if (apiAvailable) {
      try {
        setFormBusy(purchaseOrderForm, true);
        const state = await apiRequest('/api/purchase-orders', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        applyServerState(state);
        purchaseOrderForm.reset();
        renderApp();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(purchaseOrderForm, false);
      }

      return;
    }

    const supplier = getSupplierById(supplierId);
    const lineTotal = supplierProduct ? quantity * Number(supplierProduct.currentPrice) : 0;

    purchaseOrders.unshift(normalizePurchaseOrder({
      id: Date.now(),
      supplierId,
      supplierName: supplier?.name || '',
      poNumber: `FC-PO-${String(Date.now()).slice(-8)}`,
      status: payload.status,
      expectedDate: payload.expectedDate,
      notes: payload.notes,
      totalAmount: lineTotal,
      createdAt: new Date().toISOString(),
      items: supplierProduct ? [{
        id: Date.now() + 1,
        purchaseOrderId: Date.now(),
        inventoryId: supplierProduct.inventoryId,
        supplierProductId: supplierProduct.id,
        inventoryName: supplierProduct.inventoryName || getInventoryById(supplierProduct.inventoryId)?.name || '',
        quantity,
        unitPrice: supplierProduct.currentPrice,
        lineTotal
      }] : []
    }));
    saveLocalData();
    purchaseOrderForm.reset();
    renderApp();
  });
}

if (maintenanceForm) {
  maintenanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const machineId = Number(document.querySelector('#maintenance-machine').value);
    const filterId = Number(document.querySelector('#maintenance-filter').value) || null;
    const type = document.querySelector('#maintenance-type').value;
    const date = document.querySelector('#maintenance-date').value;
    const notes = document.querySelector('#maintenance-notes').value;
    const replacementProductId = Number(document.querySelector('#maintenance-replacement-product')?.value) || null;
    const technicianName = maintenanceTechnicianNameInput?.value.trim() || '';
    const priority = maintenancePriorityInput?.value || '';
    const inspectionStatus = maintenanceInspectionStatusInput?.value || '';
    const nextDueDate = maintenanceNextDueDateInput?.value || null;
    const correctedPsiInput = document.querySelector('#maintenance-corrected-psi');
    const correctedPsi = correctedPsiInput && correctedPsiInput.value !== '' ? Number(correctedPsiInput.value) : null;
    const isReplacement = type.toLowerCase().includes('replace');

    if (!machineId) {
      alert('Select a valid machine');
      return;
    }

    if (!type || !date) {
      alert('Complete maintenance type and date');
      return;
    }

    if (isReplacement && !filterId) {
      alert('Select the current filter you are replacing');
      return;
    }

    if (isReplacement && !replacementProductId) {
      alert('Select the replacement filter product');
      return;
    }

    if (!isReplacement && correctedPsi !== null && !filterId) {
      alert('Select a filter before entering corrected PSI');
      return;
    }

    if (apiAvailable) {
      try {
        setFormBusy(maintenanceForm, true);
        const state = await apiRequest('/api/maintenance', {
          method: 'POST',
          body: JSON.stringify({
            machineId,
            filterId,
            type,
            date,
            notes,
            replacementProductId,
            correctedPsi,
            technicianName,
            priority,
            inspectionStatus,
            nextDueDate
          })
        });

        applyServerState(state);
        maintenanceForm.reset();
        renderApp();
        updateMaintenancePsiPreview();
        generateMaintenanceReport();
      } catch (error) {
        showSaveError(error);
      } finally {
        setFormBusy(maintenanceForm, false);
      }

      return;
    }

    const record = {
      id: Date.now(),
      machineId,
      filterId,
      type,
      date,
      notes,
      replacementProductId,
      technicianName,
      priority,
      inspectionStatus,
      nextDueDate,
      correctedPsi,
      createdAt: new Date().toISOString()
    };

    if (isReplacement) {
      const filter = filters.find(filter => filter.id === filterId);
      const replacementProduct = inventory.find(item => item.id === replacementProductId);

      if (!filter) {
        alert('Current filter not found');
        return;
      }

      if (!replacementProduct) {
        alert('Replacement product not found');
        return;
      }

      const replacementQuantity = Math.max(1, Number(filter.filterQuantity) || 1);

      if (Number(replacementProduct.stock) < replacementQuantity) {
        alert('No stock available for the selected replacement filter');
        return;
      }

      replacementProduct.stock = Number(replacementProduct.stock) - replacementQuantity;

      const replacementDate = date ? new Date(date) : new Date();
      const lifeMonths = Number(replacementProduct.lifeMonths || getDefaultLifeMonths(replacementProduct.category));
      const newDueDate = addMonths(replacementDate, lifeMonths);

      record.replacedFrom = filter.productName || 'Unknown filter';
      record.replacedWith = replacementProduct.name;

      filter.productId = replacementProduct.id;
      filter.productName = replacementProduct.name;
      filter.reorderNumber = replacementProduct.reorderNumber || '';
      filter.filterType = replacementProduct.filterType || replacementProduct.category || '';
      filter.vendorName = replacementProduct.vendorName || '';
      filter.cost = Number(replacementProduct.unitCost || 0);
      filter.lifeMonths = lifeMonths;
      filter.installedAt = replacementDate.toISOString();
      filter.dueDate = newDueDate.toISOString();
      filter.psi = null;
      filter.psiHistory = [];

      const usage = inventoryUsage.find(entry => Number(entry.inventoryId) === Number(replacementProduct.id));
      if (usage) {
        usage.totalUsed += replacementQuantity;
        usage.events += 1;
        usage.lastUsedAt = replacementDate.toISOString();
      } else {
        inventoryUsage.push({
          inventoryId: replacementProduct.id,
          totalUsed: replacementQuantity,
          events: 1,
          lastUsedAt: replacementDate.toISOString()
        });
      }

      saveLocalData();
    }

    if (!isReplacement && correctedPsi !== null) {
      const filter = filters.find(filter => filter.id === filterId);

      if (!filter) {
        alert('Filter not found for PSI correction');
        return;
      }

      record.previousPsi = filter.psi || filter.psi === 0 ? filter.psi : null;
      filter.psi = correctedPsi;

      if (!Array.isArray(filter.psiHistory)) {
        filter.psiHistory = [];
      }

      filter.psiHistory.push({
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        psi: correctedPsi,
        source: 'maintenance'
      });

      saveLocalData();
    }

    if (isReplacement && correctedPsi !== null && filterId) {
      const filter = filters.find(filter => filter.id === filterId);

      if (filter) {
        filter.psi = correctedPsi;
        filter.psiHistory = [
          {
            date: date ? new Date(date).toISOString() : new Date().toISOString(),
            psi: correctedPsi,
            source: 'replacement'
          }
        ];

        saveLocalData();
      }
    }

    maintenanceRecords.push(record);
    if (technicianName && !technicians.some(technician => technician.name.toLowerCase() === technicianName.toLowerCase())) {
      technicians.push({
        id: Date.now() + 1,
        name: technicianName,
        role: 'Technician',
        active: true,
        createdAt: new Date().toISOString()
      });
    }
    if (inspectionStatus || type.toLowerCase().includes('inspection') || type.toLowerCase().includes('review')) {
      inspections.push({
        id: Date.now() + 2,
        machineId,
        filterId,
        inspectionType: type,
        result: inspectionStatus,
        notes,
        psiReading: correctedPsi,
        inspectedAt: date ? new Date(date).toISOString() : new Date().toISOString()
      });
    }
    saveLocalData();
    maintenanceForm.reset();
    renderApp();
    updateMaintenancePsiPreview();
    generateMaintenanceReport();
  });
}

const setActiveNavById = (id) => {
  links.forEach(link => {
    const linkId = link.getAttribute('href').replace('#', '');
    link.classList.toggle('active', linkId === id);
  });
};

function openMachinesSection() {
  showSection('machines');
  setActiveNavById('machines');
  const machinesSection = document.querySelector('#machines');
  if (machinesSection) machinesSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openFiltersSection() {
  updateMachineOptions();
  updateInventoryOptions();
  updateMaintenanceOptions();
  syncFilterScheduleFields(true);

  showSection('filters');
  setActiveNavById('filters');

  const filtersSection = document.querySelector('#filters');
  if (filtersSection) {
    filtersSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const addMachineBtn = document.querySelector('#add-machine');

if (addMachineBtn) {
  addMachineBtn.addEventListener('click', openMachinesSection);
}

const addFilterBtn = document.querySelector('#add-filter');

if (addFilterBtn) {
  addFilterBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openFiltersSection();
  };
}

document.addEventListener('click', (e) => {
  const machineButton = e.target.closest('#add-machine');
  const filterButton = e.target.closest('#add-filter');

  if (machineButton) {
    e.preventDefault();
    e.stopPropagation();
    openMachinesSection();
  }

  if (filterButton) {
    e.preventDefault();
    e.stopPropagation();
    openFiltersSection();
  }
}, true);

if (smartSetupList) {
  smartSetupList.addEventListener('click', (e) => {
    const actionButton = e.target.closest('[data-setup-action]');

    if (!actionButton || actionButton.disabled) return;

    if (window.matchMedia('(max-width: 760px)').matches) {
      setSmartSetupOpen(false, true);
    }

    handleSmartSetupAction(actionButton.dataset.setupAction);
  });
}

if (smartSetupToggle) {
  smartSetupToggle.addEventListener('click', () => {
    setSmartSetupOpen(!setupState.widgetOpen, true);
  });
}

if (smartSetupClose) {
  smartSetupClose.addEventListener('click', () => {
    setSmartSetupOpen(false, true);
  });
}

document.addEventListener('focusin', (e) => {
  const isMobileView = window.matchMedia('(max-width: 760px)').matches;
  const isFormControl = e.target.matches('input, select, textarea');
  const isInsideSmartSetup = e.target.closest('#smart-setup-shell');

  if (isMobileView && isFormControl && !isInsideSmartSetup && setupState.widgetOpen) {
    setSmartSetupOpen(false);
  }
});

if (toggleAlertsBtn) {
  toggleAlertsBtn.addEventListener('click', () => {
    alertsExpanded = !alertsExpanded;
    toggleAlertsBtn.textContent = alertsExpanded ? 'Hide Alerts' : 'Show Alerts';
    renderRiskScore();
  });
}

if (archiveAllAlertsBtn) {
  archiveAllAlertsBtn.addEventListener('click', () => {
    archiveAllVisibleAlerts();
  });
}

if (openAlertsCard) {
  openAlertsCard.addEventListener('click', () => {
    openAlertsModal();
  });
}

if (closeAlertsModal) {
  closeAlertsModal.addEventListener('click', () => {
    closeAlertsModalWindow();
  });
}

if (closeAlertsModalFooter) {
  closeAlertsModalFooter.addEventListener('click', () => {
    closeAlertsModalWindow();
  });
}

if (alertsModal) {
  alertsModal.addEventListener('click', (e) => {
    if (e.target === alertsModal) {
      closeAlertsModalWindow();
    }
  });
}

if (archiveAllModalAlerts) {
  archiveAllModalAlerts.addEventListener('click', () => {
    archiveAllVisibleAlerts();
  });
}

if (closeMachineQRModal) {
  closeMachineQRModal.addEventListener('click', () => {
    closeMachineQRModalWindow();
  });
}

if (closeMachineQRModalFooter) {
  closeMachineQRModalFooter.addEventListener('click', () => {
    closeMachineQRModalWindow();
  });
}

if (machineQRModal) {
  machineQRModal.addEventListener('click', (e) => {
    if (e.target === machineQRModal) {
      closeMachineQRModalWindow();
    }
  });
}

if (printMachineQRBtn) {
  printMachineQRBtn.addEventListener('click', () => {
    printMachineQR();
  });
}

if (openManualCard) {
  openManualCard.addEventListener('click', () => {
    openManualModal();
  });
}

if (closeManualModal) {
  closeManualModal.addEventListener('click', () => {
    closeManualModalWindow();
  });
}

if (closeManualModalFooter) {
  closeManualModalFooter.addEventListener('click', () => {
    closeManualModalWindow();
  });
}

if (manualModal) {
  manualModal.addEventListener('click', (e) => {
    if (e.target === manualModal) {
      closeManualModalWindow();
    }
  });
}

async function initializeApp() {
  showSection('dashboard');
  setSmartSetupOpen(setupState.widgetOpen);
  updateAuthUI();

  if (authToken) {
    await loadRestaurantWorkspaces();
    if (getSelectedRestaurant()) {
      await loadServerData();
    } else {
      clearLocalOperationalData();
      updateAuthUI();
    }
  }

  renderApp();
}

initializeApp();
