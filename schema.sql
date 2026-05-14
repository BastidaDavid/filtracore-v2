CREATE TABLE tenants (
  tenant_id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_data_url TEXT,
  identity_label TEXT,
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

CREATE TABLE user_tenant_access (
  user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  tenant_id INTEGER REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE facilities (
  facility_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  venue_type TEXT,
  building TEXT,
  address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE machines (
  machine_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE inventory (
  inventory_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE filters (
  filter_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE technicians (
  technician_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'Technician',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE maintenance (
  maintenance_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE maintenance_logs (
  log_id SERIAL PRIMARY KEY,
  legacy_maintenance_id INTEGER,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE inspections (
  inspection_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE inventory_usage (
  usage_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
  machine_id INTEGER REFERENCES machines(machine_id) ON DELETE SET NULL,
  filter_id INTEGER REFERENCES filters(filter_id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  reason TEXT DEFAULT 'maintenance',
  used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_batches (
  import_batch_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  source_name TEXT,
  source_type TEXT,
  detected_records INTEGER DEFAULT 0,
  applied_records INTEGER DEFAULT 0,
  ai_used BOOLEAN DEFAULT FALSE,
  warnings JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE suppliers (
  supplier_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE supplier_products (
  supplier_product_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE purchase_orders (
  purchase_order_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
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

CREATE TABLE purchase_order_items (
  purchase_order_item_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  purchase_order_id INTEGER REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE,
  inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
  supplier_product_id INTEGER REFERENCES supplier_products(supplier_product_id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) DEFAULT 0,
  line_total NUMERIC(10,2) DEFAULT 0,
  received_quantity INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE price_history (
  price_history_id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  supplier_product_id INTEGER REFERENCES supplier_products(supplier_product_id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
  inventory_id INTEGER REFERENCES inventory(inventory_id) ON DELETE SET NULL,
  price NUMERIC(10,2) NOT NULL,
  previous_price NUMERIC(10,2),
  changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source TEXT DEFAULT 'manual',
  notes TEXT
);

CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX user_tenant_access_tenant_id_idx ON user_tenant_access(tenant_id);
CREATE INDEX facilities_tenant_id_idx ON facilities(tenant_id);
CREATE INDEX machines_tenant_id_idx ON machines(tenant_id);
CREATE INDEX machines_facility_id_idx ON machines(facility_id);
CREATE INDEX inventory_tenant_id_idx ON inventory(tenant_id);
CREATE INDEX inventory_reorder_number_idx ON inventory(tenant_id, reorder_number);
CREATE INDEX filters_tenant_id_idx ON filters(tenant_id);
CREATE INDEX filters_machine_id_idx ON filters(machine_id);
CREATE INDEX maintenance_tenant_id_idx ON maintenance(tenant_id);
CREATE INDEX maintenance_logs_tenant_id_idx ON maintenance_logs(tenant_id);
CREATE INDEX maintenance_logs_machine_id_idx ON maintenance_logs(machine_id);
CREATE INDEX technicians_tenant_id_idx ON technicians(tenant_id);
CREATE INDEX inspections_tenant_id_idx ON inspections(tenant_id);
CREATE INDEX inspections_machine_id_idx ON inspections(machine_id);
CREATE INDEX inventory_usage_tenant_id_idx ON inventory_usage(tenant_id);
CREATE INDEX import_batches_tenant_id_idx ON import_batches(tenant_id);
CREATE INDEX suppliers_tenant_id_idx ON suppliers(tenant_id);
CREATE INDEX suppliers_status_idx ON suppliers(tenant_id, status);
CREATE INDEX supplier_products_tenant_id_idx ON supplier_products(tenant_id);
CREATE INDEX supplier_products_inventory_id_idx ON supplier_products(tenant_id, inventory_id);
CREATE INDEX supplier_products_supplier_id_idx ON supplier_products(tenant_id, supplier_id);
CREATE INDEX purchase_orders_tenant_id_idx ON purchase_orders(tenant_id);
CREATE INDEX purchase_orders_supplier_id_idx ON purchase_orders(tenant_id, supplier_id);
CREATE INDEX purchase_order_items_order_id_idx ON purchase_order_items(purchase_order_id);
CREATE INDEX price_history_tenant_id_idx ON price_history(tenant_id);
CREATE INDEX price_history_supplier_product_id_idx ON price_history(supplier_product_id);
