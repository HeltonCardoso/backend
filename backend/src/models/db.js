const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/monitor.db");

// Garante que o diretório existe
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// Performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- Tabela principal de pedidos
  CREATE TABLE IF NOT EXISTS orders (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      TEXT NOT NULL,          -- ID interno do sistema
    marketplace   TEXT NOT NULL,          -- ML, Shopee, Amazon, etc
    mp_order_id   TEXT,                   -- ID no marketplace
    anymarket_id  TEXT,                   -- ID no Anymarket
    jet_order_id  TEXT,                   -- ID na JET
    erp_order_id  TEXT,                   -- ID no Onclick/ERP
    value         REAL,
    status        TEXT DEFAULT 'new',     -- new|anymarket|jet|erp|invoiced|returned|ok|error
    sla_status    TEXT DEFAULT 'ok',      -- ok|warning|critical
    error_step    TEXT,                   -- em qual etapa travou
    error_reason  TEXT,                   -- motivo do erro
    created_at    TEXT NOT NULL,          -- quando o pedido foi criado no marketplace
    updated_at    TEXT NOT NULL,          -- última atualização aqui
    invoiced_at   TEXT,                   -- quando foi faturado
    returned_at   TEXT,                   -- quando voltou ao marketplace
    raw_data      TEXT                    -- JSON com dados brutos
  );

  -- Índices para performance
  CREATE INDEX IF NOT EXISTS idx_orders_order_id    ON orders(order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_anymarket   ON orders(anymarket_id);
  CREATE INDEX IF NOT EXISTS idx_orders_jet         ON orders(jet_order_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status      ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_marketplace ON orders(marketplace);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at  ON orders(created_at);

  -- Histórico de eventos por pedido
  CREATE TABLE IF NOT EXISTS order_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   TEXT NOT NULL,
    step       TEXT NOT NULL,        -- anymarket|jet|erp|invoiced|returned
    event_type TEXT NOT NULL,        -- received|processed|error|timeout
    payload    TEXT,                 -- JSON do webhook/API
    source     TEXT,                 -- webhook|api_poll|spreadsheet
    occurred_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_order_id ON order_events(order_id);

  -- Pedidos importados via planilha para comparação
  CREATE TABLE IF NOT EXISTS spreadsheet_imports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    import_date  TEXT NOT NULL,
    filename     TEXT,
    row_count    INTEGER,
    source       TEXT               -- shopee|amazon|magalu|americanas|erp|custom
  );

  CREATE TABLE IF NOT EXISTS spreadsheet_orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id    INTEGER REFERENCES spreadsheet_imports(id),
    order_id     TEXT NOT NULL,     -- ID do pedido na planilha
    marketplace  TEXT,
    status       TEXT,
    value        REAL,
    created_at   TEXT,
    extra        TEXT,              -- JSON com colunas extras
    matched_to   TEXT,             -- order_id no sistema principal (após cruzamento)
    match_status TEXT DEFAULT 'pending' -- pending|matched|missing|divergent
  );

  CREATE INDEX IF NOT EXISTS idx_sheet_orders_order_id ON spreadsheet_orders(order_id);
  CREATE INDEX IF NOT EXISTS idx_sheet_orders_import   ON spreadsheet_orders(import_id);

  -- Log de webhooks recebidos (para debug)
  CREATE TABLE IF NOT EXISTS webhook_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,      -- anymarket|jet
    event_type  TEXT,
    payload     TEXT,
    processed   INTEGER DEFAULT 0,
    error       TEXT,
    received_at TEXT NOT NULL
  );
`);

module.exports = db;
