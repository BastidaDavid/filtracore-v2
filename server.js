require('dotenv').config()

const path = require('path')
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')

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
    CREATE TABLE IF NOT EXISTS machines (
      machine_id SERIAL PRIMARY KEY,
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
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS life_months INTEGER;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replacement_product_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replaced_from TEXT;
    ALTER TABLE maintenance ADD COLUMN IF NOT EXISTS replaced_with TEXT;
  `)
}

async function getState(db = pool) {
  const client = db === pool ? await pool.connect() : db

  try {
    const machinesResult = await client.query('SELECT * FROM machines ORDER BY machine_id DESC')
    const inventoryResult = await client.query('SELECT * FROM inventory ORDER BY inventory_id DESC')
    const filtersResult = await client.query(`
      SELECT
        filters.*,
        inventory.name AS product_name,
        inventory.category AS product_category,
        inventory.unit_cost
      FROM filters
      LEFT JOIN inventory ON inventory.inventory_id = filters.inventory_id
      ORDER BY filters.filter_id DESC
    `)
    const maintenanceResult = await client.query('SELECT * FROM maintenance ORDER BY performed_at DESC, maintenance_id DESC')

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

async function sendState(res, status = 200) {
  const state = await getState()
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

app.get('/api/state', async (req, res) => {
  try {
    await sendState(res)
  } catch (error) {
    handleError(res, error, 'Failed to fetch app data')
  }
})

app.get('/api/machines', async (req, res) => {
  try {
    const state = await getState()
    res.json(state.machines)
  } catch (error) {
    handleError(res, error, 'Failed to fetch machines')
  }
})

app.get('/machines', async (req, res) => {
  try {
    const state = await getState()
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
        name,
        type,
        location,
        department,
        brand,
        model,
        asset_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        name,
        type,
        location,
        department || null,
        brand || null,
        model || null,
        assetId || null
      ]
    )

    await sendState(res, 201)
  } catch (error) {
    handleError(res, error, 'Failed to create machine')
  }
}

app.post('/api/machines', createMachine)
app.post('/machines', createMachine)

app.get('/api/inventory', async (req, res) => {
  try {
    const state = await getState()
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
        name,
        category,
        stock,
        unit_cost,
        reorder_level,
        life_months
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        name,
        category,
        toNumber(stock),
        toNumber(unitCost ?? unit_cost),
        toNumber(reorderLevel ?? reorder_level),
        toNumber(lifeMonths ?? life_months, getDefaultLifeMonths(category))
      ]
    )

    await sendState(res, 201)
  } catch (error) {
    handleError(res, error, 'Failed to create inventory item')
  }
})

app.get('/api/filters', async (req, res) => {
  try {
    const state = await getState()
    res.json(state.filters)
  } catch (error) {
    handleError(res, error, 'Failed to fetch filters')
  }
})

app.post('/api/filters', async (req, res) => {
  const client = await pool.connect()

  try {
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
      'SELECT machine_id FROM machines WHERE machine_id = $1',
      [machineId]
    )

    if (machineResult.rowCount === 0) {
      throw badRequest('Machine not found')
    }

    const inventoryResult = await client.query(
      'SELECT inventory_id, stock FROM inventory WHERE inventory_id = $1 FOR UPDATE',
      [inventoryId]
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
        machine_id,
        inventory_id,
        psi,
        life_months,
        installed_at,
        due_date
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        machineId,
        inventoryId,
        psi,
        lifeMonths,
        installedAt,
        dueDate
      ]
    )

    await client.query(
      'UPDATE inventory SET stock = stock - 1 WHERE inventory_id = $1',
      [inventoryId]
    )

    await client.query('COMMIT')
    await sendState(res, 201)
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
    const filterId = toNullableNumber(req.params.id)
    const psi = toNullableNumber(req.body.psi)

    if (!filterId || psi === null) {
      throw badRequest('Filter and PSI value are required')
    }

    await client.query('BEGIN')

    const filterResult = await client.query(
      'SELECT filter_id, machine_id, psi FROM filters WHERE filter_id = $1 FOR UPDATE',
      [filterId]
    )

    if (filterResult.rowCount === 0) {
      throw badRequest('Filter not found')
    }

    const filter = filterResult.rows[0]

    await client.query(
      'UPDATE filters SET psi = $1 WHERE filter_id = $2',
      [psi, filterId]
    )

    await client.query(
      `
      INSERT INTO maintenance
      (
        machine_id,
        filter_id,
        maintenance_type,
        notes,
        current_psi,
        corrected_psi
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        filter.machine_id,
        filterId,
        'PSI Update',
        'Updated from filter dashboard',
        toNullableNumber(filter.psi),
        psi
      ]
    )

    await client.query('COMMIT')
    await sendState(res)
  } catch (error) {
    await client.query('ROLLBACK')
    handleError(res, error, 'Failed to update PSI')
  } finally {
    client.release()
  }
})

app.get('/api/maintenance', async (req, res) => {
  try {
    const state = await getState()
    res.json(state.maintenanceRecords)
  } catch (error) {
    handleError(res, error, 'Failed to fetch maintenance')
  }
})

app.post('/api/maintenance', async (req, res) => {
  const client = await pool.connect()

  try {
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
        LEFT JOIN inventory ON inventory.inventory_id = filters.inventory_id
        WHERE filters.filter_id = $1
        FOR UPDATE
        `,
        [filterId]
      )

      if (filterResult.rowCount === 0) {
        throw badRequest('Current filter not found')
      }

      const replacementResult = await client.query(
        'SELECT inventory_id, name, category, stock, life_months FROM inventory WHERE inventory_id = $1 FOR UPDATE',
        [replacementProductId]
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
        'UPDATE inventory SET stock = stock - 1 WHERE inventory_id = $1',
        [replacementProductId]
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
        `,
        [
          replacementProductId,
          lifeMonths,
          performedAt,
          dueDate,
          correctedPsi,
          filterId
        ]
      )
    } else if (filterId && correctedPsi !== null) {
      const filterResult = await client.query(
        'SELECT filter_id, psi FROM filters WHERE filter_id = $1 FOR UPDATE',
        [filterId]
      )

      if (filterResult.rowCount === 0) {
        throw badRequest('Filter not found for PSI correction')
      }

      currentPsi = toNullableNumber(filterResult.rows[0].psi)

      await client.query(
        'UPDATE filters SET psi = $1 WHERE filter_id = $2',
        [correctedPsi, filterId]
      )
    }

    await client.query(
      `
      INSERT INTO maintenance
      (
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
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
    await sendState(res, 201)
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

ensureSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`)
    })
  })
  .catch(error => {
    console.error('Failed to initialize database schema', error)
    process.exit(1)
  })
