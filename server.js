require('dotenv').config()

const path = require('path')
const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const QRCode = require('qrcode')
const XLSX = require('xlsx')
const { PDFParse } = require('pdf-parse')

const app = express()
const port = process.env.PORT || 3000
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('DATABASE_URL is required to start FiltraCore.')
  process.exit(1)
}

app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  next()
})
app.use(cors())
app.use(express.json({ limit: '12mb' }))

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl
    ? {
        rejectUnauthorized: false
      }
    : undefined
})

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

const passwordIterations = 210000
const passwordKeyLength = 64
const passwordDigest = 'sha512'
const sessionDays = toNumber(process.env.FILTRACORE_SESSION_DAYS, 30)
const defaultTenantSlug = 'default'
const publicBusinessTypes = new Set(['Restaurant', 'Hospitality', 'Casino', 'Retail', 'Warehouse', 'Other'])
const brainEmail = normalizeEmail(process.env.FILTRACORE_BRAIN_EMAIL || 'bastidasystems@gmail.com')
const westgateAccountEmail = normalizeEmail(process.env.WESTGATE_ACCOUNT_EMAIL || 'westgate@bastidasystems.io')
const stratAccountEmail = normalizeEmail(process.env.STRAT_ACCOUNT_EMAIL || 'strat01@bastidasystems.io')
const demoEmail = normalizeEmail(process.env.BASTIDA_DEMO_EMAIL || 'demo@bastidasystems.io')
const demoPassword = process.env.BASTIDA_DEMO_PASSWORD || 'LineOpsDemo1!'
const syncSecret = String(process.env.BASTIDA_SYNC_SECRET || '').trim()
const beoflowApiBaseURL = String(process.env.BEOFLOW_API_BASE_URL || '').trim().replace(/\/+$/, '')
const standardMachineLimit = 5
const unlimitedMachineClientEmails = new Set([stratAccountEmail, westgateAccountEmail, demoEmail])
const unifiedAccountAliases = new Map([
  ['bastida01', brainEmail],
  ['westgate', westgateAccountEmail],
  ['west@gmail.com', westgateAccountEmail],
  ['strat01', stratAccountEmail],
  ['armand01', stratAccountEmail],
  ['armando01', stratAccountEmail],
  ['ptslineops', stratAccountEmail],
  ['ptskitchen@lineops.io', stratAccountEmail],
  ['demo@filtracore.io', demoEmail],
  ['demo@lineops.io', demoEmail]
])

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null

  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function toDateString(value) {
  const date = value ? new Date(value) : new Date()

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().split('T')[0]
  }

  return date.toISOString().split('T')[0]
}

function addMonths(value, months) {
  const date = new Date(value)
  date.setMonth(date.getMonth() + Number(months || 0))
  return date.toISOString().split('T')[0]
}

function getDefaultLifeMonths(category) {
  const normalizedCategory = String(category || '').toLowerCase()

  if (normalizedCategory.includes('coffee')) return 3
  if (normalizedCategory.includes('ice')) return 6
  if (normalizedCategory.includes('soda')) return 4
  if (normalizedCategory.includes('water')) return 6

  return 6
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizeLoginIdentifier(value) {
  const login = normalizeEmail(value)
  return unifiedAccountAliases.get(login) || login
}

function normalizeSeedLogin(value) {
  const login = normalizeLoginIdentifier(value)
  return login
}

function accountIdentifierCandidates(value) {
  const raw = normalizeEmail(value)
  return [...new Set([normalizeLoginIdentifier(raw), raw].filter(Boolean))]
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function normalizeBusinessType(value) {
  const match = [...publicBusinessTypes].find(type => type.toLowerCase() === String(value || '').trim().toLowerCase())
  return match || 'Other'
}

function slugify(value) {
  return String(value || 'business')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'business'
}

function normalizeIdentityLabel(value) {
  return String(value || '').trim().slice(0, 80)
}

function normalizeLogoDataUrl(value) {
  const logo = String(value || '').trim()
  if (!logo) return ''

  if (logo.length > 1100000) {
    throw badRequest('Logo image must be under 800 KB')
  }

  if (!/^data:image\/(png|jpe?g);base64,[a-z0-9+/=\s]+$/i.test(logo)) {
    throw badRequest('Logo must be a PNG or JPG image')
  }

  return logo.replace(/^data:image\/jpg;/i, 'data:image/jpeg;')
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto
    .pbkdf2Sync(String(password), salt, passwordIterations, passwordKeyLength, passwordDigest)
    .toString('hex')

  return `pbkdf2:${passwordIterations}:${salt}:${hash}`
}

function verifyPassword(password, storedHash) {
  try {
    const [scheme, iterationsText, salt, expectedHash] = String(storedHash || '').split(':')

    if (scheme !== 'pbkdf2' || !iterationsText || !salt || !expectedHash) {
      return false
    }

    const expected = Buffer.from(expectedHash, 'hex')
    const actual = crypto.pbkdf2Sync(
      String(password),
      salt,
      toNumber(iterationsText),
      expected.length,
      passwordDigest
    )

    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch (error) {
    return false
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

function getBearerToken(req) {
  const authorization = req.get('authorization') || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

function mapAuthUser(row) {
  return {
    id: Number(row.user_id),
    email: row.email,
    name: row.name || '',
    role: row.role || 'user',
    tenantId: Number(row.tenant_id),
    tenantName: row.tenant_name || row.tenant || ''
  }
}

function isBrainUser(user) {
  return normalizeEmail(user?.email) === brainEmail || String(user?.role || '').toLowerCase() === 'superadmin'
}

function isUnlimitedMachineClient(email) {
  return unlimitedMachineClientEmails.has(normalizeLoginIdentifier(email))
}

function mapAdminUser(row) {
  return {
    id: Number(row.user_id),
    tenantId: Number(row.tenant_id),
    businessName: row.tenant_name || '',
    identityLabel: row.identity_label || '',
    logoDataUrl: row.logo_data_url || '',
    fullName: row.name || '',
    email: row.email || '',
    role: row.role || 'admin',
    machines: toNumber(row.machines_count),
    inventory: toNumber(row.inventory_count),
    filters: toNumber(row.filters_count),
    maintenanceRecords: toNumber(row.maintenance_count),
    createdAt: row.created_at,
    lastSessionAt: row.last_session_at
  }
}

function mapMachine(row) {
  return {
    id: Number(row.machine_id),
    facilityId: row.facility_id === null || row.facility_id === undefined ? null : Number(row.facility_id),
    name: row.name || '',
    type: row.type || '',
    category: row.category || row.type || '',
    location: row.location || '',
    department: row.department || '',
    brand: row.brand || '',
    model: row.model || '',
    serialNumber: row.serial_number || '',
    building: row.building || '',
    floor: row.floor || '',
    zone: row.zone || '',
    exactLocation: row.exact_location || row.location || '',
    assetId: row.asset_id || '',
    qrPayload: row.qr_payload || getMachineQRPayload(row.machine_id),
    healthStatus: row.health_status || 'Unknown',
    createdAt: row.created_at
  }
}

function getMachineQRPayload(machineId) {
  return `filtracore://machine/${machineId}`
}

function getMachineQRDisplayCode(machineId) {
  return `FC-M-${machineId}`
}

function mapInventory(row) {
  return {
    id: Number(row.inventory_id),
    name: row.name || '',
    category: row.category || '',
    reorderNumber: row.reorder_number || '',
    filterType: row.filter_type || row.category || '',
    vendorName: row.vendor_name || '',
    vendorContact: row.vendor_contact || '',
    stock: toNumber(row.stock),
    unitCost: toNumber(row.unit_cost),
    reorderLevel: toNumber(row.reorder_level),
    lifeMonths: toNumber(row.life_months, getDefaultLifeMonths(row.category)),
    createdAt: row.created_at
  }
}

function mapFilter(row, psiHistory = []) {
  const psi = toNullableNumber(row.psi)

  return {
    id: Number(row.filter_id),
    machineId: Number(row.machine_id),
    productId: row.inventory_id === null || row.inventory_id === undefined ? null : Number(row.inventory_id),
    productName: row.product_name || 'Filter',
    reorderNumber: row.reorder_number || row.product_reorder_number || '',
    filterType: row.filter_type || row.product_filter_type || row.product_category || '',
    filterQuantity: toNumber(row.filter_quantity, 1),
    psiMin: toNullableNumber(row.psi_min),
    psiMax: toNullableNumber(row.psi_max),
    vendorName: row.vendor_name || row.product_vendor_name || '',
    cost: toNumber(row.unit_cost),
    lifeMonths: toNumber(row.life_months, getDefaultLifeMonths(row.product_category)),
    psi,
    psiHistory,
    installedAt: row.installed_at,
    dueDate: row.due_date,
    status: row.status || 'Healthy',
    createdAt: row.created_at
  }
}

function mapMaintenance(row) {
  return {
    id: Number(row.maintenance_id),
    logId: row.log_id === null || row.log_id === undefined ? null : Number(row.log_id),
    machineId: Number(row.machine_id),
    filterId: row.filter_id === null || row.filter_id === undefined ? null : Number(row.filter_id),
    technicianId: row.technician_id === null || row.technician_id === undefined ? null : Number(row.technician_id),
    technicianName: row.technician_name || '',
    inspectionStatus: row.inspection_status || '',
    priority: row.priority || '',
    nextDueDate: row.next_due_date || null,
    type: row.maintenance_type || 'General',
    notes: row.notes || '',
    currentPsi: toNullableNumber(row.current_psi),
    previousPsi: toNullableNumber(row.current_psi),
    correctedPsi: toNullableNumber(row.corrected_psi),
    replacementProductId: row.replacement_product_id === null || row.replacement_product_id === undefined
      ? null
      : Number(row.replacement_product_id),
    replacedFrom: row.replaced_from || '',
    replacedWith: row.replaced_with || '',
    date: row.performed_at,
    createdAt: row.performed_at
  }
}

function mapFacility(row) {
  return {
    id: Number(row.facility_id),
    name: row.name || '',
    venueType: row.venue_type || '',
    building: row.building || '',
    address: row.address || '',
    createdAt: row.created_at
  }
}

function mapTechnician(row) {
  return {
    id: Number(row.technician_id),
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    role: row.role || 'Technician',
    active: row.active !== false,
    createdAt: row.created_at
  }
}

function mapInspection(row) {
  return {
    id: Number(row.inspection_id),
    machineId: row.machine_id === null || row.machine_id === undefined ? null : Number(row.machine_id),
    filterId: row.filter_id === null || row.filter_id === undefined ? null : Number(row.filter_id),
    technicianId: row.technician_id === null || row.technician_id === undefined ? null : Number(row.technician_id),
    inspectionType: row.inspection_type || 'General Inspection',
    result: row.result || '',
    notes: row.notes || '',
    psiReading: toNullableNumber(row.psi_reading),
    inspectedAt: row.inspected_at,
    createdAt: row.created_at
  }
}

function mapSupplier(row) {
  return {
    id: Number(row.supplier_id),
    name: row.name || '',
    contact: row.contact_name || '',
    email: row.email || '',
    phone: row.phone || '',
    website: row.website || '',
    category: row.category || '',
    notes: row.notes || '',
    status: row.status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapSupplierProduct(row) {
  const currentPrice = toNumber(row.current_price)
  const lastPrice = row.last_price === null || row.last_price === undefined ? null : toNumber(row.last_price)
  const variationPercent = lastPrice && lastPrice > 0
    ? ((currentPrice - lastPrice) / lastPrice) * 100
    : 0

  return {
    id: Number(row.supplier_product_id),
    supplierId: Number(row.supplier_id),
    inventoryId: Number(row.inventory_id),
    supplierName: row.supplier_name || '',
    inventoryName: row.inventory_name || '',
    inventoryCategory: row.inventory_category || '',
    stock: toNumber(row.stock),
    reorderLevel: toNumber(row.reorder_level),
    supplierSku: row.supplier_sku || '',
    productName: row.product_name || row.inventory_name || '',
    currentPrice,
    lastPrice,
    variationPercent,
    direction: variationPercent > 0 ? 'up' : variationPercent < 0 ? 'down' : 'flat',
    lastUpdatedAt: row.last_updated_at,
    notes: row.notes || '',
    status: row.status || 'active',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapPriceHistory(row) {
  return {
    id: Number(row.price_history_id),
    supplierProductId: Number(row.supplier_product_id),
    supplierId: Number(row.supplier_id),
    inventoryId: Number(row.inventory_id),
    price: toNumber(row.price),
    previousPrice: row.previous_price === null || row.previous_price === undefined ? null : toNumber(row.previous_price),
    changedAt: row.changed_at,
    source: row.source || '',
    notes: row.notes || ''
  }
}

function mapPurchaseOrder(row) {
  return {
    id: Number(row.purchase_order_id),
    supplierId: row.supplier_id === null || row.supplier_id === undefined ? null : Number(row.supplier_id),
    supplierName: row.supplier_name || '',
    poNumber: row.po_number || '',
    status: row.status || 'Draft',
    expectedDate: row.expected_date,
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    notes: row.notes || '',
    totalAmount: toNumber(row.total_amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: []
  }
}

function mapPurchaseOrderItem(row) {
  return {
    id: Number(row.purchase_order_item_id),
    purchaseOrderId: Number(row.purchase_order_id),
    inventoryId: row.inventory_id === null || row.inventory_id === undefined ? null : Number(row.inventory_id),
    supplierProductId: row.supplier_product_id === null || row.supplier_product_id === undefined ? null : Number(row.supplier_product_id),
    inventoryName: row.inventory_name || '',
    quantity: toNumber(row.quantity),
    unitPrice: toNumber(row.unit_price),
    lineTotal: toNumber(row.line_total),
    receivedQuantity: toNumber(row.received_quantity),
    notes: row.notes || ''
  }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      logo_data_url TEXT,
      identity_label TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      last_used_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_tenant_access (
      user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tenant_id)
    );

    CREATE TABLE IF NOT EXISTS facilities (
      facility_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      venue_type TEXT,
      building TEXT,
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS machines (
      machine_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      facility_id INTEGER REFERENCES facilities(facility_id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT,
      location TEXT NOT NULL,
      department TEXT,
      brand TEXT,
      model TEXT,
      serial_number TEXT,
      building TEXT,
      floor TEXT,
      zone TEXT,
      exact_location TEXT,
      asset_id TEXT,
      qr_payload TEXT,
      health_status TEXT DEFAULT 'Unknown',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory (
      inventory_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      reorder_number TEXT,
      filter_type TEXT,
      vendor_name TEXT,
      vendor_contact TEXT,
      stock INTEGER DEFAULT 0,
      unit_cost NUMERIC(10,2) DEFAULT 0,
      reorder_level INTEGER DEFAULT 0,
      life_months INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS filters (
      filter_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      machine_id INTEGER REFERENCES machines(machine_id) ON DELETE CASCADE,
      inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      psi INTEGER,
      psi_min INTEGER,
      psi_max INTEGER,
      filter_quantity INTEGER DEFAULT 1,
      vendor_name TEXT,
      life_months INTEGER NOT NULL,
      installed_at DATE NOT NULL,
      due_date DATE NOT NULL,
      status TEXT DEFAULT 'Healthy',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS technicians (
      technician_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      role TEXT DEFAULT 'Technician',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance (
      maintenance_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      machine_id INTEGER REFERENCES machines(machine_id) ON DELETE CASCADE,
      filter_id INTEGER REFERENCES filters(filter_id) ON DELETE SET NULL,
      technician_id INTEGER REFERENCES technicians(technician_id) ON DELETE SET NULL,
      technician_name TEXT,
      inspection_status TEXT,
      priority TEXT,
      next_due_date DATE,
      maintenance_type TEXT,
      notes TEXT,
      current_psi INTEGER,
      corrected_psi INTEGER,
      replacement_product_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      replaced_from TEXT,
      replaced_with TEXT,
      performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance_logs (
      log_id SERIAL PRIMARY KEY,
      legacy_maintenance_id INTEGER,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      machine_id INTEGER REFERENCES machines(machine_id) ON DELETE CASCADE,
      filter_id INTEGER REFERENCES filters(filter_id) ON DELETE SET NULL,
      technician_id INTEGER REFERENCES technicians(technician_id) ON DELETE SET NULL,
      technician_name TEXT,
      maintenance_type TEXT,
      priority TEXT,
      notes TEXT,
      current_psi INTEGER,
      corrected_psi INTEGER,
      replacement_product_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      replaced_from TEXT,
      replaced_with TEXT,
      performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      next_due_date DATE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inspections (
      inspection_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      machine_id INTEGER REFERENCES machines(machine_id) ON DELETE CASCADE,
      filter_id INTEGER REFERENCES filters(filter_id) ON DELETE SET NULL,
      technician_id INTEGER REFERENCES technicians(technician_id) ON DELETE SET NULL,
      inspection_type TEXT DEFAULT 'General Inspection',
      result TEXT,
      notes TEXT,
      psi_reading INTEGER,
      inspected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_usage (
      usage_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      machine_id INTEGER REFERENCES machines(machine_id) ON DELETE SET NULL,
      filter_id INTEGER REFERENCES filters(filter_id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      reason TEXT DEFAULT 'maintenance',
      used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      import_batch_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      source_name TEXT,
      source_type TEXT,
      detected_records INTEGER DEFAULT 0,
      applied_records INTEGER DEFAULT 0,
      ai_used BOOLEAN DEFAULT FALSE,
      warnings JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      website TEXT,
      category TEXT,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS supplier_products (
      supplier_product_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
      inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE CASCADE,
      supplier_sku TEXT,
      product_name TEXT,
      current_price NUMERIC(10,2) DEFAULT 0,
      last_price NUMERIC(10,2),
      last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      purchase_order_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
      po_number TEXT,
      status TEXT DEFAULT 'Draft',
      expected_date DATE,
      sent_at TIMESTAMP,
      received_at TIMESTAMP,
      notes TEXT,
      total_amount NUMERIC(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      purchase_order_item_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      purchase_order_id INTEGER REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE,
      inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      supplier_product_id INTEGER REFERENCES supplier_products(supplier_product_id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price NUMERIC(10,2) DEFAULT 0,
      line_total NUMERIC(10,2) DEFAULT 0,
      received_quantity INTEGER DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS price_history (
      price_history_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      supplier_product_id INTEGER REFERENCES supplier_products(supplier_product_id) ON DELETE CASCADE,
      supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
      inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      price NUMERIC(10,2) NOT NULL,
      previous_price NUMERIC(10,2),
      changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      source TEXT DEFAULT 'manual',
      notes TEXT
    );
  `)

  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data_url TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS identity_label TEXT;
    ALTER TABLE facilities ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE facilities ADD COLUMN IF NOT EXISTS venue_type TEXT;
    ALTER TABLE facilities ADD COLUMN IF NOT EXISTS building TEXT;
    ALTER TABLE facilities ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS facility_id INTEGER REFERENCES facilities(facility_id) ON DELETE SET NULL;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS serial_number TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS building TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS floor TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS zone TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS exact_location TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS qr_payload TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'Unknown';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reorder_number TEXT;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS filter_type TEXT;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS vendor_name TEXT;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS vendor_contact TEXT;
    ALTER TABLE filters ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE filters ADD COLUMN IF NOT EXISTS psi_min INTEGER;
    ALTER TABLE filters ADD COLUMN IF NOT EXISTS psi_max INTEGER;
    ALTER TABLE filters ADD COLUMN IF NOT EXISTS filter_quantity INTEGER DEFAULT 1;
    ALTER TABLE filters ADD COLUMN IF NOT EXISTS vendor_name TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS technician_id INTEGER REFERENCES technicians(technician_id) ON DELETE SET NULL;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS technician_name TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS inspection_status TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS priority TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS next_due_date DATE;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS life_months INTEGER;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replacement_product_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replaced_from TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replaced_with TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS supplier_sku TEXT;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS product_name TEXT;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS current_price NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS last_price NUMERIC(10,2);
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS last_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
    ALTER TABLE supplier_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number TEXT;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Draft';
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_date DATE;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMP;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_product_id INTEGER REFERENCES supplier_products(supplier_product_id) ON DELETE SET NULL;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS received_quantity INTEGER DEFAULT 0;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE price_history ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE price_history ADD COLUMN IF NOT EXISTS previous_price NUMERIC(10,2);
    ALTER TABLE price_history ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
    ALTER TABLE price_history ADD COLUMN IF NOT EXISTS notes TEXT;

    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS user_tenant_access_tenant_id_idx ON user_tenant_access(tenant_id);
    CREATE INDEX IF NOT EXISTS facilities_tenant_id_idx ON facilities(tenant_id);
    CREATE INDEX IF NOT EXISTS machines_tenant_id_idx ON machines(tenant_id);
    CREATE INDEX IF NOT EXISTS machines_facility_id_idx ON machines(facility_id);
    CREATE INDEX IF NOT EXISTS inventory_tenant_id_idx ON inventory(tenant_id);
    CREATE INDEX IF NOT EXISTS inventory_reorder_number_idx ON inventory(tenant_id, reorder_number);
    CREATE INDEX IF NOT EXISTS filters_tenant_id_idx ON filters(tenant_id);
    CREATE INDEX IF NOT EXISTS filters_machine_id_idx ON filters(machine_id);
    CREATE INDEX IF NOT EXISTS maintenance_tenant_id_idx ON maintenance(tenant_id);
    CREATE INDEX IF NOT EXISTS maintenance_logs_tenant_id_idx ON maintenance_logs(tenant_id);
    CREATE INDEX IF NOT EXISTS maintenance_logs_machine_id_idx ON maintenance_logs(machine_id);
    CREATE INDEX IF NOT EXISTS technicians_tenant_id_idx ON technicians(tenant_id);
    CREATE INDEX IF NOT EXISTS inspections_tenant_id_idx ON inspections(tenant_id);
    CREATE INDEX IF NOT EXISTS inspections_machine_id_idx ON inspections(machine_id);
    CREATE INDEX IF NOT EXISTS inventory_usage_tenant_id_idx ON inventory_usage(tenant_id);
    CREATE INDEX IF NOT EXISTS import_batches_tenant_id_idx ON import_batches(tenant_id);
    CREATE INDEX IF NOT EXISTS suppliers_tenant_id_idx ON suppliers(tenant_id);
    CREATE INDEX IF NOT EXISTS suppliers_status_idx ON suppliers(tenant_id, status);
    CREATE INDEX IF NOT EXISTS supplier_products_tenant_id_idx ON supplier_products(tenant_id);
    CREATE INDEX IF NOT EXISTS supplier_products_inventory_id_idx ON supplier_products(tenant_id, inventory_id);
    CREATE INDEX IF NOT EXISTS supplier_products_supplier_id_idx ON supplier_products(tenant_id, supplier_id);
    CREATE INDEX IF NOT EXISTS purchase_orders_tenant_id_idx ON purchase_orders(tenant_id);
    CREATE INDEX IF NOT EXISTS purchase_orders_supplier_id_idx ON purchase_orders(tenant_id, supplier_id);
    CREATE INDEX IF NOT EXISTS purchase_order_items_order_id_idx ON purchase_order_items(purchase_order_id);
    CREATE INDEX IF NOT EXISTS price_history_tenant_id_idx ON price_history(tenant_id);
    CREATE INDEX IF NOT EXISTS price_history_supplier_product_id_idx ON price_history(supplier_product_id);
  `)

  const tenantName = process.env.FILTRACORE_TENANT_NAME || 'FiltraCore Customer'
  const tenantResult = await pool.query(
    `
    INSERT INTO tenants (name, slug)
    VALUES ($1, $2)
    ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
    RETURNING tenant_id
    `,
    [tenantName, defaultTenantSlug]
  )
  const defaultTenantId = tenantResult.rows[0].tenant_id

  await pool.query('UPDATE machines SET tenant_id = $1 WHERE tenant_id IS NULL', [defaultTenantId])
  await pool.query('UPDATE inventory SET tenant_id = $1 WHERE tenant_id IS NULL', [defaultTenantId])
  await pool.query(
    `
    UPDATE filters
    SET tenant_id = machines.tenant_id
    FROM machines
    WHERE filters.machine_id = machines.machine_id
      AND filters.tenant_id IS NULL
    `
  )
  await pool.query('UPDATE filters SET tenant_id = $1 WHERE tenant_id IS NULL', [defaultTenantId])
  await pool.query(
    `
    UPDATE maintenance
    SET tenant_id = machines.tenant_id
    FROM machines
    WHERE maintenance.machine_id = machines.machine_id
      AND maintenance.tenant_id IS NULL
    `
  )
  await pool.query('UPDATE maintenance SET tenant_id = $1 WHERE tenant_id IS NULL', [defaultTenantId])

  await pool.query(`
    UPDATE machines
    SET
      category = COALESCE(category, type),
      exact_location = COALESCE(exact_location, location),
      qr_payload = COALESCE(qr_payload, 'filtracore://machine/' || machine_id::text),
      health_status = COALESCE(health_status, 'Unknown')
    WHERE tenant_id IS NOT NULL;

    UPDATE inventory
    SET filter_type = COALESCE(filter_type, category)
    WHERE tenant_id IS NOT NULL;

    UPDATE filters
    SET filter_quantity = COALESCE(filter_quantity, 1)
    WHERE tenant_id IS NOT NULL;

    INSERT INTO maintenance_logs
    (
      legacy_maintenance_id,
      tenant_id,
      machine_id,
      filter_id,
      technician_id,
      technician_name,
      maintenance_type,
      priority,
      notes,
      current_psi,
      corrected_psi,
      replacement_product_id,
      replaced_from,
      replaced_with,
      performed_at,
      next_due_date
    )
    SELECT
      maintenance.maintenance_id,
      maintenance.tenant_id,
      maintenance.machine_id,
      maintenance.filter_id,
      maintenance.technician_id,
      maintenance.technician_name,
      maintenance.maintenance_type,
      maintenance.priority,
      maintenance.notes,
      maintenance.current_psi,
      maintenance.corrected_psi,
      maintenance.replacement_product_id,
      maintenance.replaced_from,
      maintenance.replaced_with,
      maintenance.performed_at,
      maintenance.next_due_date
    FROM maintenance
    WHERE NOT EXISTS (
      SELECT 1
      FROM maintenance_logs
      WHERE maintenance_logs.legacy_maintenance_id = maintenance.maintenance_id
    );
  `)

  await pool.query(`
    ALTER TABLE machines ALTER COLUMN tenant_id SET NOT NULL;
    ALTER TABLE inventory ALTER COLUMN tenant_id SET NOT NULL;
    ALTER TABLE filters ALTER COLUMN tenant_id SET NOT NULL;
    ALTER TABLE maintenance ALTER COLUMN tenant_id SET NOT NULL;
  `)

  await pool.query(`
    INSERT INTO user_tenant_access (user_id, tenant_id, role)
    SELECT user_id, tenant_id, role
    FROM users
    ON CONFLICT (user_id, tenant_id) DO NOTHING
  `)

  await migrateLegacyStratLogin()
  await seedAdminUser(defaultTenantId)
  await seedCanonicalClientUsers()
  await seedDemoUser()
  await seedBrainUser()
}

async function seedAdminUser(defaultTenantId) {
  const email = normalizeSeedLogin(process.env.FILTRACORE_ADMIN_USERNAME || process.env.FILTRACORE_ADMIN_EMAIL)
  const password = process.env.FILTRACORE_ADMIN_PASSWORD
  const name = process.env.FILTRACORE_ADMIN_NAME || (email === 'strat01' ? 'Strat01' : 'FiltraCore Admin')

  if (!email || !password) {
    console.warn('FILTRACORE_ADMIN_USERNAME or FILTRACORE_ADMIN_EMAIL plus FILTRACORE_ADMIN_PASSWORD are not set. No admin user was seeded.')
    return
  }

  const existing = await pool.query('SELECT user_id FROM users WHERE email = $1', [email])

  if (existing.rowCount === 0) {
    await pool.query(
      `
      INSERT INTO users (tenant_id, email, name, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [defaultTenantId, email, name, hashPassword(password), 'admin']
    )
    return
  }

  if (process.env.FILTRACORE_RESET_ADMIN_PASSWORD === 'true') {
    await pool.query(
      `
      UPDATE users
      SET password_hash = $1,
          name = $2,
          tenant_id = $3
      WHERE email = $4
      `,
      [hashPassword(password), name, defaultTenantId, email]
    )
  }
}

async function migrateLegacyStratLogin() {
  const target = await pool.query(
    'SELECT user_id, tenant_id FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [stratAccountEmail]
  )
  const legacy = await pool.query(
    `
    SELECT user_id, tenant_id
    FROM users
    WHERE LOWER(email) IN ('strat01', 'armand01', 'armando01', 'ptslineops', 'ptskitchen@lineops.io')
    ORDER BY created_at ASC
    `
  )

  if (target.rowCount > 0) {
    for (const user of legacy.rows) {
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.user_id])
      await pool.query('DELETE FROM users WHERE user_id = $1', [user.user_id])
    }
    await pool.query('UPDATE tenants SET name = $1, identity_label = $2 WHERE tenant_id = $3', ['PTS Sport and Wings', 'Strat', Number(target.rows[0].tenant_id)])
    return
  }

  if (legacy.rowCount === 0) return

  const user = legacy.rows[0]
  await pool.query(
    'UPDATE users SET email = $1, name = $2 WHERE user_id = $3',
    [stratAccountEmail, 'Strat Admin', user.user_id]
  )
  await pool.query('UPDATE tenants SET name = $1, identity_label = $2 WHERE tenant_id = $3', ['PTS Sport and Wings', 'Strat', Number(user.tenant_id)])
}

async function ensureUniqueTenantSlug(db, businessName) {
  const baseSlug = slugify(businessName)
  let slug = baseSlug
  let suffix = 2

  while (true) {
    const existing = await db.query('SELECT tenant_id FROM tenants WHERE slug = $1 LIMIT 1', [slug])
    if (existing.rowCount === 0) return slug

    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
}

const waterfilterSetupSourceName = 'Waterfilters setup sheet'
const waterfilterSetupRecords = [
  { venue: "PT'S", machine: 'Ice Machine', reorderNumber: '300-05830', filterType: 'PENTAIR EVERPURE', quantity: 3, category: 'Ice Machine' },
  { venue: "PT'S", machine: 'STEAMER', reorderNumber: '300-05829', filterType: 'PENTAIR EVERPURE', quantity: 1, category: 'Steamer' },
  { venue: "PT'S", machine: 'STEAMER', reorderNumber: 'AR-1000-P', filterType: 'ARTIC PURE+', quantity: 1, category: 'Steamer' },
  { venue: "PT'S", machine: 'BACK SIDE STATION', reorderNumber: '300-05835', filterType: 'OPTIC PURE', quantity: 2, category: 'Water Station' },
  { venue: "PT'S", machine: 'FRONT SIDE STATION', reorderNumber: '300-05835', filterType: 'PENTAIR EVERPURE', quantity: 1, category: 'Water Station' },
  { venue: 'SWIM AND SOCIAL', machine: 'Ice Machine', reorderNumber: 'EV9612-22', filterType: 'PENTAIR EVERPURE', quantity: 2, category: 'Ice Machine' },
  { venue: 'SWIM AND SOCIAL', machine: 'Soda Machine', reorderNumber: 'AR-4000-P', filterType: 'ARTIC PURE+', quantity: 1, category: 'Soda Machine' },
  { venue: 'CHI', machine: 'Ice Machine', reorderNumber: 'EV9612-32', filterType: 'PENTAIR EVERPURE', quantity: 3, category: 'Ice Machine' },
  { venue: 'CHI', machine: 'Soda Machine', reorderNumber: 'AR-4000-P', filterType: 'ARTIC PURE+', quantity: 1, category: 'Soda Machine' },
  { venue: 'CHI', machine: 'Tea Machine', reorderNumber: 'EV9613-21', filterType: 'PENTAIR EVERPURE', quantity: 2, category: 'Tea Machine' },
  { venue: 'CHI', machine: 'STEAMER', reorderNumber: 'EV9618-21', filterType: 'PENTAIR EVERPURE', quantity: 4, category: 'Steamer' },
  { venue: 'CAFE', machine: 'Ice Machine', reorderNumber: 'EV9612-32', filterType: 'PENTAIR EVERPURE', quantity: 2, category: 'Ice Machine' },
  { venue: 'CAFE', machine: 'STEAMER', reorderNumber: 'EV9618-21', filterType: 'PENTAIR EVERPURE', quantity: 2, category: 'Steamer' },
  { venue: 'EDR', machine: 'STEAMER', reorderNumber: '2915145', filterType: 'PURE WATER', quantity: 1, category: 'Steamer' },
  { venue: 'EDR', machine: 'Ice Machine', reorderNumber: 'EV9781-12', filterType: 'PENTAIR EVERPURE', quantity: 4, category: 'Ice Machine' },
  { venue: 'STARBUCKS', machine: 'Ice Machine', reorderNumber: 'B-361123', filterType: 'Ice-O-Matic', quantity: 2, category: 'Ice Machine' },
  { venue: 'NAGA', machine: 'Ice Machine', reorderNumber: 'EV9612-22', filterType: 'PENTAIR EVERPURE', quantity: 1, category: 'Ice Machine' },
  { venue: "McCall's Bar", machine: 'Coffee Machine', reorderNumber: 'HF25-S', filterType: '3M High Flow', quantity: 2, category: 'Coffee Machine', exactLocation: 'Side station' },
  { venue: "McCall's Bar", machine: 'Ice Machine', reorderNumber: 'EV9781-12', filterType: 'PENTAIR EVERPURE', quantity: 2, category: 'Ice Machine' },
  { venue: "McCall's Bar", machine: 'Ice Machine', reorderNumber: '4622-10', filterType: 'EVERPURE CU-S', quantity: 2, category: 'Ice Machine' },
  { venue: "McCall's Buffet", machine: 'Ice Machine', reorderNumber: 'EFS8002', filterType: 'EVERPURE CU-S', quantity: 4, category: 'Ice Machine' },
  { venue: "McCall's Buffet", machine: 'Ice Machine', reorderNumber: 'EV9612-22', filterType: 'PENTAIR EVERPURE', quantity: 1, category: 'Ice Machine' },
  { venue: 'Tower 105', machine: 'Ice Machine', reorderNumber: 'EV9781-12', filterType: 'PENTAIR EVERPURE', quantity: 3, category: 'Ice Machine' },
  { venue: 'Tower 104', machine: 'Ice Machine', reorderNumber: '4622-10', filterType: 'EVERPURE CU-S', quantity: 2, category: 'Ice Machine' },
  { venue: 'Broadway Bar', machine: 'Ice Machine', reorderNumber: 'EV9781-12', filterType: 'PENTAIR EVERPURE', quantity: 4, category: 'Ice Machine' }
]

async function removeStarterSampleData(db, tenantId) {
  await db.query(
    `
    DELETE FROM machines
    WHERE tenant_id = $1
      AND asset_id = ANY($2::text[])
    `,
    [
      tenantId,
      [
        'FC-ICE-001',
        'FC-COF-002',
        'FC-SODA-003',
        'STRAT-BAK-OVEN-01',
        'STRAT-BAK-OVEN-02',
        'STRAT-BEV-SODA-01',
        'STRAT-BEV-ICE-01',
        'STRAT-BEV-TEA-01',
        'STRAT-BEV-SODA-02'
      ]
    ]
  )

  await db.query(
    `
    DELETE FROM inventory
    WHERE tenant_id = $1
      AND name = ANY($2::text[])
    `,
    [
      tenantId,
      [
        'Carbon Block 10"',
        'Scale Control Cartridge',
        'Sediment Pre-filter',
        'High Flow Beverage Cartridge',
        '3M ICE120-S Ice Machine Cartridge',
        'Pentair Everpure 4FC-S Fountain Filter',
        'Bunn EQHP-10L Coffee Water Filter',
        'Pentair Everpure EV979902 Prep Water Filter'
      ]
    ]
  )
}

function groupWaterfilterRecordsByVenue() {
  return waterfilterSetupRecords.reduce((groups, record) => {
    const venue = record.venue
    const current = groups.get(venue) || []
    current.push(record)
    groups.set(venue, current)
    return groups
  }, new Map())
}

async function clearTenantOperationalData(db, tenantId) {
  await db.query('DELETE FROM price_history WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM purchase_order_items WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM purchase_orders WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM supplier_products WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM suppliers WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM import_batches WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM inspections WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM maintenance_logs WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM maintenance WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM inventory_usage WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM filters WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM machines WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM inventory WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM facilities WHERE tenant_id = $1', [tenantId])
  await db.query('DELETE FROM technicians WHERE tenant_id = $1', [tenantId])
}

const supplierSeedProfiles = [
  {
    name: 'Sysco',
    contactName: 'Procurement Desk',
    email: 'orders@sysco.example',
    phone: '(702) 555-0140',
    website: 'https://www.sysco.com',
    category: 'Foodservice Distributor',
    notes: 'Primary broadline distributor for restaurant and facility supplies.',
    multiplier: 1,
    previousMultiplier: 0.96,
    skuSuffix: 'SYS'
  },
  {
    name: 'Restaurant Depot',
    contactName: 'Will Call',
    email: 'commercial@restaurantdepot.example',
    phone: '(702) 555-0188',
    website: 'https://www.restaurantdepot.com',
    category: 'Cash and Carry',
    notes: 'Useful benchmark supplier for lower unit pricing and urgent pickup.',
    multiplier: 0.93,
    previousMultiplier: 0.95,
    skuSuffix: 'RD'
  },
  {
    name: 'Amazon Business',
    contactName: 'Business Support',
    email: 'business-support@amazon.example',
    phone: '(888) 555-0199',
    website: 'https://business.amazon.com',
    category: 'Marketplace',
    notes: 'Fallback marketplace supplier for availability checks and spot buys.',
    multiplier: 1.14,
    previousMultiplier: 1.09,
    skuSuffix: 'AMZ'
  }
]

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function estimateSupplierBasePrice(item) {
  const unitCost = toNumber(item.unit_cost)
  if (unitCost > 0) return unitCost

  const text = [item.name, item.category, item.filter_type, item.reorder_number].join(' ').toLowerCase()

  if (text.includes('3m') || text.includes('coffee')) return 34
  if (text.includes('steamer') || text.includes('steam')) return 47
  if (text.includes('soda') || text.includes('ar-4000')) return 39
  if (text.includes('cu-s') || text.includes('4622')) return 31
  if (text.includes('ice-o-matic') || text.includes('b-361123')) return 52
  if (text.includes('everpure') || text.includes('pentair')) return 43

  return 36
}

async function ensureSupplierSeedData(db, tenantId) {
  const existing = await db.query('SELECT supplier_id FROM suppliers WHERE tenant_id = $1 LIMIT 1', [tenantId])
  if (existing.rowCount > 0) return

  const inventoryResult = await db.query(
    'SELECT * FROM inventory WHERE tenant_id = $1 ORDER BY inventory_id ASC',
    [tenantId]
  )

  if (inventoryResult.rowCount === 0) return

  const supplierIds = new Map()

  for (const supplier of supplierSeedProfiles) {
    const created = await db.query(
      `
      INSERT INTO suppliers
      (
        tenant_id,
        name,
        contact_name,
        email,
        phone,
        website,
        category,
        notes,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
      RETURNING supplier_id
      `,
      [
        tenantId,
        supplier.name,
        supplier.contactName,
        supplier.email,
        supplier.phone,
        supplier.website,
        supplier.category,
        supplier.notes
      ]
    )

    supplierIds.set(supplier.name, Number(created.rows[0].supplier_id))
  }

  for (const item of inventoryResult.rows) {
    const basePrice = estimateSupplierBasePrice(item)
    const reorderNumber = item.reorder_number || `INV-${item.inventory_id}`

    for (const supplier of supplierSeedProfiles) {
      const currentPrice = roundCurrency(basePrice * supplier.multiplier)
      const previousPrice = roundCurrency(basePrice * supplier.previousMultiplier)
      const supplierId = supplierIds.get(supplier.name)
      const productResult = await db.query(
        `
        INSERT INTO supplier_products
        (
          tenant_id,
          supplier_id,
          inventory_id,
          supplier_sku,
          product_name,
          current_price,
          last_price,
          last_updated_at,
          notes,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, $8, 'active')
        RETURNING supplier_product_id
        `,
        [
          tenantId,
          supplierId,
          item.inventory_id,
          `${reorderNumber}-${supplier.skuSuffix}`,
          item.name,
          currentPrice,
          previousPrice,
          `Demo estimated supplier price for ${item.name}; replace with a real quote or supplier feed before purchasing.`
        ]
      )

      await db.query(
        `
        INSERT INTO price_history
        (
          tenant_id,
          supplier_product_id,
          supplier_id,
          inventory_id,
          price,
          previous_price,
          source,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'seed', $7)
        `,
        [
          tenantId,
          productResult.rows[0].supplier_product_id,
          supplierId,
          item.inventory_id,
          currentPrice,
          previousPrice,
          `Demo procurement baseline for ${supplier.name}; not live supplier pricing.`
        ]
      )
    }
  }
}

async function findLinkedTenantByName(db, userId, name) {
  const result = await db.query(
    `
    SELECT tenants.tenant_id
    FROM user_tenant_access
    INNER JOIN tenants ON tenants.tenant_id = user_tenant_access.tenant_id
    WHERE user_tenant_access.user_id = $1
      AND LOWER(tenants.name) = LOWER($2)
    LIMIT 1
    `,
    [userId, name]
  )

  return result.rowCount > 0 ? Number(result.rows[0].tenant_id) : null
}

async function createLinkedTenant(db, userId, name, identityLabel = 'Strat') {
  const slug = await ensureUniqueTenantSlug(db, name)
  const tenantResult = await db.query(
    `
    INSERT INTO tenants (name, slug, identity_label)
    VALUES ($1, $2, $3)
    RETURNING tenant_id
    `,
    [name, slug, identityLabel]
  )
  const tenantId = Number(tenantResult.rows[0].tenant_id)

  await db.query(
    `
    INSERT INTO user_tenant_access (user_id, tenant_id, role)
    VALUES ($1, $2, 'admin')
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
    `,
    [userId, tenantId]
  )

  return tenantId
}

async function removeLegacyStratAggregateWorkspaces(db, userId) {
  const legacyResult = await db.query(
    `
    SELECT tenants.tenant_id
    FROM user_tenant_access
    INNER JOIN tenants ON tenants.tenant_id = user_tenant_access.tenant_id
    WHERE user_tenant_access.user_id = $1
      AND LOWER(tenants.name) = ANY($2::text[])
    `,
    [userId, ['mccalls']]
  )

  for (const row of legacyResult.rows) {
    await db.query('DELETE FROM tenants WHERE tenant_id = $1', [Number(row.tenant_id)])
  }
}

async function ensureWaterfilterRestaurantWorkspaces(db, userId, homeTenantId) {
  if (!userId || !homeTenantId) return

  const venueGroups = groupWaterfilterRecordsByVenue()
  await removeLegacyStratAggregateWorkspaces(db, userId)

  for (const [venue, records] of venueGroups.entries()) {
    const isHomeVenue = venue === "PT'S"
    let tenantId = isHomeVenue ? Number(homeTenantId) : await findLinkedTenantByName(db, userId, venue)

    if (!tenantId) {
      tenantId = await createLinkedTenant(db, userId, venue, 'Strat')
    } else {
      await db.query(
        'UPDATE tenants SET name = $1, identity_label = $2 WHERE tenant_id = $3',
        [venue, 'Strat', tenantId]
      )
      await db.query(
        `
        INSERT INTO user_tenant_access (user_id, tenant_id, role)
        VALUES ($1, $2, 'admin')
        ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
        `,
        [userId, tenantId]
      )
    }

    const sourceName = `${waterfilterSetupSourceName}: ${venue}`
    const existingBatch = await db.query(
      'SELECT import_batch_id FROM import_batches WHERE tenant_id = $1 AND source_name = $2 LIMIT 1',
      [tenantId, sourceName]
    )

    if (existingBatch.rowCount > 0) {
      await ensureSupplierSeedData(db, tenantId)
      continue
    }

    await clearTenantOperationalData(db, tenantId)
    await applyImportRecords(
      { tenantId },
      records,
      {
        sourceName,
        sourceType: 'seed/waterfilters-photo',
        aiUsed: false,
        warnings: []
      },
      { bypassMachineLimit: true }
    )
    await ensureSupplierSeedData(db, tenantId)
  }
}

async function seedSampleTenantData(db, tenantId, businessName = 'FiltraCore Demo') {
  const existing = await db.query('SELECT machine_id FROM machines WHERE tenant_id = $1 LIMIT 1', [tenantId])
  if (existing.rowCount > 0) return

  const machineRows = [
    ['Main Kitchen Ice Machine', 'Ice Machine', 'Kitchen Line', 'Culinary', 'Manitowoc', 'IYT0450A', 'FC-ICE-001'],
    ['Coffee Bar Brewer', 'Coffee Brewer', 'Cafe Station', 'Beverage', 'Bunn', 'ICB Twin', 'FC-COF-002'],
    ['Soda Fountain Bank', 'Beverage System', 'Service Bar', 'Front of House', 'Cornelius', 'Viper', 'FC-SODA-003']
  ]
  const machineIds = []

  for (const row of machineRows) {
    const result = await db.query(
      `
      INSERT INTO machines (tenant_id, name, type, location, department, brand, model, asset_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING machine_id
      `,
      [tenantId, ...row]
    )
    machineIds.push(Number(result.rows[0].machine_id))
  }

  const inventoryRows = [
    ['Carbon Block 10"', 'Ice Machine Filter', 8, 42.5, 3, 6],
    ['Scale Control Cartridge', 'Coffee Filter', 5, 36, 2, 3],
    ['Sediment Pre-filter', 'Water System Filter', 12, 18.75, 4, 6],
    ['High Flow Beverage Cartridge', 'Soda Filter', 6, 54, 2, 4]
  ]
  const inventoryIds = []

  for (const row of inventoryRows) {
    const result = await db.query(
      `
      INSERT INTO inventory (tenant_id, name, category, stock, unit_cost, reorder_level, life_months)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING inventory_id
      `,
      [tenantId, ...row]
    )
    inventoryIds.push(Number(result.rows[0].inventory_id))
  }

  const today = new Date()
  const installed60DaysAgo = new Date(today)
  installed60DaysAgo.setDate(today.getDate() - 60)
  const installed95DaysAgo = new Date(today)
  installed95DaysAgo.setDate(today.getDate() - 95)

  const filterRows = [
    [machineIds[0], inventoryIds[0], 62, 6, installed60DaysAgo],
    [machineIds[1], inventoryIds[1], 47, 3, installed95DaysAgo],
    [machineIds[2], inventoryIds[3], 58, 4, installed60DaysAgo]
  ]
  const filterIds = []

  for (const [machineId, inventoryId, psi, lifeMonths, installedDate] of filterRows) {
    const installedAt = toDateString(installedDate)
    const result = await db.query(
      `
      INSERT INTO filters (tenant_id, machine_id, inventory_id, psi, life_months, installed_at, due_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING filter_id
      `,
      [tenantId, machineId, inventoryId, psi, lifeMonths, installedAt, addMonths(installedAt, lifeMonths)]
    )
    filterIds.push(Number(result.rows[0].filter_id))

    await db.query(
      'UPDATE inventory SET stock = GREATEST(stock - 1, 0) WHERE inventory_id = $1 AND tenant_id = $2',
      [inventoryId, tenantId]
    )
  }

  await db.query(
    `
    INSERT INTO maintenance (tenant_id, machine_id, filter_id, maintenance_type, notes, current_psi, corrected_psi, performed_at)
    VALUES
      ($1, $2, $3, 'PSI Inspection', $4, 44, 47, NOW() - INTERVAL '7 days'),
      ($1, $5, $6, 'Preventive Check', $7, 59, 62, NOW() - INTERVAL '14 days')
    `,
    [
      tenantId,
      machineIds[1],
      filterIds[1],
      `${businessName} coffee station PSI corrected after inspection.`,
      machineIds[0],
      filterIds[0],
      'Routine ice machine filter check completed.'
    ]
  )
}

async function createPublicAccount({
  businessName,
  fullName,
  email,
  password,
  businessType,
  allowUsername = false,
  minimumPasswordLength = 8,
  role = 'admin',
  createSessionToken = true,
  logoDataUrl,
  identityLabel
}) {
  const cleanBusinessName = String(businessName || '').trim()
  const cleanFullName = String(fullName || '').trim()
  const cleanEmail = normalizeLoginIdentifier(email)
  const cleanPassword = String(password || '')
  const normalizedBusinessType = normalizeBusinessType(businessType)
  const cleanLogoDataUrl = normalizeLogoDataUrl(logoDataUrl)
  const cleanIdentityLabel = normalizeIdentityLabel(identityLabel)

  if (!cleanBusinessName || !cleanFullName || !cleanEmail || (!allowUsername && !isValidEmail(cleanEmail))) {
    throw badRequest(allowUsername
      ? 'Business name, owner name, and login are required'
      : 'Business name, full name, and a valid email are required')
  }

  if (cleanPassword.length < minimumPasswordLength) {
    throw badRequest(`Password must be at least ${minimumPasswordLength} characters`)
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const duplicate = await client.query('SELECT user_id FROM users WHERE email = $1 LIMIT 1', [cleanEmail])
    if (duplicate.rowCount > 0) {
      throw badRequest('An account already exists for this email')
    }

    const slug = await ensureUniqueTenantSlug(client, cleanBusinessName)
    const tenantResult = await client.query(
      `
      INSERT INTO tenants (name, slug, logo_data_url, identity_label)
      VALUES ($1, $2, $3, $4)
      RETURNING tenant_id, name AS tenant_name
      `,
      [cleanBusinessName, slug, cleanLogoDataUrl || null, cleanIdentityLabel || null]
    )
    const tenantId = Number(tenantResult.rows[0].tenant_id)

    const userResult = await client.query(
      `
      INSERT INTO users (tenant_id, email, name, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING user_id, tenant_id, email, name, role
      `,
      [tenantId, cleanEmail, cleanFullName, hashPassword(cleanPassword), role]
    )

    await client.query(
      `
      INSERT INTO user_tenant_access (user_id, tenant_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, tenant_id) DO NOTHING
      `,
      [userResult.rows[0].user_id, tenantId, role]
    )

    await seedSampleTenantData(client, tenantId, cleanBusinessName)
    await client.query('COMMIT')

    const user = {
      ...userResult.rows[0],
      tenant_name: tenantResult.rows[0].tenant_name,
      business_type: normalizedBusinessType
    }
    const token = createSessionToken ? await createSession(user.user_id) : ''

    return {
      token,
      user: mapAuthUser(user)
    }
  } catch (error) {
    await client.query('ROLLBACK')

    if (error.code === '23505') {
      throw badRequest('An account already exists for this email')
    }

    throw error
  } finally {
    client.release()
  }
}

async function createRestaurantWorkspaceForAccount({
  businessName,
  fullName,
  email,
  password,
  businessType,
  role = 'admin',
  logoDataUrl,
  identityLabel
}) {
  const cleanEmail = normalizeLoginIdentifier(email)
  const cleanBusinessName = String(businessName || '').trim()
  const cleanFullName = String(fullName || '').trim()
  const cleanPassword = String(password || '')
  const cleanLogoDataUrl = normalizeLogoDataUrl(logoDataUrl)
  const cleanIdentityLabel = normalizeIdentityLabel(identityLabel)

  if (!cleanBusinessName || !cleanFullName || !cleanEmail || !isValidEmail(cleanEmail)) {
    throw badRequest('Business name, owner name, and a valid account email are required')
  }

  const existing = await pool.query(
    'SELECT user_id, email, name, role FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [cleanEmail]
  )

  if (existing.rowCount === 0) {
    return createPublicAccount({
      businessName: cleanBusinessName,
      fullName: cleanFullName,
      email: cleanEmail,
      password: cleanPassword,
      businessType,
      role,
      allowUsername: false,
      minimumPasswordLength: 6,
      createSessionToken: false,
      logoDataUrl: cleanLogoDataUrl,
      identityLabel: cleanIdentityLabel
    })
  }

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const slug = await ensureUniqueTenantSlug(client, cleanBusinessName)
    const tenantResult = await client.query(
      `
      INSERT INTO tenants (name, slug, logo_data_url, identity_label)
      VALUES ($1, $2, $3, $4)
      RETURNING tenant_id, name AS tenant_name
      `,
      [cleanBusinessName, slug, cleanLogoDataUrl || null, cleanIdentityLabel || null]
    )
    const tenantId = Number(tenantResult.rows[0].tenant_id)
    const user = existing.rows[0]

    await client.query(
      'UPDATE users SET name = $1 WHERE user_id = $2',
      [cleanFullName, user.user_id]
    )
    await client.query(
      `
      INSERT INTO user_tenant_access (user_id, tenant_id, role)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
      `,
      [user.user_id, tenantId, role]
    )
    await seedSampleTenantData(client, tenantId, cleanBusinessName)
    await client.query('COMMIT')

    return {
      token: '',
      existingUser: true,
      user: mapAuthUser({
        user_id: user.user_id,
        tenant_id: tenantId,
        email: user.email,
        name: cleanFullName,
        role,
        tenant_name: tenantResult.rows[0].tenant_name
      })
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function canonicalClientAccounts() {
  return [
    {
      email: stratAccountEmail,
      password: process.env.STRAT_ACCOUNT_PASSWORD || 'Strat01',
      businessName: 'PTS Sport and Wings',
      fullName: 'Strat Admin',
      businessType: 'Restaurant',
      identityLabel: 'Strat',
      candidates: ['strat01', 'armand01', 'armando01', 'ptslineops', 'ptskitchen@lineops.io']
    },
    {
      email: westgateAccountEmail,
      password: process.env.WESTGATE_ACCOUNT_PASSWORD || 'Westgate',
      businessName: 'Westgate',
      fullName: 'Westgate Admin',
      businessType: 'Casino',
      identityLabel: 'Banquets and Pizza',
      candidates: ['westgate', 'west@gmail.com']
    }
  ]
}

async function upsertFiltraCoreAccount(accountInput, { resetPassword = false, candidates = [] } = {}) {
  const email = normalizeLoginIdentifier(accountInput.email || accountInput.login || accountInput.clientCode)
  const password = accountInput.password ? String(accountInput.password) : ''
  const businessName = String(accountInput.businessName || accountInput.business_name || accountInput.displayName || '').trim()
  const fullName = String(accountInput.fullName || accountInput.full_name || accountInput.name || '').trim()
  const businessType = normalizeBusinessType(accountInput.businessType || accountInput.business_type)
  const identityLabel = normalizeIdentityLabel(accountInput.identityLabel)
  const role = String(accountInput.role || '').trim() || (email === brainEmail ? 'superadmin' : 'admin')
  const candidateEmails = [
    email,
    ...accountIdentifierCandidates(accountInput.email || accountInput.login || accountInput.clientCode),
    ...candidates.flatMap(candidate => accountIdentifierCandidates(candidate))
  ].map(normalizeEmail)
  const uniqueCandidates = [...new Set(candidateEmails.filter(Boolean))]

  if (!email || !isValidEmail(email) || !businessName || !fullName) {
    throw badRequest('Business name, owner name, and a valid account email are required')
  }

  const existing = await pool.query(
    `
    SELECT users.user_id, users.tenant_id, users.email, users.name, users.password_hash, users.role
    FROM users
    WHERE LOWER(users.email) = ANY($1::text[])
    ORDER BY CASE WHEN LOWER(users.email) = LOWER($2) THEN 0 ELSE 1 END, users.created_at ASC
    LIMIT 1
    `,
    [uniqueCandidates, email]
  )

  if (existing.rowCount === 0) {
    if (!password) {
      throw badRequest('Password is required for a new account')
    }

    return createPublicAccount({
      businessName,
      fullName,
      email,
      password,
      businessType,
      role,
      createSessionToken: false,
      allowUsername: false,
      minimumPasswordLength: 6,
      identityLabel: accountInput.identityLabel,
      logoDataUrl: accountInput.logoDataUrl
    })
  }

  const user = existing.rows[0]
  const shouldUpdatePassword = Boolean(password && resetPassword)
  await pool.query(
    `
    UPDATE users
    SET email = $1,
        name = $2,
        role = $3,
        password_hash = CASE WHEN $4::boolean THEN $5 ELSE password_hash END
    WHERE user_id = $6
    `,
    [
      email,
      fullName,
      role,
      shouldUpdatePassword,
      shouldUpdatePassword ? hashPassword(password) : user.password_hash,
      user.user_id
    ]
  )
  await pool.query(
    'UPDATE tenants SET name = $1, identity_label = COALESCE(NULLIF($2, \'\'), identity_label) WHERE tenant_id = $3',
    [businessName, identityLabel, Number(user.tenant_id)]
  )
  await pool.query(
    `
    INSERT INTO user_tenant_access (user_id, tenant_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role
    `,
    [user.user_id, Number(user.tenant_id), role]
  )
  await seedSampleTenantData(pool, Number(user.tenant_id), businessName)

  return {
    token: '',
    user: {
      id: Number(user.user_id),
      email,
      name: fullName,
      role,
      tenantId: Number(user.tenant_id),
      tenantName: businessName
    }
  }
}

async function seedCanonicalClientUsers() {
  const shouldReset = process.env.FILTRACORE_RESET_CLIENT_PASSWORDS === 'true'
  for (const account of canonicalClientAccounts()) {
    const session = await upsertFiltraCoreAccount(account, {
      resetPassword: shouldReset,
      candidates: account.candidates
    })

    if (normalizeLoginIdentifier(account.email) === stratAccountEmail && session?.user?.id && session?.user?.tenantId) {
      await ensureWaterfilterRestaurantWorkspaces(pool, Number(session.user.id), Number(session.user.tenantId))
    }
  }
}

async function syncAccountToBeoflow(accountInput) {
  if (!syncSecret || !beoflowApiBaseURL) return

  const email = normalizeLoginIdentifier(accountInput.email || accountInput.login || accountInput.clientCode)
  if (!email || !isValidEmail(email)) return

  try {
    const response = await fetch(`${beoflowApiBaseURL}/api/sync/accounts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bastida-Sync-Secret': syncSecret
      },
      body: JSON.stringify({
        source: 'filtracore',
        account: {
          ...accountInput,
          email
        }
      })
    })

    if (!response.ok) {
      const body = await response.text()
      console.warn(`Beoflow account sync failed with ${response.status}: ${body.slice(0, 160)}`)
    }
  } catch (error) {
    console.warn('Beoflow account sync failed', error.message)
  }
}

async function seedDemoUser() {
  const session = await upsertFiltraCoreAccount({
    businessName: 'Northstar Hospitality',
    fullName: 'App Review Demo',
    email: demoEmail,
    password: demoPassword,
    businessType: 'Hospitality',
    identityLabel: 'Demo Workspace'
  }, {
    resetPassword: true,
    candidates: ['demo@filtracore.io', 'demo@lineops.io']
  })

  if (session?.user?.tenantId) {
    await ensureWaterfilterSetupData(pool, Number(session.user.tenantId))
  }
}

async function seedBrainUser() {
  const password = process.env.FILTRACORE_BRAIN_PASSWORD

  if (!password) return

  const businessName = process.env.FILTRACORE_BRAIN_BUSINESS || 'Bastida Systems'
  const fullName = process.env.FILTRACORE_BRAIN_NAME || 'Bastida Systems Admin'
  const existing = await pool.query(
    `
    SELECT users.user_id, users.tenant_id
    FROM users
    WHERE users.email = $1
    LIMIT 1
    `,
    [brainEmail]
  )

  if (existing.rowCount === 0) {
    await createPublicAccount({
      businessName,
      fullName,
      email: brainEmail,
      password,
      businessType: 'Other'
    })
  }

  const userResult = await pool.query(
    `
    SELECT users.user_id, users.tenant_id
    FROM users
    WHERE users.email = $1
    LIMIT 1
    `,
    [brainEmail]
  )

  if (userResult.rowCount === 0) return

  await pool.query(
    'UPDATE users SET password_hash = $1, name = $2, role = $3 WHERE email = $4',
    [hashPassword(password), fullName, 'superadmin', brainEmail]
  )
  await pool.query(
    'UPDATE tenants SET name = $1 WHERE tenant_id = $2',
    [businessName, Number(userResult.rows[0].tenant_id)]
  )
  await seedSampleTenantData(pool, Number(userResult.rows[0].tenant_id), businessName)
}

async function getState(auth, db = pool) {
  const client = db === pool ? await pool.connect() : db
  const tenantId = auth.tenantId

  try {
    const machineAccess = await getMachineAccess(client, tenantId)
    const facilitiesResult = await client.query(
      'SELECT * FROM facilities WHERE tenant_id = $1 ORDER BY name ASC, facility_id DESC',
      [tenantId]
    )
    const machinesResult = await client.query(
      'SELECT * FROM machines WHERE tenant_id = $1 ORDER BY machine_id DESC',
      [tenantId]
    )
    const inventoryResult = await client.query(
      'SELECT * FROM inventory WHERE tenant_id = $1 ORDER BY inventory_id DESC',
      [tenantId]
    )
    const filtersResult = await client.query(`
      SELECT
        filters.*,
        inventory.name AS product_name,
        inventory.category AS product_category,
        inventory.unit_cost,
        inventory.reorder_number AS product_reorder_number,
        inventory.filter_type AS product_filter_type,
        inventory.vendor_name AS product_vendor_name
      FROM filters
      LEFT JOIN inventory
        ON inventory.inventory_id = filters.inventory_id
       AND inventory.tenant_id = filters.tenant_id
      WHERE filters.tenant_id = $1
      ORDER BY filters.filter_id DESC
    `, [tenantId])
    const maintenanceResult = await client.query(
      'SELECT * FROM maintenance WHERE tenant_id = $1 ORDER BY performed_at DESC, maintenance_id DESC',
      [tenantId]
    )
    const techniciansResult = await client.query(
      'SELECT * FROM technicians WHERE tenant_id = $1 ORDER BY active DESC, name ASC',
      [tenantId]
    )
    const inspectionsResult = await client.query(
      'SELECT * FROM inspections WHERE tenant_id = $1 ORDER BY inspected_at DESC, inspection_id DESC LIMIT 200',
      [tenantId]
    )
    const inventoryUsageResult = await client.query(
      `
      SELECT
        inventory_id,
        SUM(quantity)::int AS total_used,
        COUNT(*)::int AS events,
        MAX(used_at) AS last_used_at
      FROM inventory_usage
      WHERE tenant_id = $1
      GROUP BY inventory_id
      `,
      [tenantId]
    )
    const suppliersResult = await client.query(
      `
      SELECT *
      FROM suppliers
      WHERE tenant_id = $1
      ORDER BY status ASC, name ASC, supplier_id DESC
      `,
      [tenantId]
    )
    const supplierProductsResult = await client.query(
      `
      SELECT
        supplier_products.*,
        suppliers.name AS supplier_name,
        inventory.name AS inventory_name,
        inventory.category AS inventory_category,
        inventory.stock,
        inventory.reorder_level
      FROM supplier_products
      INNER JOIN suppliers
        ON suppliers.supplier_id = supplier_products.supplier_id
       AND suppliers.tenant_id = supplier_products.tenant_id
      INNER JOIN inventory
        ON inventory.inventory_id = supplier_products.inventory_id
       AND inventory.tenant_id = supplier_products.tenant_id
      WHERE supplier_products.tenant_id = $1
      ORDER BY inventory.name ASC, supplier_products.current_price ASC, suppliers.name ASC
      `,
      [tenantId]
    )
    const priceHistoryResult = await client.query(
      `
      SELECT *
      FROM price_history
      WHERE tenant_id = $1
      ORDER BY changed_at DESC, price_history_id DESC
      LIMIT 300
      `,
      [tenantId]
    )
    const purchaseOrdersResult = await client.query(
      `
      SELECT
        purchase_orders.*,
        suppliers.name AS supplier_name
      FROM purchase_orders
      LEFT JOIN suppliers
        ON suppliers.supplier_id = purchase_orders.supplier_id
       AND suppliers.tenant_id = purchase_orders.tenant_id
      WHERE purchase_orders.tenant_id = $1
      ORDER BY purchase_orders.created_at DESC, purchase_orders.purchase_order_id DESC
      `,
      [tenantId]
    )
    const purchaseOrderItemsResult = await client.query(
      `
      SELECT
        purchase_order_items.*,
        inventory.name AS inventory_name
      FROM purchase_order_items
      LEFT JOIN inventory
        ON inventory.inventory_id = purchase_order_items.inventory_id
       AND inventory.tenant_id = purchase_order_items.tenant_id
      WHERE purchase_order_items.tenant_id = $1
      ORDER BY purchase_order_items.purchase_order_id DESC, purchase_order_items.purchase_order_item_id ASC
      `,
      [tenantId]
    )

    const maintenanceRecords = maintenanceResult.rows.map(mapMaintenance)
    const purchaseOrders = purchaseOrdersResult.rows.map(mapPurchaseOrder)
    const purchaseOrdersById = new Map(purchaseOrders.map(order => [order.id, order]))

    purchaseOrderItemsResult.rows.map(mapPurchaseOrderItem).forEach(item => {
      const order = purchaseOrdersById.get(item.purchaseOrderId)
      if (order) order.items.push(item)
    })
    const psiHistoryByFilter = new Map()

    maintenanceRecords
      .filter(record => record.filterId && record.correctedPsi !== null)
      .slice()
      .reverse()
      .forEach(record => {
        const history = psiHistoryByFilter.get(record.filterId) || []

        history.push({
          date: record.date,
          psi: record.correctedPsi,
          source: String(record.type || '').toLowerCase().includes('replace') ? 'replacement' : 'maintenance'
        })

        psiHistoryByFilter.set(record.filterId, history)
      })

    const filters = filtersResult.rows.map(row => {
      const filterId = Number(row.filter_id)
      const history = psiHistoryByFilter.get(filterId) || []
      const psi = toNullableNumber(row.psi)

      if (psi !== null && history.length === 0) {
        history.push({
          date: row.created_at,
          psi
        })
      }

      return mapFilter(row, history)
    })

    return {
      facilities: facilitiesResult.rows.map(mapFacility),
      machines: machinesResult.rows.map(mapMachine),
      inventory: inventoryResult.rows.map(mapInventory),
      filters,
      maintenanceRecords,
      technicians: techniciansResult.rows.map(mapTechnician),
      inspections: inspectionsResult.rows.map(mapInspection),
      inventoryUsage: inventoryUsageResult.rows.map(row => ({
        inventoryId: row.inventory_id === null || row.inventory_id === undefined ? null : Number(row.inventory_id),
        totalUsed: toNumber(row.total_used),
        events: toNumber(row.events),
        lastUsedAt: row.last_used_at
      })),
      suppliers: suppliersResult.rows.map(mapSupplier),
      supplierProducts: supplierProductsResult.rows.map(mapSupplierProduct),
      priceHistory: priceHistoryResult.rows.map(mapPriceHistory),
      purchaseOrders,
      machineAccess
    }
  } finally {
    if (db === pool) {
      client.release()
    }
  }
}

async function getMachineAccess(db, tenantId) {
  const machineResult = await db.query('SELECT COUNT(*)::int AS count FROM machines WHERE tenant_id = $1', [tenantId])
  const ownerResult = await db.query(
    `
    SELECT users.email
    FROM user_tenant_access
    INNER JOIN users ON users.user_id = user_tenant_access.user_id
    WHERE user_tenant_access.tenant_id = $1
    ORDER BY user_tenant_access.role = $2 DESC, user_tenant_access.created_at ASC
    `,
    [tenantId, 'admin']
  )
  const machineCount = toNumber(machineResult.rows[0]?.count)
  const ownerEmails = ownerResult.rows.map(row => normalizeEmail(row.email)).filter(Boolean)
  const unlimited = ownerEmails.some(isUnlimitedMachineClient)
  const remaining = unlimited ? null : Math.max(standardMachineLimit - machineCount, 0)

  return {
    tier: unlimited ? 'valued' : 'standard',
    unlimited,
    limit: unlimited ? null : standardMachineLimit,
    machines: machineCount,
    remaining,
    ownerEmail: ownerEmails[0] || '',
    message: unlimited
      ? 'As a valued early FiltraCore client, this workspace has unlimited machine access. Standard accounts include up to 5 machines.'
      : `Standard FiltraCore accounts include up to ${standardMachineLimit} machines. Upgrade your plan or buy more machine access to install additional machines.`
  }
}

async function assertCanCreateMachine(auth) {
  const access = await getMachineAccess(pool, auth.tenantId)
  if (access.unlimited || access.machines < standardMachineLimit) return access

  const error = badRequest(
    `This workspace has reached the ${standardMachineLimit}-machine Standard limit. Upgrade the plan or buy more machine access to install additional machines.`
  )
  error.statusCode = 403
  throw error
}

async function sendState(req, res, status = 200) {
  const state = await getState(req.auth)
  res.status(status).json(state)
}

async function findOrCreateFacility(db, tenantId, name, details = {}) {
  const cleanName = String(name || '').trim()
  if (!cleanName) return null

  const existing = await db.query(
    `
    SELECT facility_id
    FROM facilities
    WHERE tenant_id = $1
      AND LOWER(name) = LOWER($2)
    LIMIT 1
    `,
    [tenantId, cleanName]
  )

  if (existing.rowCount > 0) {
    await db.query(
      `
      UPDATE facilities
      SET
        venue_type = COALESCE(NULLIF($3, ''), venue_type),
        building = COALESCE(NULLIF($4, ''), building),
        address = COALESCE(NULLIF($5, ''), address)
      WHERE facility_id = $2
        AND tenant_id = $1
      `,
      [
        tenantId,
        existing.rows[0].facility_id,
        String(details.venueType || details.venue_type || '').trim(),
        String(details.building || '').trim(),
        String(details.address || '').trim()
      ]
    )
    return Number(existing.rows[0].facility_id)
  }

  const created = await db.query(
    `
    INSERT INTO facilities (tenant_id, name, venue_type, building, address)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING facility_id
    `,
    [
      tenantId,
      cleanName,
      String(details.venueType || details.venue_type || '').trim() || null,
      String(details.building || '').trim() || null,
      String(details.address || '').trim() || null
    ]
  )

  return Number(created.rows[0].facility_id)
}

async function findOrCreateTechnician(db, tenantId, name) {
  const cleanName = String(name || '').trim()
  if (!cleanName) return null

  const existing = await db.query(
    `
    SELECT technician_id
    FROM technicians
    WHERE tenant_id = $1
      AND LOWER(name) = LOWER($2)
    LIMIT 1
    `,
    [tenantId, cleanName]
  )

  if (existing.rowCount > 0) return Number(existing.rows[0].technician_id)

  const created = await db.query(
    `
    INSERT INTO technicians (tenant_id, name)
    VALUES ($1, $2)
    RETURNING technician_id
    `,
    [tenantId, cleanName]
  )

  return Number(created.rows[0].technician_id)
}

function handleError(res, error, fallbackMessage = 'Request failed') {
  const statusCode = error.statusCode || 500

  if (statusCode >= 500) {
    console.error(error)
  } else {
    console.warn(error.publicMessage || error.message)
  }

  res.status(statusCode).json({
    error: error.publicMessage || fallbackMessage
  })
}

function badRequest(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.publicMessage = message
  return error
}

function unauthorized(message = 'Sign in is required') {
  const error = new Error(message)
  error.statusCode = 401
  error.publicMessage = message
  return error
}

function parseDataUrl(dataUrl) {
  const value = String(dataUrl || '').trim()
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/i)

  if (!match) {
    return {
      mimeType: '',
      buffer: Buffer.from(value, 'utf8'),
      dataUrl: value
    }
  }

  const mimeType = match[1] || ''
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')

  return { mimeType, buffer, dataUrl: value }
}

function cleanImportText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
}

function importCell(row, aliases) {
  if (!row || typeof row !== 'object') return ''

  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [
      String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''),
      value
    ])
  )

  for (const alias of aliases) {
    const key = String(alias).toLowerCase().replace(/[^a-z0-9]/g, '')
    if (normalized.has(key)) return normalized.get(key)
  }

  return ''
}

function normalizeImportRecord(record) {
  const source = record && typeof record === 'object' ? record : {}
  const venue = cleanImportText(source.venue ?? source.facility ?? source.location ?? source.business ?? '')
  const machine = cleanImportText(source.machine ?? source.machineName ?? source.asset ?? source.equipment ?? '')
  const reorderNumber = cleanImportText(
    source.reorderNumber ?? source.reorder_number ?? source.reorder ?? source.reOrder ?? source.reorderNo ?? source['ReOrder#'] ?? ''
  )
  const filterType = cleanImportText(source.filterType ?? source.filter_type ?? source.filter ?? source.product ?? source.name ?? '')
  const quantity = Math.max(1, toNumber(source.quantity ?? source.filterQuantity ?? source.filter_amount ?? source.amount, 1))

  if (!venue || !machine || !reorderNumber || !filterType) return null

  return {
    venue: venue.slice(0, 160),
    machine: machine.slice(0, 160),
    reorderNumber: reorderNumber.slice(0, 80),
    filterType: filterType.slice(0, 160),
    quantity,
    category: cleanImportText(source.category ?? source.equipmentCategory ?? source.equipment_category ?? machine).slice(0, 120),
    brand: cleanImportText(source.brand || '').slice(0, 120),
    model: cleanImportText(source.model || '').slice(0, 120),
    serialNumber: cleanImportText(source.serialNumber ?? source.serial_number ?? '').slice(0, 120),
    building: cleanImportText(source.building || '').slice(0, 120),
    floor: cleanImportText(source.floor || '').slice(0, 60),
    zone: cleanImportText(source.zone || '').slice(0, 120),
    exactLocation: cleanImportText(source.exactLocation ?? source.exact_location ?? venue).slice(0, 220),
    vendorName: cleanImportText(source.vendorName ?? source.vendor_name ?? source.vendor ?? '').slice(0, 160),
    confidence: Math.max(0, Math.min(1, Number(source.confidence) || 0.72))
  }
}

function rowsFromWorksheet(workbook) {
  const rows = []

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })

    jsonRows.forEach(row => {
      const normalized = normalizeImportRecord({
        venue: importCell(row, ['venue', 'facility', 'location', 'site']),
        machine: importCell(row, ['machine', 'equipment', 'asset', 'machine name']),
        reorderNumber: importCell(row, ['reorder', 'reorder#', 're order#', 'reorder number', 'reorder no', 'part number', 'sku']),
        filterType: importCell(row, ['filter type', 'filter', 'product', 'cartridge', 'name']),
        quantity: importCell(row, ['filter amount', 'amount', 'qty', 'quantity', 'filter quantity']),
        category: importCell(row, ['category', 'equipment category', 'type']),
        brand: importCell(row, ['brand']),
        model: importCell(row, ['model']),
        serialNumber: importCell(row, ['serial', 'serial number']),
        building: importCell(row, ['building']),
        floor: importCell(row, ['floor']),
        zone: importCell(row, ['zone']),
        exactLocation: importCell(row, ['exact location', 'location detail']),
        vendorName: importCell(row, ['vendor', 'vendor name', 'supplier'])
      })

      if (normalized) rows.push(normalized)
    })
  }

  return rows
}

function parseDelimitedImportText(text) {
  const workbook = XLSX.read(text, { type: 'string', raw: false })
  return rowsFromWorksheet(workbook)
}

function parseFreeformImportLine(line) {
  const cleanLine = cleanImportText(line)
  if (!cleanLine || /venue\s+machine\s+re\s*order|waterfilters/i.test(cleanLine)) return null

  const quantityMatch = cleanLine.match(/\s+(\d+)\s*$/)
  if (!quantityMatch) return null

  const quantity = Number(quantityMatch[1])
  const withoutQuantity = cleanLine.slice(0, quantityMatch.index).trim()
  const reorderPattern = /\b(?:[A-Z]{1,4}\d[A-Z0-9.-]*-\d+[A-Z0-9.-]*|[A-Z]{1,4}-\d+[A-Z0-9.-]*|[A-Z]{1,4}s?\d{3,}|[0-9]{3,}(?:-[0-9A-Z]+)?)\b/i
  const reorderMatch = withoutQuantity.match(reorderPattern)

  if (!reorderMatch) return null

  const reorderNumber = reorderMatch[0]
  const left = withoutQuantity.slice(0, reorderMatch.index).trim()
  const filterType = withoutQuantity.slice(reorderMatch.index + reorderNumber.length).trim()
  if (!left || !filterType) return null

  const machinePatterns = [
    'BACK SIDE STATION',
    'FRONT SIDE STATION',
    'Ice Machine',
    'Soda Machine',
    'Tea Machine',
    'Coffee machine',
    'Coffe machine',
    'STEAMER',
    'Steamer'
  ]

  let machine = ''
  let venue = ''

  for (const pattern of machinePatterns) {
    const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    const match = left.match(regex)
    if (match) {
      venue = left.slice(0, match.index).trim()
      machine = match[0].trim()
      break
    }
  }

  if (!venue || !machine) {
    const parts = left.split(/\s{2,}|\t+/).map(part => part.trim()).filter(Boolean)
    if (parts.length >= 2) {
      venue = parts.slice(0, -1).join(' ')
      machine = parts[parts.length - 1]
    }
  }

  if (!venue || !machine) return null

  return normalizeImportRecord({
    venue,
    machine,
    reorderNumber,
    filterType,
    quantity,
    category: machine,
    confidence: 0.65
  })
}

function parseImportRowsFromText(text) {
  const cleanText = cleanImportText(text)
  if (!cleanText) return []

  const delimitedRows = parseDelimitedImportText(cleanText)
  if (delimitedRows.length > 0) return delimitedRows

  const rows = []
  cleanText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const parsed = parseFreeformImportLine(line)
      if (parsed) rows.push(parsed)
    })

  return rows
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer })

  try {
    const result = await parser.getText({ first: 10 })
    return cleanImportText(result.text || '')
  } finally {
    await parser.destroy()
  }
}

async function extractImportContent(body) {
  const warnings = []
  const sourceText = cleanImportText(body.text || body.sourceText || '')
  const sourceName = cleanImportText(body.fileName || body.sourceName || 'Manual import')
  const dataUrl = String(body.dataUrl || '').trim()
  const declaredMimeType = cleanImportText(body.mimeType || '')
  let extractedText = sourceText
  let spreadsheetRows = []
  let mimeType = declaredMimeType

  if (dataUrl) {
    const parsed = parseDataUrl(dataUrl)
    mimeType = mimeType || parsed.mimeType
    const lowerName = sourceName.toLowerCase()

    try {
      if (
        mimeType.includes('spreadsheet') ||
        mimeType.includes('excel') ||
        mimeType.includes('csv') ||
        lowerName.endsWith('.xlsx') ||
        lowerName.endsWith('.xls') ||
        lowerName.endsWith('.csv') ||
        lowerName.endsWith('.tsv')
      ) {
        const workbook = XLSX.read(parsed.buffer, { type: 'buffer', raw: false })
        spreadsheetRows = rowsFromWorksheet(workbook)
        if (!extractedText) {
          extractedText = workbook.SheetNames
            .map(sheetName => XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]))
            .join('\n')
        }
      } else if (mimeType.includes('pdf') || lowerName.endsWith('.pdf')) {
        extractedText = [extractedText, await extractPdfText(parsed.buffer)].filter(Boolean).join('\n')
      } else if (mimeType.startsWith('text/') || lowerName.endsWith('.txt')) {
        extractedText = [extractedText, parsed.buffer.toString('utf8')].filter(Boolean).join('\n')
      }
    } catch (error) {
      warnings.push(`Could not parse ${sourceName}: ${error.message}`)
    }
  }

  return {
    sourceName,
    mimeType,
    dataUrl,
    text: extractedText,
    spreadsheetRows,
    warnings
  }
}

function extractOpenAIOutputText(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.output_text === 'string') return payload.output_text

  const chunks = []
  for (const output of payload.output || []) {
    for (const content of output.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text)
      if (content.type === 'text' && content.text) chunks.push(content.text)
    }
  }

  return chunks.join('\n')
}

async function extractImportRowsWithAI({ text, dataUrl, mimeType, sourceName }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim()
  if (!apiKey) return { records: [], aiUsed: false, warning: 'OPENAI_API_KEY is not configured; used deterministic import parsing only.' }

  const content = [
    {
      type: 'input_text',
      text: [
        'Extract FiltraCore filter sheet rows from the provided source.',
        'Return JSON with records only. Each record should include: venue, machine, reorderNumber, filterType, quantity, category, brand, model, serialNumber, building, floor, zone, exactLocation, vendorName, confidence.',
        'Do not invent rows. Use null or empty strings for unknown optional fields. Quantity must be a number. The source often has columns: Venue, Machine, ReOrder#, Filter Type, FILTER AMOUNT.'
      ].join('\n')
    }
  ]

  if (text) {
    content.push({
      type: 'input_text',
      text: `Source text:\n${text.slice(0, 40000)}`
    })
  }

  if (dataUrl && mimeType.startsWith('image/')) {
    content.push({
      type: 'input_image',
      detail: 'high',
      image_url: dataUrl
    })
  } else if (dataUrl && mimeType.includes('pdf')) {
    content.push({
      type: 'input_file',
      filename: sourceName || 'filtracore-import.pdf',
      file_data: dataUrl
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_IMPORT_MODEL || 'gpt-5.5',
        input: [
          {
            role: 'user',
            content
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'filtracore_import_records',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                records: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      venue: { type: ['string', 'null'] },
                      machine: { type: ['string', 'null'] },
                      reorderNumber: { type: ['string', 'null'] },
                      filterType: { type: ['string', 'null'] },
                      quantity: { type: ['number', 'null'] },
                      category: { type: ['string', 'null'] },
                      brand: { type: ['string', 'null'] },
                      model: { type: ['string', 'null'] },
                      serialNumber: { type: ['string', 'null'] },
                      building: { type: ['string', 'null'] },
                      floor: { type: ['string', 'null'] },
                      zone: { type: ['string', 'null'] },
                      exactLocation: { type: ['string', 'null'] },
                      vendorName: { type: ['string', 'null'] },
                      confidence: { type: ['number', 'null'] }
                    },
                    required: [
                      'venue',
                      'machine',
                      'reorderNumber',
                      'filterType',
                      'quantity',
                      'category',
                      'brand',
                      'model',
                      'serialNumber',
                      'building',
                      'floor',
                      'zone',
                      'exactLocation',
                      'vendorName',
                      'confidence'
                    ]
                  }
                }
              },
              required: ['records']
            },
            strict: true
          }
        }
      })
    })

    const payload = await response.json()
    if (!response.ok) {
      return {
        records: [],
        aiUsed: false,
        warning: payload.error?.message || `OpenAI import extraction failed with status ${response.status}.`
      }
    }

    const outputText = extractOpenAIOutputText(payload)
    const parsed = JSON.parse(outputText || '{"records":[]}')
    const records = Array.isArray(parsed.records)
      ? parsed.records.map(normalizeImportRecord).filter(Boolean)
      : []

    return { records, aiUsed: true, warning: '' }
  } catch (error) {
    return {
      records: [],
      aiUsed: false,
      warning: `AI import extraction failed: ${error.message}`
    }
  } finally {
    clearTimeout(timeout)
  }
}

function dedupeImportRecords(records) {
  const seen = new Set()
  const result = []

  for (const record of records) {
    const normalized = normalizeImportRecord(record)
    if (!normalized) continue

    const key = [
      normalized.venue,
      normalized.machine,
      normalized.reorderNumber,
      normalized.filterType,
      normalized.quantity
    ].map(value => String(value).toLowerCase()).join('|')

    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }

  return result
}

async function buildImportPreview(body) {
  const content = await extractImportContent(body)
  const deterministicRows = dedupeImportRecords([
    ...content.spreadsheetRows,
    ...parseImportRowsFromText(content.text)
  ])

  const aiResult = await extractImportRowsWithAI(content)
  const records = dedupeImportRecords(aiResult.records.length ? aiResult.records : deterministicRows)
  const warnings = [...content.warnings]
  if (aiResult.warning) warnings.push(aiResult.warning)
  if (!records.length && content.mimeType.startsWith('image/') && !process.env.OPENAI_API_KEY) {
    warnings.push('Photo import needs OPENAI_API_KEY for vision extraction, or paste OCR/text from the sheet.')
  }

  return {
    sourceName: content.sourceName,
    sourceType: content.mimeType || 'text/plain',
    aiUsed: aiResult.aiUsed,
    records,
    warnings
  }
}

async function findOrCreateImportedInventory(db, tenantId, record) {
  const existing = await db.query(
    `
    SELECT inventory_id
    FROM inventory
    WHERE tenant_id = $1
      AND (
        (
          NULLIF($2, '') IS NOT NULL
          AND
          LOWER(COALESCE(reorder_number, '')) = LOWER($2)
          AND LOWER(COALESCE(filter_type, category, name, '')) = LOWER($4)
        )
        OR (
          NULLIF($2, '') IS NULL
          AND
          LOWER(name) = LOWER($3)
          AND LOWER(COALESCE(filter_type, category, '')) = LOWER($4)
        )
      )
    ORDER BY inventory_id ASC
    LIMIT 1
    `,
    [tenantId, record.reorderNumber, record.filterType, record.filterType]
  )

  if (existing.rowCount > 0) {
    await db.query(
      `
      UPDATE inventory
      SET
        reorder_number = COALESCE(NULLIF($3, ''), reorder_number),
        filter_type = COALESCE(NULLIF($4, ''), filter_type),
        vendor_name = COALESCE(NULLIF($5, ''), vendor_name),
        reorder_level = GREATEST(COALESCE(reorder_level, 0), $6)
      WHERE inventory_id = $2
        AND tenant_id = $1
      `,
      [tenantId, existing.rows[0].inventory_id, record.reorderNumber, record.filterType, record.vendorName, record.quantity]
    )
    return Number(existing.rows[0].inventory_id)
  }

  const created = await db.query(
    `
    INSERT INTO inventory
    (
      tenant_id,
      name,
      category,
      reorder_number,
      filter_type,
      vendor_name,
      stock,
      unit_cost,
      reorder_level,
      life_months
    )
    VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, $8)
    RETURNING inventory_id
    `,
    [
      tenantId,
      record.filterType,
      record.category || record.machine,
      record.reorderNumber,
      record.filterType,
      record.vendorName || null,
      record.quantity,
      getDefaultLifeMonths(record.category || record.machine)
    ]
  )

  return Number(created.rows[0].inventory_id)
}

async function findOrCreateImportedMachine(db, tenantId, record) {
  const facilityId = await findOrCreateFacility(db, tenantId, record.venue, {
    building: record.building
  })
  const existing = await db.query(
    `
    SELECT machine_id
    FROM machines
    WHERE tenant_id = $1
      AND LOWER(name) = LOWER($2)
      AND LOWER(location) = LOWER($3)
    ORDER BY machine_id ASC
    LIMIT 1
    `,
    [tenantId, record.machine, record.venue]
  )

  if (existing.rowCount > 0) {
    await db.query(
      `
      UPDATE machines
      SET
        facility_id = COALESCE(facility_id, $3),
        category = COALESCE(NULLIF($4, ''), category),
        brand = COALESCE(NULLIF($5, ''), brand),
        model = COALESCE(NULLIF($6, ''), model),
        serial_number = COALESCE(NULLIF($7, ''), serial_number),
        building = COALESCE(NULLIF($8, ''), building),
        floor = COALESCE(NULLIF($9, ''), floor),
        zone = COALESCE(NULLIF($10, ''), zone),
        exact_location = COALESCE(NULLIF($11, ''), exact_location)
      WHERE tenant_id = $1
        AND machine_id = $2
      `,
      [
        tenantId,
        existing.rows[0].machine_id,
        facilityId,
        record.category || record.machine,
        record.brand,
        record.model,
        record.serialNumber,
        record.building,
        record.floor,
        record.zone,
        record.exactLocation || record.venue
      ]
    )
    return Number(existing.rows[0].machine_id)
  }

  const created = await db.query(
    `
    INSERT INTO machines
    (
      tenant_id,
      facility_id,
      name,
      type,
      category,
      location,
      department,
      brand,
      model,
      serial_number,
      building,
      floor,
      zone,
      exact_location,
      asset_id,
      health_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Imported')
    RETURNING machine_id
    `,
    [
      tenantId,
      facilityId,
      record.machine,
      record.machine,
      record.category || record.machine,
      record.venue,
      record.venue,
      record.brand || null,
      record.model || null,
      record.serialNumber || null,
      record.building || null,
      record.floor || null,
      record.zone || null,
      record.exactLocation || record.venue,
      `${slugify(record.venue).toUpperCase()}-${slugify(record.machine).toUpperCase()}`
    ]
  )

  return Number(created.rows[0].machine_id)
}

async function applyImportRecords(auth, recordsInput, metadata = {}, options = {}) {
  const records = dedupeImportRecords(recordsInput)
  if (!records.length) throw badRequest('No import records were detected')

  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const tenantId = auth.tenantId
    const existingMachineKeys = new Set()
    const existingMachines = await client.query(
      'SELECT LOWER(name) AS name, LOWER(location) AS location FROM machines WHERE tenant_id = $1',
      [tenantId]
    )
    existingMachines.rows.forEach(row => existingMachineKeys.add(`${row.name}|${row.location}`))

    const newMachineKeys = new Set()
    records.forEach(record => {
      const key = `${record.machine.toLowerCase()}|${record.venue.toLowerCase()}`
      if (!existingMachineKeys.has(key)) newMachineKeys.add(key)
    })

    const access = await getMachineAccess(client, tenantId)
    if (!options.bypassMachineLimit && !access.unlimited && access.limit !== null && access.machines + newMachineKeys.size > access.limit) {
      throw badRequest(`Import would create ${newMachineKeys.size} new machines and exceed the ${access.limit}-machine Standard limit.`)
    }

    let machinesCreated = 0
    let filtersCreated = 0
    let inventoryCreated = 0
    let filtersUpdated = 0

    for (const record of records) {
      const beforeInventory = await client.query('SELECT COUNT(*)::int AS count FROM inventory WHERE tenant_id = $1', [tenantId])
      const inventoryId = await findOrCreateImportedInventory(client, tenantId, record)
      const afterInventory = await client.query('SELECT COUNT(*)::int AS count FROM inventory WHERE tenant_id = $1', [tenantId])
      if (toNumber(afterInventory.rows[0]?.count) > toNumber(beforeInventory.rows[0]?.count)) inventoryCreated += 1

      const beforeMachines = await client.query('SELECT COUNT(*)::int AS count FROM machines WHERE tenant_id = $1', [tenantId])
      const machineId = await findOrCreateImportedMachine(client, tenantId, record)
      const afterMachines = await client.query('SELECT COUNT(*)::int AS count FROM machines WHERE tenant_id = $1', [tenantId])
      if (toNumber(afterMachines.rows[0]?.count) > toNumber(beforeMachines.rows[0]?.count)) machinesCreated += 1

      const existingFilter = await client.query(
        `
        SELECT filter_id
        FROM filters
        WHERE tenant_id = $1
          AND machine_id = $2
          AND inventory_id = $3
        LIMIT 1
        `,
        [tenantId, machineId, inventoryId]
      )

      if (existingFilter.rowCount > 0) {
        await client.query(
          `
          UPDATE filters
          SET
            filter_quantity = $4,
            vendor_name = COALESCE(NULLIF($5, ''), vendor_name)
          WHERE tenant_id = $1
            AND machine_id = $2
            AND inventory_id = $3
          `,
          [tenantId, machineId, inventoryId, record.quantity, record.vendorName]
        )
        filtersUpdated += 1
      } else {
        const installedAt = toDateString(new Date())
        const lifeMonths = getDefaultLifeMonths(record.category || record.machine)

        await client.query(
          `
          INSERT INTO filters
          (
            tenant_id,
            machine_id,
            inventory_id,
            psi,
            psi_min,
            psi_max,
            filter_quantity,
            vendor_name,
            life_months,
            installed_at,
            due_date,
            status
          )
          VALUES ($1, $2, $3, NULL, 50, 70, $4, $5, $6, $7, $8, 'Imported')
          `,
          [
            tenantId,
            machineId,
            inventoryId,
            record.quantity,
            record.vendorName || null,
            lifeMonths,
            installedAt,
            addMonths(installedAt, lifeMonths)
          ]
        )
        filtersCreated += 1
      }
    }

    await client.query(
      `
      INSERT INTO import_batches
      (
        tenant_id,
        source_name,
        source_type,
        detected_records,
        applied_records,
        ai_used,
        warnings
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        tenantId,
        metadata.sourceName || 'Smart import',
        metadata.sourceType || '',
        records.length,
        records.length,
        Boolean(metadata.aiUsed),
        JSON.stringify(metadata.warnings || [])
      ]
    )

    const state = await getState(auth, client)
    await client.query('COMMIT')

    return {
      ...state,
      importSummary: {
        detected: records.length,
        applied: records.length,
        machinesCreated,
        inventoryCreated,
        filtersCreated,
        filtersUpdated
      }
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function ensureWaterfilterSetupData(db, tenantId) {
  await removeStarterSampleData(db, tenantId)

  const existingBatch = await db.query(
    'SELECT import_batch_id FROM import_batches WHERE tenant_id = $1 AND source_name = $2 LIMIT 1',
    [tenantId, waterfilterSetupSourceName]
  )

  if (existingBatch.rowCount > 0) return

  await applyImportRecords(
    { tenantId },
    waterfilterSetupRecords,
    {
      sourceName: waterfilterSetupSourceName,
      sourceType: 'seed/waterfilters-photo',
      aiUsed: false,
      warnings: []
    },
    { bypassMachineLimit: true }
  )
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url')

  await pool.query(
    `
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 day'))
    `,
    [userId, hashToken(token), Math.max(1, sessionDays)]
  )

  return token
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req)

    if (!token) {
      throw unauthorized()
    }

    const result = await pool.query(
      `
      SELECT
        users.user_id,
        users.tenant_id,
        users.email,
        users.name,
        users.role,
        tenants.name AS tenant_name
      FROM sessions
      INNER JOIN users ON users.user_id = sessions.user_id
      INNER JOIN tenants ON tenants.tenant_id = users.tenant_id
      WHERE sessions.token_hash = $1
        AND sessions.expires_at > NOW()
      `,
      [hashToken(token)]
    )

    if (result.rowCount === 0) {
      throw unauthorized('Invalid or expired session')
    }

    req.auth = mapAuthUser(result.rows[0])

    const requestedTenantId = toNumber(req.get('x-filtracore-tenant-id'), 0)
    if (requestedTenantId) {
      const tenantResult = isBrainUser(req.auth)
        ? await pool.query(
          'SELECT tenant_id, name FROM tenants WHERE tenant_id = $1 LIMIT 1',
          [requestedTenantId]
        )
        : await pool.query(
          `
          SELECT tenants.tenant_id, tenants.name
          FROM user_tenant_access
          INNER JOIN tenants ON tenants.tenant_id = user_tenant_access.tenant_id
          WHERE user_tenant_access.user_id = $1
            AND user_tenant_access.tenant_id = $2
          LIMIT 1
          `,
          [req.auth.id, requestedTenantId]
        )

      if (tenantResult.rowCount === 0) {
        throw badRequest('Selected restaurant was not found')
      }

      req.auth.homeTenantId = req.auth.tenantId
      req.auth.tenantId = Number(tenantResult.rows[0].tenant_id)
      req.auth.tenantName = tenantResult.rows[0].name
    }

    pool
      .query('UPDATE sessions SET last_used_at = NOW() WHERE token_hash = $1', [hashToken(token)])
      .catch(error => console.warn('Failed to update session activity', error))

    next()
  } catch (error) {
    handleError(res, error, 'Authentication failed')
  }
}

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true })
  } catch (error) {
    handleError(res, error, 'Database connection failed')
  }
})

app.get('/api/version', (req, res) => {
  res.json({
    app: 'FiltraCore',
    apiVersion: '1.0',
    minimumClientVersion: '1.0.0'
  })
})

app.post('/api/auth/login', async (req, res) => {
  try {
    const rawEmail = normalizeEmail(req.body.username || req.body.email)
    const email = normalizeLoginIdentifier(rawEmail)
    const password = req.body.password

    if (!rawEmail || !password) {
      throw badRequest('Cliente and password are required')
    }

    const result = await pool.query(
      `
      SELECT
        users.user_id,
        users.tenant_id,
        users.email,
        users.name,
        users.role,
        users.password_hash,
        tenants.name AS tenant_name
      FROM users
      INNER JOIN tenants ON tenants.tenant_id = users.tenant_id
      WHERE LOWER(users.email) = ANY($1::text[])
      ORDER BY CASE WHEN LOWER(users.email) = LOWER($2) THEN 0 ELSE 1 END
      LIMIT 1
      `,
      [accountIdentifierCandidates(rawEmail), email]
    )

    if (result.rowCount === 0 || !verifyPassword(password, result.rows[0].password_hash)) {
      throw unauthorized('Invalid email or password')
    }

    const token = await createSession(result.rows[0].user_id)

    res.json({
      token,
      user: mapAuthUser(result.rows[0])
    })
  } catch (error) {
    handleError(res, error, 'Failed to sign in')
  }
})

app.post('/api/auth/signup', async (req, res) => {
  try {
    const session = await createPublicAccount({
      businessName: req.body.businessName,
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      businessType: req.body.businessType,
      logoDataUrl: req.body.logoDataUrl,
      identityLabel: req.body.identityLabel
    })
    await syncAccountToBeoflow({
      businessName: req.body.businessName,
      fullName: req.body.fullName,
      email: req.body.email,
      password: req.body.password,
      businessType: req.body.businessType,
      identityLabel: req.body.identityLabel
    })

    res.status(201).json(session)
  } catch (error) {
    handleError(res, error, 'Failed to create account')
  }
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.auth })
})

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  try {
    const token = getBearerToken(req)

    if (token) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
    }

    res.json({ ok: true })
  } catch (error) {
    handleError(res, error, 'Failed to sign out')
  }
})

app.delete('/api/auth/account', requireAuth, async (req, res) => {
  const client = await pool.connect()
  let didBegin = false

  try {
    if (normalizeEmail(req.auth.email) === demoEmail) {
      const token = getBearerToken(req)
      if (token) {
        await client.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)])
      }
      res.json({ ok: true, demo: true })
      return
    }

    await client.query('BEGIN')
    didBegin = true
    await client.query('DELETE FROM sessions WHERE user_id = $1', [req.auth.id])
    await client.query('DELETE FROM tenants WHERE tenant_id = $1', [req.auth.tenantId])
    await client.query('COMMIT')
    res.json({ ok: true })
  } catch (error) {
    if (didBegin) {
      await client.query('ROLLBACK')
    }
    handleError(res, error, 'Failed to delete account')
  } finally {
    client.release()
  }
})

async function getAdminUsersPayload() {
  const result = await pool.query(
    `
    SELECT
      users.user_id,
      user_tenant_access.tenant_id,
      users.email,
      users.name,
      user_tenant_access.role,
      user_tenant_access.created_at,
      tenants.name AS tenant_name,
      tenants.logo_data_url,
      tenants.identity_label,
      (
        SELECT COUNT(*)::int
        FROM machines
        WHERE machines.tenant_id = tenants.tenant_id
      ) AS machines_count,
      (
        SELECT COUNT(*)::int
        FROM inventory
        WHERE inventory.tenant_id = tenants.tenant_id
      ) AS inventory_count,
      (
        SELECT COUNT(*)::int
        FROM filters
        WHERE filters.tenant_id = tenants.tenant_id
      ) AS filters_count,
      (
        SELECT COUNT(*)::int
        FROM maintenance
        WHERE maintenance.tenant_id = tenants.tenant_id
      ) AS maintenance_count,
      (
        SELECT MAX(sessions.last_used_at)
        FROM sessions
        WHERE sessions.user_id = users.user_id
      ) AS last_session_at
    FROM user_tenant_access
    INNER JOIN users ON users.user_id = user_tenant_access.user_id
    INNER JOIN tenants ON tenants.tenant_id = user_tenant_access.tenant_id
    ORDER BY user_tenant_access.created_at DESC, tenants.name ASC
    LIMIT 500
    `
  )

  const users = result.rows.map(mapAdminUser)

  return {
    ok: true,
    totals: {
      users: users.length,
      businesses: new Set(users.map(user => user.tenantId)).size,
      demoUsers: users.filter(user => normalizeEmail(user.email) === demoEmail).length,
      brainUsers: users.filter(user => isBrainUser(user)).length
    },
    users
  }
}

async function getRestaurantWorkspacesPayload(auth) {
  if (isBrainUser(auth)) {
    return getAdminUsersPayload()
  }

  const result = await pool.query(
    `
    SELECT
      users.user_id,
      user_tenant_access.tenant_id,
      users.email,
      users.name,
      user_tenant_access.role,
      user_tenant_access.created_at,
      tenants.name AS tenant_name,
      tenants.logo_data_url,
      tenants.identity_label,
      (
        SELECT COUNT(*)::int
        FROM machines
        WHERE machines.tenant_id = tenants.tenant_id
      ) AS machines_count,
      (
        SELECT COUNT(*)::int
        FROM inventory
        WHERE inventory.tenant_id = tenants.tenant_id
      ) AS inventory_count,
      (
        SELECT COUNT(*)::int
        FROM filters
        WHERE filters.tenant_id = tenants.tenant_id
      ) AS filters_count,
      (
        SELECT COUNT(*)::int
        FROM maintenance
        WHERE maintenance.tenant_id = tenants.tenant_id
      ) AS maintenance_count,
      (
        SELECT MAX(sessions.last_used_at)
        FROM sessions
        WHERE sessions.user_id = users.user_id
      ) AS last_session_at
    FROM user_tenant_access
    INNER JOIN users ON users.user_id = user_tenant_access.user_id
    INNER JOIN tenants ON tenants.tenant_id = user_tenant_access.tenant_id
    WHERE user_tenant_access.user_id = $1
    ORDER BY user_tenant_access.created_at ASC, tenants.name ASC
    `,
    [auth.id]
  )

  const users = result.rows.map(mapAdminUser)

  return {
    ok: true,
    totals: {
      users: users.length,
      businesses: new Set(users.map(user => user.tenantId)).size,
      demoUsers: users.filter(user => normalizeEmail(user.email) === demoEmail).length,
      brainUsers: 0
    },
    users
  }
}

app.get('/api/restaurants', requireAuth, async (req, res) => {
  try {
    res.json(await getRestaurantWorkspacesPayload(req.auth))
  } catch (error) {
    handleError(res, error, 'Failed to load restaurants')
  }
})

app.post('/api/restaurants', requireAuth, async (req, res) => {
  try {
    if (isBrainUser(req.auth)) {
      return res.status(403).json({ error: 'Use the Bastida Systems add restaurant panel for brain workspaces' })
    }

    if (!String(req.body.businessName || '').trim()) {
      throw badRequest('Business or location name is required')
    }

    const session = await createRestaurantWorkspaceForAccount({
      businessName: req.body.businessName,
      fullName: req.auth.name || req.auth.email,
      email: req.auth.email,
      password: '',
      businessType: req.body.businessType,
      role: 'admin',
      logoDataUrl: req.body.logoDataUrl,
      identityLabel: req.body.identityLabel || req.body.businessType
    })
    const payload = await getRestaurantWorkspacesPayload(req.auth)
    const user = payload.users.find(item => String(item.tenantId) === String(session.user.tenantId)) || session.user

    res.status(201).json({
      ok: true,
      user,
      totals: payload.totals,
      users: payload.users
    })
  } catch (error) {
    handleError(res, error, 'Failed to create restaurant')
  }
})

app.get('/api/admin/users', requireAuth, async (req, res) => {
  try {
    if (!isBrainUser(req.auth)) {
      return res.status(403).json({ error: 'Only Bastida Systems can view FiltraCore users' })
    }

    res.json(await getAdminUsersPayload())
  } catch (error) {
    handleError(res, error, 'Failed to load users')
  }
})

app.post('/api/admin/users', requireAuth, async (req, res) => {
  try {
    if (!isBrainUser(req.auth)) {
      return res.status(403).json({ error: 'Only Bastida Systems can create FiltraCore users' })
    }

    const session = await createRestaurantWorkspaceForAccount({
      businessName: req.body.businessName,
      fullName: req.body.fullName,
      email: req.body.email || req.body.username,
      password: req.body.password,
      businessType: req.body.businessType,
      logoDataUrl: req.body.logoDataUrl,
      identityLabel: req.body.identityLabel
    })
    if (!session.existingUser) {
      await syncAccountToBeoflow({
        businessName: req.body.businessName,
        fullName: req.body.fullName,
        email: req.body.email || req.body.username,
        password: req.body.password,
        businessType: req.body.businessType,
        identityLabel: req.body.identityLabel
      })
    }
    const payload = await getAdminUsersPayload()
    const user = payload.users.find(item => String(item.tenantId) === String(session.user.tenantId)) || session.user

    res.status(201).json({
      ok: true,
      user,
      totals: payload.totals,
      users: payload.users
    })
  } catch (error) {
    handleError(res, error, 'Failed to create user')
  }
})

app.post('/api/sync/accounts', async (req, res) => {
  try {
    if (!syncSecret || req.get('x-bastida-sync-secret') !== syncSecret) {
      return res.status(404).json({ error: 'Not found.' })
    }

    const account = req.body.account || req.body
    const session = await upsertFiltraCoreAccount(account, {
      resetPassword: Boolean(account.password),
      candidates: [
        account.email,
        account.login,
        account.clientCode,
        req.body.email,
        req.body.login,
        req.body.clientCode
      ].filter(Boolean)
    })
    const payload = await getAdminUsersPayload()
    const user = payload.users.find(item => item.id === session.user.id) || session.user

    res.json({
      ok: true,
      user
    })
  } catch (error) {
    handleError(res, error, 'Failed to sync account')
  }
})

app.use('/api', requireAuth)
app.use('/machines', requireAuth)
app.use('/suppliers', requireAuth)
app.use('/supplier-products', requireAuth)
app.use('/purchase-orders', requireAuth)

app.get('/api/state', async (req, res) => {
  try {
    await sendState(req, res)
  } catch (error) {
    handleError(res, error, 'Failed to fetch app data')
  }
})

app.post('/api/import/preview', async (req, res) => {
  try {
    const preview = await buildImportPreview(req.body || {})
    res.json(preview)
  } catch (error) {
    handleError(res, error, 'Failed to preview import')
  }
})

app.post('/api/import/apply', async (req, res) => {
  try {
    const body = req.body || {}
    const preview = Array.isArray(body.records)
      ? {
        sourceName: cleanImportText(body.sourceName || 'Smart import'),
        sourceType: cleanImportText(body.sourceType || ''),
        aiUsed: Boolean(body.aiUsed),
        records: dedupeImportRecords(body.records),
        warnings: Array.isArray(body.warnings) ? body.warnings : []
      }
      : await buildImportPreview(body)

    const state = await applyImportRecords(req.auth, preview.records, preview)
    res.status(201).json(state)
  } catch (error) {
    handleError(res, error, 'Failed to apply import')
  }
})

app.get('/api/machines', async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.machines)
  } catch (error) {
    handleError(res, error, 'Failed to fetch machines')
  }
})

app.get('/machines', async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.machines)
  } catch (error) {
    handleError(res, error, 'Failed to fetch machines')
  }
})

async function createMachine(req, res) {
  try {
    const {
      name,
      type,
      category,
      location,
      department,
      brand,
      model,
      serialNumber,
      serial_number,
      building,
      floor,
      zone,
      exactLocation,
      exact_location,
      healthStatus,
      health_status
    } = req.body

    const assetId = req.body.assetId ?? req.body.asset_id
    const facilityIdInput = toNullableNumber(req.body.facilityId ?? req.body.facility_id)
    const facilityName = req.body.facilityName ?? req.body.facility_name ?? location

    if (!name || !type || !location) {
      throw badRequest('Machine name, type, and location are required')
    }

    await assertCanCreateMachine(req.auth)
    const facilityId = facilityIdInput || await findOrCreateFacility(pool, req.auth.tenantId, facilityName, { building })

    await pool.query(
      `
      INSERT INTO machines
      (
        tenant_id,
        facility_id,
        name,
        type,
        category,
        location,
        department,
        brand,
        model,
        serial_number,
        building,
        floor,
        zone,
        exact_location,
        asset_id,
        qr_payload,
        health_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `,
      [
        req.auth.tenantId,
        facilityId,
        name,
        type,
        category || type,
        location,
        department || null,
        brand || null,
        model || null,
        serialNumber || serial_number || null,
        building || null,
        floor || null,
        zone || null,
        exactLocation || exact_location || location,
        assetId || null,
        null,
        healthStatus || health_status || 'Unknown'
      ]
    )

    await sendState(req, res, 201)
  } catch (error) {
    handleError(res, error, 'Failed to create machine')
  }
}

app.post('/api/machines', createMachine)
app.post('/machines', createMachine)

async function getMachineQR(req, res) {
  try {
    const tenantId = req.auth.tenantId
    const machineId = toNullableNumber(req.params.id)

    if (!machineId) {
      throw badRequest('Machine is required')
    }

    const machineResult = await pool.query(
      'SELECT machine_id FROM machines WHERE machine_id = $1 AND tenant_id = $2',
      [machineId, tenantId]
    )

    if (machineResult.rowCount === 0) {
      throw badRequest('Machine not found')
    }

    const payload = getMachineQRPayload(machineId)
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    })

    res.json({
      payload,
      displayCode: getMachineQRDisplayCode(machineId),
      svg
    })
  } catch (error) {
    handleError(res, error, 'Failed to generate machine QR')
  }
}

app.get('/api/machines/:id/qr', getMachineQR)
app.get('/machines/:id/qr', getMachineQR)

async function deleteMachine(req, res) {
  const client = await pool.connect()

  try {
    const tenantId = req.auth.tenantId
    const machineId = toNullableNumber(req.params.id)

    if (!machineId) {
      throw badRequest('Machine is required')
    }

    await client.query('BEGIN')

    const machineResult = await client.query(
      'SELECT machine_id FROM machines WHERE machine_id = $1 AND tenant_id = $2 FOR UPDATE',
      [machineId, tenantId]
    )

    if (machineResult.rowCount === 0) {
      throw badRequest('Machine not found')
    }

    await client.query(
      'DELETE FROM maintenance WHERE machine_id = $1 AND tenant_id = $2',
      [machineId, tenantId]
    )

    await client.query(
      'DELETE FROM filters WHERE machine_id = $1 AND tenant_id = $2',
      [machineId, tenantId]
    )

    await client.query(
      'DELETE FROM machines WHERE machine_id = $1 AND tenant_id = $2',
      [machineId, tenantId]
    )

    const state = await getState(req.auth, client)
    await client.query('COMMIT')
    res.json(state)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to delete machine')
  } finally {
    client.release()
  }
}

app.delete('/api/machines/:id', deleteMachine)
app.delete('/machines/:id', deleteMachine)

app.get('/api/inventory', async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.inventory)
  } catch (error) {
    handleError(res, error, 'Failed to fetch inventory')
  }
})

app.post('/api/inventory', async (req, res) => {
  try {
    const {
      name,
      category,
      reorderNumber,
      reorder_number,
      filterType,
      filter_type,
      vendorName,
      vendor_name,
      vendorContact,
      vendor_contact,
      stock,
      unitCost,
      unit_cost,
      reorderLevel,
      reorder_level,
      lifeMonths,
      life_months
    } = req.body

    if (!name || !category) {
      throw badRequest('Inventory name and category are required')
    }

    await pool.query(
      `
      INSERT INTO inventory
      (
        tenant_id,
        name,
        category,
        reorder_number,
        filter_type,
        vendor_name,
        vendor_contact,
        stock,
        unit_cost,
        reorder_level,
        life_months
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        req.auth.tenantId,
        name,
        category,
        reorderNumber ?? reorder_number ?? null,
        filterType ?? filter_type ?? category,
        vendorName ?? vendor_name ?? null,
        vendorContact ?? vendor_contact ?? null,
        toNumber(stock),
        toNumber(unitCost ?? unit_cost),
        toNumber(reorderLevel ?? reorder_level),
        toNumber(lifeMonths ?? life_months, getDefaultLifeMonths(category))
      ]
    )

    await sendState(req, res, 201)
  } catch (error) {
    handleError(res, error, 'Failed to create inventory item')
  }
})

const validSupplierStatuses = new Set(['active', 'inactive'])
const validPurchaseOrderStatuses = new Set(['Draft', 'Sent', 'Received', 'Cancelled'])

function normalizeSupplierStatus(status) {
  const normalized = String(status || 'active').trim().toLowerCase()
  return validSupplierStatuses.has(normalized) ? normalized : 'active'
}

function normalizePurchaseOrderStatus(status) {
  const normalized = String(status || 'Draft').trim().toLowerCase()
  const match = Array.from(validPurchaseOrderStatuses).find(value => value.toLowerCase() === normalized)
  return match || 'Draft'
}

function getRequestedPrice(value) {
  if (value === null || value === undefined || value === '') return null
  const price = Number(value)
  return Number.isFinite(price) ? roundCurrency(price) : null
}

function generatePurchaseOrderNumber() {
  return `FC-PO-${Date.now().toString().slice(-8)}`
}

app.get(['/api/suppliers', '/suppliers'], async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.suppliers)
  } catch (error) {
    handleError(res, error, 'Failed to fetch suppliers')
  }
})

app.post(['/api/suppliers', '/suppliers'], async (req, res) => {
  try {
    const {
      name,
      contact,
      contactName,
      contact_name,
      email,
      phone,
      website,
      category,
      notes,
      status
    } = req.body

    if (!String(name || '').trim()) {
      throw badRequest('Supplier name is required')
    }

    await pool.query(
      `
      INSERT INTO suppliers
      (
        tenant_id,
        name,
        contact_name,
        email,
        phone,
        website,
        category,
        notes,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        req.auth.tenantId,
        String(name).trim(),
        contact ?? contactName ?? contact_name ?? null,
        email || null,
        phone || null,
        website || null,
        category || null,
        notes || null,
        normalizeSupplierStatus(status)
      ]
    )

    await sendState(req, res, 201)
  } catch (error) {
    handleError(res, error, 'Failed to create supplier')
  }
})

app.get(['/api/supplier-products', '/supplier-products'], async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.supplierProducts)
  } catch (error) {
    handleError(res, error, 'Failed to fetch supplier products')
  }
})

app.post(['/api/supplier-products', '/supplier-products'], async (req, res) => {
  const client = await pool.connect()

  try {
    const tenantId = req.auth.tenantId
    const supplierId = toNullableNumber(req.body.supplierId ?? req.body.supplier_id)
    const inventoryId = toNullableNumber(req.body.inventoryId ?? req.body.inventory_item_id ?? req.body.inventory_id)
    const supplierSku = String(req.body.supplierSku ?? req.body.supplier_sku ?? '').trim()
    const productName = String(req.body.productName ?? req.body.product_name ?? '').trim()
    const currentPrice = getRequestedPrice(req.body.currentPrice ?? req.body.current_price ?? req.body.price)
    const notes = req.body.notes || null
    const status = normalizeSupplierStatus(req.body.status)

    if (!supplierId || !inventoryId || currentPrice === null || currentPrice < 0) {
      throw badRequest('Supplier, inventory item, and current price are required')
    }

    await client.query('BEGIN')

    const supplierResult = await client.query(
      'SELECT supplier_id FROM suppliers WHERE supplier_id = $1 AND tenant_id = $2',
      [supplierId, tenantId]
    )

    if (supplierResult.rowCount === 0) {
      throw badRequest('Supplier not found')
    }

    const inventoryResult = await client.query(
      'SELECT inventory_id, name FROM inventory WHERE inventory_id = $1 AND tenant_id = $2',
      [inventoryId, tenantId]
    )

    if (inventoryResult.rowCount === 0) {
      throw badRequest('Inventory item not found')
    }

    const existing = await client.query(
      `
      SELECT supplier_product_id, current_price, last_price
      FROM supplier_products
      WHERE tenant_id = $1
        AND supplier_id = $2
        AND inventory_id = $3
        AND COALESCE(supplier_sku, '') = COALESCE($4, '')
      ORDER BY supplier_product_id ASC
      LIMIT 1
      FOR UPDATE
      `,
      [tenantId, supplierId, inventoryId, supplierSku || null]
    )

    let supplierProductId
    let previousPrice = null

    if (existing.rowCount > 0) {
      const row = existing.rows[0]
      supplierProductId = Number(row.supplier_product_id)
      previousPrice = toNumber(row.current_price)

      await client.query(
        `
        UPDATE supplier_products
        SET
          product_name = COALESCE(NULLIF($5, ''), product_name),
          current_price = $6,
          last_price = CASE
            WHEN current_price IS DISTINCT FROM $6 THEN current_price
            ELSE last_price
          END,
          last_updated_at = CURRENT_TIMESTAMP,
          notes = COALESCE($7, notes),
          status = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE supplier_product_id = $4
          AND tenant_id = $1
        `,
        [
          tenantId,
          supplierId,
          inventoryId,
          supplierProductId,
          productName,
          currentPrice,
          notes,
          status
        ]
      )
    } else {
      const created = await client.query(
        `
        INSERT INTO supplier_products
        (
          tenant_id,
          supplier_id,
          inventory_id,
          supplier_sku,
          product_name,
          current_price,
          last_price,
          last_updated_at,
          notes,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, NULL, CURRENT_TIMESTAMP, $7, $8)
        RETURNING supplier_product_id
        `,
        [
          tenantId,
          supplierId,
          inventoryId,
          supplierSku || null,
          productName || inventoryResult.rows[0].name,
          currentPrice,
          notes,
          status
        ]
      )

      supplierProductId = Number(created.rows[0].supplier_product_id)
    }

    if (previousPrice === null || previousPrice !== currentPrice) {
      await client.query(
        `
        INSERT INTO price_history
        (
          tenant_id,
          supplier_product_id,
          supplier_id,
          inventory_id,
          price,
          previous_price,
          source,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)
        `,
        [tenantId, supplierProductId, supplierId, inventoryId, currentPrice, previousPrice, notes]
      )
    }

    await client.query('COMMIT')
    await sendState(req, res, 201)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to save supplier product')
  } finally {
    client.release()
  }
})

app.get(['/api/purchase-orders', '/purchase-orders'], async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.purchaseOrders)
  } catch (error) {
    handleError(res, error, 'Failed to fetch purchase orders')
  }
})

app.post(['/api/purchase-orders', '/purchase-orders'], async (req, res) => {
  const client = await pool.connect()

  try {
    const tenantId = req.auth.tenantId
    const supplierId = toNullableNumber(req.body.supplierId ?? req.body.supplier_id)
    const status = normalizePurchaseOrderStatus(req.body.status)
    const expectedDate = toDateString(req.body.expectedDate ?? req.body.expected_date)
    const poNumber = String(req.body.poNumber ?? req.body.po_number ?? '').trim() || generatePurchaseOrderNumber()
    const notes = req.body.notes || null
    const itemsInput = Array.isArray(req.body.items) ? req.body.items : []

    if (!supplierId) {
      throw badRequest('Supplier is required for a purchase order')
    }

    await client.query('BEGIN')

    const supplierResult = await client.query(
      'SELECT supplier_id FROM suppliers WHERE supplier_id = $1 AND tenant_id = $2',
      [supplierId, tenantId]
    )

    if (supplierResult.rowCount === 0) {
      throw badRequest('Supplier not found')
    }

    const items = []

    for (const item of itemsInput) {
      const supplierProductId = toNullableNumber(item.supplierProductId ?? item.supplier_product_id)
      let inventoryId = toNullableNumber(item.inventoryId ?? item.inventory_id)
      let unitPrice = getRequestedPrice(item.unitPrice ?? item.unit_price ?? item.price)
      const quantity = Math.max(1, toNumber(item.quantity, 1))

      if (supplierProductId) {
        const productResult = await client.query(
          `
          SELECT supplier_product_id, inventory_id, current_price
          FROM supplier_products
          WHERE supplier_product_id = $1
            AND supplier_id = $2
            AND tenant_id = $3
          `,
          [supplierProductId, supplierId, tenantId]
        )

        if (productResult.rowCount === 0) {
          throw badRequest('Supplier product not found')
        }

        inventoryId = Number(productResult.rows[0].inventory_id)
        unitPrice = unitPrice === null ? toNumber(productResult.rows[0].current_price) : unitPrice
      }

      if (!inventoryId || unitPrice === null || unitPrice < 0) continue

      const inventoryResult = await client.query(
        'SELECT inventory_id FROM inventory WHERE inventory_id = $1 AND tenant_id = $2',
        [inventoryId, tenantId]
      )

      if (inventoryResult.rowCount === 0) continue

      items.push({
        supplierProductId,
        inventoryId,
        quantity,
        unitPrice,
        lineTotal: roundCurrency(quantity * unitPrice),
        notes: item.notes || null
      })
    }

    const totalAmount = items.reduce((total, item) => total + item.lineTotal, 0)
    const sentAt = status === 'Sent' ? new Date() : null
    const receivedAt = status === 'Received' ? new Date() : null
    const orderResult = await client.query(
      `
      INSERT INTO purchase_orders
      (
        tenant_id,
        supplier_id,
        po_number,
        status,
        expected_date,
        sent_at,
        received_at,
        notes,
        total_amount
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING purchase_order_id
      `,
      [tenantId, supplierId, poNumber, status, expectedDate, sentAt, receivedAt, notes, roundCurrency(totalAmount)]
    )

    const purchaseOrderId = Number(orderResult.rows[0].purchase_order_id)

    for (const item of items) {
      await client.query(
        `
        INSERT INTO purchase_order_items
        (
          tenant_id,
          purchase_order_id,
          inventory_id,
          supplier_product_id,
          quantity,
          unit_price,
          line_total,
          received_quantity,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)
        `,
        [
          tenantId,
          purchaseOrderId,
          item.inventoryId,
          item.supplierProductId,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          item.notes
        ]
      )
    }

    await client.query('COMMIT')
    await sendState(req, res, 201)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to create purchase order')
  } finally {
    client.release()
  }
})

app.get('/api/filters', async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.filters)
  } catch (error) {
    handleError(res, error, 'Failed to fetch filters')
  }
})

app.post('/api/filters', async (req, res) => {
  const client = await pool.connect()

  try {
    const tenantId = req.auth.tenantId
    const machineId = toNullableNumber(req.body.machineId ?? req.body.machine_id)
    const inventoryId = toNullableNumber(req.body.productId ?? req.body.inventory_id)
    const lifeMonths = toNumber(req.body.lifeMonths ?? req.body.life_months)
    const installedAt = toDateString(req.body.installedAt ?? req.body.installed_at)
    const dueDate = toDateString(req.body.dueDate ?? req.body.due_date ?? addMonths(installedAt, lifeMonths))
    const psi = toNullableNumber(req.body.psi)
    const psiMin = toNullableNumber(req.body.psiMin ?? req.body.psi_min)
    const psiMax = toNullableNumber(req.body.psiMax ?? req.body.psi_max)
    const filterQuantity = Math.max(1, toNumber(req.body.filterQuantity ?? req.body.filter_quantity, 1))
    const vendorName = req.body.vendorName ?? req.body.vendor_name

    if (!machineId || !inventoryId || !lifeMonths) {
      throw badRequest('Machine, filter product, and lifespan are required')
    }

    await client.query('BEGIN')

    const machineResult = await client.query(
      'SELECT machine_id FROM machines WHERE machine_id = $1 AND tenant_id = $2',
      [machineId, tenantId]
    )

    if (machineResult.rowCount === 0) {
      throw badRequest('Machine not found')
    }

    const inventoryResult = await client.query(
      'SELECT inventory_id, stock FROM inventory WHERE inventory_id = $1 AND tenant_id = $2 FOR UPDATE',
      [inventoryId, tenantId]
    )

    if (inventoryResult.rowCount === 0) {
      throw badRequest('Filter product not found')
    }

    if (toNumber(inventoryResult.rows[0].stock) < filterQuantity) {
      throw badRequest('No stock available for this filter product')
    }

    await client.query(
      `
      INSERT INTO filters
      (
        tenant_id,
        machine_id,
        inventory_id,
        psi,
        psi_min,
        psi_max,
        filter_quantity,
        vendor_name,
        life_months,
        installed_at,
        due_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        tenantId,
        machineId,
        inventoryId,
        psi,
        psiMin,
        psiMax,
        filterQuantity,
        vendorName || null,
        lifeMonths,
        installedAt,
        dueDate
      ]
    )

    await client.query(
      'UPDATE inventory SET stock = stock - $3 WHERE inventory_id = $1 AND tenant_id = $2',
      [inventoryId, tenantId, filterQuantity]
    )

    await client.query(
      `
      INSERT INTO inventory_usage (tenant_id, inventory_id, machine_id, quantity, reason, used_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [tenantId, inventoryId, machineId, filterQuantity, 'filter_install', installedAt]
    )

    await client.query('COMMIT')
    await sendState(req, res, 201)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to create filter')
  } finally {
    client.release()
  }
})

app.patch('/api/filters/:id/psi', async (req, res) => {
  const client = await pool.connect()

  try {
    const tenantId = req.auth.tenantId
    const filterId = toNullableNumber(req.params.id)
    const psi = toNullableNumber(req.body.psi)

    if (!filterId || psi === null) {
      throw badRequest('Filter and PSI value are required')
    }

    await client.query('BEGIN')

    const filterResult = await client.query(
      'SELECT filter_id, machine_id, psi FROM filters WHERE filter_id = $1 AND tenant_id = $2 FOR UPDATE',
      [filterId, tenantId]
    )

    if (filterResult.rowCount === 0) {
      throw badRequest('Filter not found')
    }

    const filter = filterResult.rows[0]

    await client.query(
      'UPDATE filters SET psi = $1 WHERE filter_id = $2 AND tenant_id = $3',
      [psi, filterId, tenantId]
    )

    const maintenanceInsert = await client.query(
      `
      INSERT INTO maintenance
      (
        tenant_id,
        machine_id,
        filter_id,
        maintenance_type,
        notes,
        current_psi,
        corrected_psi
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING maintenance_id
      `,
      [
        tenantId,
        filter.machine_id,
        filterId,
        'PSI Update',
        'Updated from filter dashboard',
        toNullableNumber(filter.psi),
        psi
      ]
    )

    await client.query(
      `
      INSERT INTO maintenance_logs
      (
        legacy_maintenance_id,
        tenant_id,
        machine_id,
        filter_id,
        maintenance_type,
        notes,
        current_psi,
        corrected_psi
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        maintenanceInsert.rows[0].maintenance_id,
        tenantId,
        filter.machine_id,
        filterId,
        'PSI Update',
        'Updated from filter dashboard',
        toNullableNumber(filter.psi),
        psi
      ]
    )

    await client.query('COMMIT')
    await sendState(req, res)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to update PSI')
  } finally {
    client.release()
  }
})

app.get('/api/maintenance', async (req, res) => {
  try {
    const state = await getState(req.auth)
    res.json(state.maintenanceRecords)
  } catch (error) {
    handleError(res, error, 'Failed to fetch maintenance')
  }
})

app.post('/api/maintenance', async (req, res) => {
  const client = await pool.connect()

  try {
    const tenantId = req.auth.tenantId
    const machineId = toNullableNumber(req.body.machineId ?? req.body.machine_id)
    const filterId = toNullableNumber(req.body.filterId ?? req.body.filter_id)
    const replacementProductId = toNullableNumber(req.body.replacementProductId ?? req.body.replacement_product_id)
    const type = req.body.type || req.body.maintenance_type || 'General'
    const notes = req.body.notes || ''
    const performedAt = toDateString(req.body.date ?? req.body.performed_at)
    const correctedPsi = toNullableNumber(req.body.correctedPsi ?? req.body.corrected_psi)
    let technicianId = toNullableNumber(req.body.technicianId ?? req.body.technician_id)
    const technicianName = String(req.body.technicianName ?? req.body.technician_name ?? '').trim()
    const inspectionStatus = String(req.body.inspectionStatus ?? req.body.inspection_status ?? '').trim()
    const priority = String(req.body.priority || '').trim()
    const nextDueDate = req.body.nextDueDate || req.body.next_due_date ? toDateString(req.body.nextDueDate ?? req.body.next_due_date) : null
    const isReplacement = String(type).toLowerCase().includes('replace')

    if (!machineId || !type || !performedAt) {
      throw badRequest('Machine, maintenance type, and date are required')
    }

    if (isReplacement && (!filterId || !replacementProductId)) {
      throw badRequest('Current filter and replacement product are required')
    }

    await client.query('BEGIN')

    if (!technicianId && technicianName) {
      technicianId = await findOrCreateTechnician(client, tenantId, technicianName)
    }

    const machineResult = await client.query(
      'SELECT machine_id FROM machines WHERE machine_id = $1 AND tenant_id = $2',
      [machineId, tenantId]
    )

    if (machineResult.rowCount === 0) {
      throw badRequest('Machine not found')
    }

    let currentPsi = null
    let replacedFrom = null
    let replacedWith = null

    if (isReplacement) {
      const filterResult = await client.query(
        `
        SELECT
          filters.*,
          inventory.name AS product_name
        FROM filters
        LEFT JOIN inventory
          ON inventory.inventory_id = filters.inventory_id
         AND inventory.tenant_id = filters.tenant_id
        WHERE filters.filter_id = $1
          AND filters.machine_id = $2
          AND filters.tenant_id = $3
        FOR UPDATE
        `,
        [filterId, machineId, tenantId]
      )

      if (filterResult.rowCount === 0) {
        throw badRequest('Current filter not found')
      }

      const replacementResult = await client.query(
        'SELECT inventory_id, name, category, stock, life_months FROM inventory WHERE inventory_id = $1 AND tenant_id = $2 FOR UPDATE',
        [replacementProductId, tenantId]
      )

      if (replacementResult.rowCount === 0) {
        throw badRequest('Replacement product not found')
      }

      const currentFilter = filterResult.rows[0]
      const replacementProduct = replacementResult.rows[0]
      const replacementQuantity = Math.max(1, toNumber(currentFilter.filter_quantity, 1))

      if (toNumber(replacementProduct.stock) < replacementQuantity) {
        throw badRequest('No stock available for the selected replacement filter')
      }

      currentPsi = toNullableNumber(currentFilter.psi)
      replacedFrom = currentFilter.product_name || 'Unknown filter'
      replacedWith = replacementProduct.name

      const lifeMonths = toNumber(replacementProduct.life_months, getDefaultLifeMonths(replacementProduct.category))
      const dueDate = addMonths(performedAt, lifeMonths)

      await client.query(
        'UPDATE inventory SET stock = stock - $3 WHERE inventory_id = $1 AND tenant_id = $2',
        [replacementProductId, tenantId, replacementQuantity]
      )

      await client.query(
        `
        INSERT INTO inventory_usage (tenant_id, inventory_id, machine_id, filter_id, quantity, reason, used_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [tenantId, replacementProductId, machineId, filterId, replacementQuantity, 'maintenance_replacement', performedAt]
      )

      await client.query(
        `
        UPDATE filters
        SET
          inventory_id = $1,
          life_months = $2,
          installed_at = $3,
          due_date = $4,
          psi = $5
        WHERE filter_id = $6
          AND tenant_id = $7
        `,
        [
          replacementProductId,
          lifeMonths,
          performedAt,
          dueDate,
          correctedPsi,
          filterId,
          tenantId
        ]
      )
    } else if (filterId && correctedPsi !== null) {
      const filterResult = await client.query(
        'SELECT filter_id, psi FROM filters WHERE filter_id = $1 AND machine_id = $2 AND tenant_id = $3 FOR UPDATE',
        [filterId, machineId, tenantId]
      )

      if (filterResult.rowCount === 0) {
        throw badRequest('Filter not found for PSI correction')
      }

      currentPsi = toNullableNumber(filterResult.rows[0].psi)

      await client.query(
        'UPDATE filters SET psi = $1 WHERE filter_id = $2 AND tenant_id = $3',
        [correctedPsi, filterId, tenantId]
      )
    }

    const maintenanceInsert = await client.query(
      `
      INSERT INTO maintenance
      (
        tenant_id,
        machine_id,
        filter_id,
        technician_id,
        technician_name,
        inspection_status,
        priority,
        next_due_date,
        maintenance_type,
        notes,
        current_psi,
        corrected_psi,
        replacement_product_id,
        replaced_from,
        replaced_with,
        performed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING maintenance_id
      `,
      [
        tenantId,
        machineId,
        filterId,
        technicianId,
        technicianName || null,
        inspectionStatus || null,
        priority || null,
        nextDueDate,
        type,
        notes,
        currentPsi,
        correctedPsi,
        replacementProductId,
        replacedFrom,
        replacedWith,
        performedAt
      ]
    )

    await client.query(
      `
      INSERT INTO maintenance_logs
      (
        legacy_maintenance_id,
        tenant_id,
        machine_id,
        filter_id,
        technician_id,
        technician_name,
        maintenance_type,
        priority,
        notes,
        current_psi,
        corrected_psi,
        replacement_product_id,
        replaced_from,
        replaced_with,
        performed_at,
        next_due_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `,
      [
        maintenanceInsert.rows[0].maintenance_id,
        tenantId,
        machineId,
        filterId,
        technicianId,
        technicianName || null,
        type,
        priority || null,
        notes,
        currentPsi,
        correctedPsi,
        replacementProductId,
        replacedFrom,
        replacedWith,
        performedAt,
        nextDueDate
      ]
    )

    if (inspectionStatus || String(type).toLowerCase().includes('inspection') || String(type).toLowerCase().includes('review')) {
      await client.query(
        `
        INSERT INTO inspections
        (
          tenant_id,
          machine_id,
          filter_id,
          technician_id,
          inspection_type,
          result,
          notes,
          psi_reading,
          inspected_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `,
        [
          tenantId,
          machineId,
          filterId,
          technicianId,
          type,
          inspectionStatus || null,
          notes,
          correctedPsi,
          performedAt
        ]
      )
    }

    await client.query('COMMIT')
    await sendState(req, res, 201)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to create maintenance record')
  } finally {
    client.release()
  }
})

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'))
})

app.get('/script.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'script.js'))
})

app.use('/img', express.static(path.join(__dirname, 'img')))

async function startServer() {
  await ensureSchema()

  app.listen(port, () => {
    console.log(`Server running on port ${port}`)
  })
}

if (require.main === module) {
  startServer().catch(error => {
    console.error('Failed to initialize database schema', error)
    process.exit(1)
  })
}

module.exports = {
  app,
  pool,
  ensureSchema
}
