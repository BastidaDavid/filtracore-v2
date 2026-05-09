CREATE TABLE tenants (
  tenant_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  session_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  last_used_at TIMESTAMP
);

CREATE TABLE machines (
  machine_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  location TEXT NOT NULL,
  department TEXT,
  brand TEXT,
  model TEXT,
  asset_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE inventory (
  inventory_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  stock INTEGER DEFAULT 0,
  unit_cost NUMERIC(10,2) DEFAULT 0,
  reorder_level INTEGER DEFAULT 0,
  life_months INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE filters (
  filter_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  machine_id INTEGER REFERENCES machines(machine_id) ON DELETE CASCADE,
  inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
  psi INTEGER,
  life_months INTEGER NOT NULL,
  installed_at DATE NOT NULL,
  due_date DATE NOT NULL,
  status TEXT DEFAULT 'Healthy',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE maintenance (
  maintenance_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX machines_tenant_id_idx ON machines(tenant_id);
CREATE INDEX inventory_tenant_id_idx ON inventory(tenant_id);
CREATE INDEX filters_tenant_id_idx ON filters(tenant_id);
CREATE INDEX maintenance_tenant_id_idx ON maintenance(tenant_id);
