-- PC Shop dashboard database script.
-- Applied automatically by postgres:16-alpine on the first boot of the db-data
-- volume (see docker-compose.yml). Re-appliable by hand with:
--   psql "$DATABASE_URL" -f src/db/schema.sql

CREATE TABLE IF NOT EXISTS products (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(120) NOT NULL,
    category   VARCHAR(32)  NOT NULL CHECK (
                    category IN ('case','motherboard','cpu','ram','gpu','storage','psu','cooling','peripheral')
                ),
    brand      VARCHAR(60),
    price      NUMERIC(10,2) CHECK (price IS NULL OR price >= 0),
    specs      JSONB,
    stock      INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    -- Author of the row. Filled from the JWT `sub` claim by the API, never from
    -- the request body, so the audit trail follows the validated token.
    created_by VARCHAR(64)  NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Postgres only runs the CREATE TABLE on a volume that does not have the table
-- yet. This brings a volume created by an earlier revision up to the current
-- shape without dropping the rows in it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_products_category ON products (category);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products (created_at DESC);

-- Seed so the dashboard is not empty on the first run. There is no UNIQUE
-- constraint on `name` (the app allows two people to list the same part), so
-- idempotency comes from removing the previous seed first.
DELETE FROM products WHERE created_by = 'seed';

INSERT INTO products (name, category, brand, price, specs, stock, created_by) VALUES
    ('NZXT H7 Flow',              'case',       'NZXT',        129.99, '{"form_factor":"ATX","radiator":"360mm","color":"black"}',         12, 'seed'),
    ('B650 Tomahawk WiFi',        'motherboard','MSI',         219.00, '{"socket":"AM5","chipset":"B650","memory":"DDR5"}',                 7, 'seed'),
    ('Ryzen 7 7800X3D',           'cpu',        'AMD',         449.00, '{"cores":8,"threads":16,"base_clock":"4.2GHz","socket":"AM5"}',     4, 'seed'),
    ('Corsair Vengeance 32 GB',   'ram',        'Corsair',      94.50, '{"capacity_gb":32,"type":"DDR5","speed_mhz":6000,"rgb":true}',     23, 'seed'),
    ('GeForce RTX 4070 Super',    'gpu',        'NVIDIA',      599.99, '{"vram_gb":12,"memory_type":"GDDR6X","length_mm":300}',             6, 'seed'),
    ('Samsung 990 Pro 2 TB',      'storage',    'Samsung',     169.00, '{"capacity_gb":2000,"interface":"NVMe PCIe 4.0","form":"M.2"}',    18, 'seed');
