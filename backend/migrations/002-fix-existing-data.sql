-- ================================================================
-- 002-fix-existing-data.sql
-- Corrige banco que já existe com o schema antigo
-- Roda apenas uma vez (controlado pela tabela migrations_executadas)
-- ================================================================

-- Corrigir tipos de ID em pedidos_mapeamento
ALTER TABLE pedidos_mapeamento
  ALTER COLUMN id_anymarket TYPE VARCHAR(50) USING id_anymarket::VARCHAR,
  ALTER COLUMN id_jet TYPE VARCHAR(50) USING id_jet::VARCHAR,
  ALTER COLUMN id_onclick TYPE VARCHAR(50) USING id_onclick::VARCHAR;

-- Corrigir pedidos_items: remover FK e corrigir tipo do pedido_id
ALTER TABLE pedidos_items
  DROP CONSTRAINT IF EXISTS fk_pedidos_items_pedido_id;

ALTER TABLE pedidos_items
  ALTER COLUMN pedido_id TYPE VARCHAR(100) USING pedido_id::VARCHAR,
  ALTER COLUMN product_id TYPE VARCHAR(50) USING product_id::VARCHAR,
  ALTER COLUMN sku_id TYPE VARCHAR(50) USING sku_id::VARCHAR;

-- Corrigir pedidos_anymarket: id de BIGINT para VARCHAR
ALTER TABLE pedidos_anymarket
  ALTER COLUMN id TYPE VARCHAR(50) USING id::VARCHAR;

-- Corrigir tracking_events: substituir UNIQUE(pedido_id, origem) por (pedido_id, origem, status)
ALTER TABLE tracking_events
  DROP CONSTRAINT IF EXISTS tracking_events_pedido_id_origem_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_pedido_origem_status
  ON tracking_events(pedido_id, origem, status);

-- Adicionar colunas de resolução em anomalias
ALTER TABLE anomalias
  ADD COLUMN IF NOT EXISTS resolvida BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS resolvida_em TIMESTAMP;

-- Índice para anomalias não resolvidas
CREATE INDEX IF NOT EXISTS idx_anomalias_nao_resolvidas
  ON anomalias(resolvida, criado_em DESC)
  WHERE resolvida = FALSE;

-- Limpar anomalias falsas de pedidos que já integraram na JET
DELETE FROM anomalias a
WHERE a.tipo = 'NAO_INTEGROU_JET'
AND EXISTS (
  SELECT 1 FROM tracking_events t
  WHERE t.pedido_id = a.pedido_id
  AND t.origem = 'JET'
);

-- Índice extra de performance para checkPipelineStatus
CREATE INDEX IF NOT EXISTS idx_tracking_pedido_status
  ON tracking_events(pedido_id, status);