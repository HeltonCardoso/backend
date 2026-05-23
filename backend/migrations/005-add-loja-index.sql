-- 005-add-loja-index.sql
-- Índice para consultas por loja

CREATE INDEX IF NOT EXISTS idx_mapeamento_loja ON pedidos_mapeamento(loja);

-- Índice composto para consultas comuns
CREATE INDEX IF NOT EXISTS idx_mapeamento_marketplace_loja ON pedidos_mapeamento(marketplace_origem, loja);