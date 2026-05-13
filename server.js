require('dotenv').config()

const path = require('path')
const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const QRCode = require('qrcode')

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
app.use(express.json({ limit: '1mb' }))

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
const unlimitedMachineClientEmails = new Set([stratAccountEmail, westgateAccountEmail])
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

  if (logo.length > 800000) {
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
    name: row.name || '',
    type: row.type || '',
    location: row.location || '',
    department: row.department || '',
    brand: row.brand || '',
    model: row.model || '',
    assetId: row.asset_id || '',
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
    machineId: Number(row.machine_id),
    filterId: row.filter_id === null || row.filter_id === undefined ? null : Number(row.filter_id),
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

    CREATE TABLE IF NOT EXISTS machines (
      machine_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      location TEXT NOT NULL,
      department TEXT,
      brand TEXT,
      model TEXT,
      asset_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory (
      inventory_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
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
      life_months INTEGER NOT NULL,
      installed_at DATE NOT NULL,
      due_date DATE NOT NULL,
      status TEXT DEFAULT 'Healthy',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance (
      maintenance_id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
      machine_id INTEGER REFERENCES machines(machine_id) ON DELETE CASCADE,
      filter_id INTEGER REFERENCES filters(filter_id) ON DELETE SET NULL,
      maintenance_type TEXT,
      notes TEXT,
      current_psi INTEGER,
      corrected_psi INTEGER,
      replacement_product_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
      replaced_from TEXT,
      replaced_with TEXT,
      performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  await pool.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data_url TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS identity_label TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE filters ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS life_months INTEGER;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replacement_product_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replaced_from TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replaced_with TEXT;

    CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS user_tenant_access_tenant_id_idx ON user_tenant_access(tenant_id);
    CREATE INDEX IF NOT EXISTS machines_tenant_id_idx ON machines(tenant_id);
    CREATE INDEX IF NOT EXISTS inventory_tenant_id_idx ON inventory(tenant_id);
    CREATE INDEX IF NOT EXISTS filters_tenant_id_idx ON filters(tenant_id);
    CREATE INDEX IF NOT EXISTS maintenance_tenant_id_idx ON maintenance(tenant_id);
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
    await upsertFiltraCoreAccount(account, {
      resetPassword: shouldReset,
      candidates: account.candidates
    })
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
  await upsertFiltraCoreAccount({
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
        inventory.unit_cost
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

    const maintenanceRecords = maintenanceResult.rows.map(mapMaintenance)
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
      machines: machinesResult.rows.map(mapMachine),
      inventory: inventoryResult.rows.map(mapInventory),
      filters,
      maintenanceRecords,
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
      : `Standard FiltraCore accounts include up to ${standardMachineLimit} machines.`
  }
}

async function assertCanCreateMachine(auth) {
  const access = await getMachineAccess(pool, auth.tenantId)
  if (access.unlimited || access.machines < standardMachineLimit) return access

  const error = badRequest(
    `Standard FiltraCore accounts include up to ${standardMachineLimit} machines. Strat and Westgate have unlimited machine access as valued early clients.`
  )
  error.statusCode = 403
  throw error
}

async function sendState(req, res, status = 200) {
  const state = await getState(req.auth)
  res.status(status).json(state)
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

app.get('/api/state', async (req, res) => {
  try {
    await sendState(req, res)
  } catch (error) {
    handleError(res, error, 'Failed to fetch app data')
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
      location,
      department,
      brand,
      model
    } = req.body

    const assetId = req.body.assetId ?? req.body.asset_id

    if (!name || !type || !location) {
      throw badRequest('Machine name, type, and location are required')
    }

    await assertCanCreateMachine(req.auth)

    await pool.query(
      `
      INSERT INTO machines
      (
        tenant_id,
        name,
        type,
        location,
        department,
        brand,
        model,
        asset_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        req.auth.tenantId,
        name,
        type,
        location,
        department || null,
        brand || null,
        model || null,
        assetId || null
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
        stock,
        unit_cost,
        reorder_level,
        life_months
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        req.auth.tenantId,
        name,
        category,
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

    if (toNumber(inventoryResult.rows[0].stock) <= 0) {
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
        life_months,
        installed_at,
        due_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        tenantId,
        machineId,
        inventoryId,
        psi,
        lifeMonths,
        installedAt,
        dueDate
      ]
    )

    await client.query(
      'UPDATE inventory SET stock = stock - 1 WHERE inventory_id = $1 AND tenant_id = $2',
      [inventoryId, tenantId]
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

    await client.query(
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
    const isReplacement = String(type).toLowerCase().includes('replace')

    if (!machineId || !type || !performedAt) {
      throw badRequest('Machine, maintenance type, and date are required')
    }

    if (isReplacement && (!filterId || !replacementProductId)) {
      throw badRequest('Current filter and replacement product are required')
    }

    await client.query('BEGIN')

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

      if (toNumber(replacementProduct.stock) <= 0) {
        throw badRequest('No stock available for the selected replacement filter')
      }

      currentPsi = toNullableNumber(currentFilter.psi)
      replacedFrom = currentFilter.product_name || 'Unknown filter'
      replacedWith = replacementProduct.name

      const lifeMonths = toNumber(replacementProduct.life_months, getDefaultLifeMonths(replacementProduct.category))
      const dueDate = addMonths(performedAt, lifeMonths)

      await client.query(
        'UPDATE inventory SET stock = stock - 1 WHERE inventory_id = $1 AND tenant_id = $2',
        [replacementProductId, tenantId]
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

    await client.query(
      `
      INSERT INTO maintenance
      (
        tenant_id,
        machine_id,
        filter_id,
        maintenance_type,
        notes,
        current_psi,
        corrected_psi,
        replacement_product_id,
        replaced_from,
        replaced_with,
        performed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        tenantId,
        machineId,
        filterId,
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
