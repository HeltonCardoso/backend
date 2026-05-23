-- ================================================================
-- 001-initial-schema.sql
-- Schema inicial completo e já corrigido
-- ================================================================

-- TABELA DE CONTROLE DE MIGRATIONS
CREATE TABLE IF NOT EXISTS migrations_executadas (
  id SERIAL PRIMARY KEY,
  arquivo VARCHAR(255) UNIQUE NOT NULL,
  executado_em TIMESTAMP DEFAULT NOW()
);

-- TABELA DE EVENTOS DE RASTREAMENTO
CREATE TABLE IF NOT EXISTS tracking_events (
  id UUID PRIMARY KEY,
  pedido_id VARCHAR(100) NOT NULL,
  origem VARCHAR(20) NOT NULL,
  status VARCHAR(50) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  payload JSONB,
  dados_completos JSONB,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- Permite múltiplos status por origem (histórico completo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_pedido_origem_status
  ON tracking_events(pedido_id, origem, status);

-- TABELA DE ANOMALIAS
CREATE TABLE IF NOT EXISTS anomalias (
  id SERIAL PRIMARY KEY,
  pedido_id VARCHAR(100) NOT NULL,
  tipo VARCHAR(50) NOT NULL,
  origem_falha VARCHAR(20),
  marketplace VARCHAR(50),
  tempo_atraso_horas INT,
  resolvida BOOLEAN DEFAULT FALSE,
  resolvida_em TIMESTAMP,
  criado_em TIMESTAMP DEFAULT NOW(),
  UNIQUE(pedido_id, tipo)
);

-- Garante colunas mesmo se a tabela ja existia sem elas
ALTER TABLE anomalias ADD COLUMN IF NOT EXISTS resolvida BOOLEAN DEFAULT FALSE;
ALTER TABLE anomalias ADD COLUMN IF NOT EXISTS resolvida_em TIMESTAMP;
ALTER TABLE anomalias ADD COLUMN IF NOT EXISTS tempo_atraso_horas INT;

-- Garante colunas em tracking_events
ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_pedido_id_origem_key;

-- Corrige tipos em pedidos_mapeamento se ja existia com BIGINT
ALTER TABLE pedidos_mapeamento ALTER COLUMN id_anymarket TYPE VARCHAR(50) USING id_anymarket::VARCHAR;
ALTER TABLE pedidos_mapeamento ALTER COLUMN id_jet TYPE VARCHAR(50) USING id_jet::VARCHAR;
ALTER TABLE pedidos_mapeamento ALTER COLUMN id_onclick TYPE VARCHAR(50) USING id_onclick::VARCHAR;

-- Corrige pedidos_items
ALTER TABLE pedidos_items DROP CONSTRAINT IF EXISTS fk_pedidos_items_pedido_id;
ALTER TABLE pedidos_items DROP CONSTRAINT IF EXISTS pedidos_items_pedido_id_fkey;
ALTER TABLE pedidos_items ALTER COLUMN pedido_id TYPE VARCHAR(100) USING pedido_id::VARCHAR;

-- TABELA DE MAPEAMENTO ENTRE PLATAFORMAS
CREATE TABLE IF NOT EXISTS pedidos_mapeamento (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_anymarket VARCHAR(50),
  id_jet VARCHAR(50),
  id_onclick VARCHAR(50),
  id_marketplace VARCHAR(100),
  numero_marketplace VARCHAR(100) NOT NULL UNIQUE,
  marketplace_origem VARCHAR(50),
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- TABELA DE PEDIDOS ANYMARKET
CREATE TABLE IF NOT EXISTS pedidos_anymarket (
  id VARCHAR(50) PRIMARY KEY,
  account_name VARCHAR(255),
  marketplace VARCHAR(50),
  marketplace_number VARCHAR(100),
  marketplace_id VARCHAR(100),
  buyer_name VARCHAR(255),
  buyer_email VARCHAR(255),
  buyer_document VARCHAR(20),
  buyer_document_type VARCHAR(10),
  buyer_phone VARCHAR(20),
  buyer_date_of_birth DATE,
  created_at TIMESTAMP,
  payment_date TIMESTAMP,
  last_update TIMESTAMP,
  status VARCHAR(50),
  marketplace_status VARCHAR(50),
  transmission_status VARCHAR(50),
  delivery_status VARCHAR(50),
  discount DECIMAL(10,2),
  freight DECIMAL(10,2),
  seller_freight DECIMAL(10,2),
  interest_value DECIMAL(10,2),
  gross DECIMAL(10,2),
  total DECIMAL(10,2),
  invoice_access_key VARCHAR(50),
  invoice_series VARCHAR(10),
  invoice_number VARCHAR(20),
  invoice_date TIMESTAMP,
  tracking_url TEXT,
  tracking_number VARCHAR(100),
  tracking_carrier VARCHAR(255),
  tracking_shipped_date TIMESTAMP,
  tracking_delivered_date TIMESTAMP,
  tracking_estimate_date TIMESTAMP,
  shipping_street VARCHAR(255),
  shipping_number VARCHAR(20),
  shipping_neighborhood VARCHAR(100),
  shipping_city VARCHAR(100),
  shipping_state VARCHAR(2),
  shipping_zip_code VARCHAR(10),
  shipping_country VARCHAR(2),
  shipping_receiver_name VARCHAR(255),
  shipping_promised_time TIMESTAMP,
  payment_method VARCHAR(50),
  payment_installments INT,
  commission_total DECIMAL(10,2),
  tax_total DECIMAL(10,2),
  delivery_id UUID,
  dados_completos JSONB,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- TABELA DE PEDIDOS JET
CREATE TABLE IF NOT EXISTS pedidos_jet (
  id VARCHAR(50) PRIMARY KEY,
  id_version INT,
  id_company INT,
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  customer_phone VARCHAR(20),
  created_at TIMESTAMP,
  event_occurred_at TIMESTAMP,
  status VARCHAR(50),
  total_amount DECIMAL(10,2),
  tracking_number VARCHAR(100),
  shipping_street VARCHAR(255),
  shipping_number VARCHAR(20),
  shipping_city VARCHAR(100),
  shipping_state VARCHAR(2),
  shipping_zip_code VARCHAR(10),
  dados_completos JSONB,
  criado_em TIMESTAMP DEFAULT NOW(),
  atualizado_em TIMESTAMP DEFAULT NOW()
);

-- TABELA DE ITENS DO PEDIDO
CREATE TABLE IF NOT EXISTS pedidos_items (
  id SERIAL PRIMARY KEY,
  pedido_id VARCHAR(100),
  origem VARCHAR(20),
  product_id VARCHAR(50),
  product_title VARCHAR(500),
  sku_id VARCHAR(50),
  sku_code VARCHAR(100),
  ean VARCHAR(20),
  quantidade INT,
  preco_unitario DECIMAL(10,2),
  desconto DECIMAL(10,2),
  total DECIMAL(10,2),
  criado_em TIMESTAMP DEFAULT NOW()
);

-- TABELA DE CONFIGURAÇÃO DE SLA
CREATE TABLE IF NOT EXISTS sla_config (
  id SERIAL PRIMARY KEY,
  marketplace VARCHAR(50) UNIQUE,
  tempo_maximo_horas INT,
  alerta_em_horas INT,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- TABELA DE LOGS
CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  nivel VARCHAR(20),
  mensagem TEXT,
  contexto JSONB,
  criado_em TIMESTAMP DEFAULT NOW()
);

-- ================================================================
-- ÍNDICES
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_tracking_pedido_id ON tracking_events(pedido_id);
CREATE INDEX IF NOT EXISTS idx_tracking_origem ON tracking_events(origem);
CREATE INDEX IF NOT EXISTS idx_tracking_timestamp ON tracking_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tracking_pedido_status ON tracking_events(pedido_id, status);
CREATE INDEX IF NOT EXISTS idx_tracking_dados_completos ON tracking_events USING GIN(dados_completos);

CREATE INDEX IF NOT EXISTS idx_anomalias_pedido_id ON anomalias(pedido_id);
CREATE INDEX IF NOT EXISTS idx_anomalias_tipo ON anomalias(tipo);
CREATE INDEX IF NOT EXISTS idx_anomalias_criado_em ON anomalias(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_anomalias_nao_resolvidas ON anomalias(resolvida, criado_em DESC) WHERE resolvida = FALSE;

CREATE INDEX IF NOT EXISTS idx_mapeamento_numero_marketplace ON pedidos_mapeamento(numero_marketplace);
CREATE INDEX IF NOT EXISTS idx_mapeamento_id_anymarket ON pedidos_mapeamento(id_anymarket);
CREATE INDEX IF NOT EXISTS idx_mapeamento_id_jet ON pedidos_mapeamento(id_jet);
CREATE INDEX IF NOT EXISTS idx_mapeamento_id_onclick ON pedidos_mapeamento(id_onclick);
CREATE INDEX IF NOT EXISTS idx_mapeamento_marketplace_origem ON pedidos_mapeamento(marketplace_origem);

CREATE INDEX IF NOT EXISTS idx_pedidos_anymarket_status ON pedidos_anymarket(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_anymarket_created_at ON pedidos_anymarket(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_anymarket_marketplace ON pedidos_anymarket(marketplace);
CREATE INDEX IF NOT EXISTS idx_pedidos_anymarket_dados_completos ON pedidos_anymarket USING GIN(dados_completos);

CREATE INDEX IF NOT EXISTS idx_pedidos_jet_status ON pedidos_jet(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_jet_created_at ON pedidos_jet(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_jet_dados_completos ON pedidos_jet USING GIN(dados_completos);

CREATE INDEX IF NOT EXISTS idx_pedidos_items_pedido_id ON pedidos_items(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_items_origem ON pedidos_items(origem);
CREATE INDEX IF NOT EXISTS idx_pedidos_items_sku_code ON pedidos_items(sku_code);

CREATE INDEX IF NOT EXISTS idx_logs_criado_em ON logs(criado_em DESC);