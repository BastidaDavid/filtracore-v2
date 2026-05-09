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
app.use(express.json())

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
  return normalizeEmail(value)
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
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
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

  await seedAdminUser(defaultTenantId)
}

async function seedAdminUser(defaultTenantId) {
  const email = normalizeLoginIdentifier(process.env.FILTRACORE_ADMIN_USERNAME || process.env.FILTRACORE_ADMIN_EMAIL)
  const password = process.env.FILTRACORE_ADMIN_PASSWORD
  const name = process.env.FILTRACORE_ADMIN_NAME || 'FiltraCore Admin'

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

async function getState(auth, db = pool) {
  const client = db === pool ? await pool.connect() : db
  const tenantId = auth.tenantId

  try {
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
      maintenanceRecords
    }
  } finally {
    if (db === pool) {
      client.release()
    }
  }
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
    const email = normalizeLoginIdentifier(req.body.username || req.body.email)
    const password = req.body.password

    if (!email || !password) {
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
      WHERE users.email = $1
      `,
      [email]
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
