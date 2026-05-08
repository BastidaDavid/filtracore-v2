CREATE TABLE machines (

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



CREATE TABLE inventory (

    inventory_id SERIAL PRIMARY KEY,

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
