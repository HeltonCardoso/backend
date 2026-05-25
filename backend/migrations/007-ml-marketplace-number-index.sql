-- migrations/003-ml-marketplace-number-index.sql
--
-- Cria índice funcional no campo marketplace_number dentro de dados_completos
-- para acelerar a busca de pedidos ML pelo número do pedido (2000...) na comparação de planilhas.
-- O índice GIN genérico já existe, mas este índice de expressão é mais rápido para este caso específico.
 
CREATE INDEX IF NOT EXISTS idx_tracking_ml_marketplace_number
  ON tracking_events ((dados_completos->>'marketplace_number'))
  WHERE origem = 'ANYMARKET'
    AND dados_completos->>'marketplace_number' IS NOT NULL;
 
CREATE INDEX IF NOT EXISTS idx_tracking_ml_numero_marketplace
  ON tracking_events ((dados_completos->>'numero_marketplace'))
  WHERE origem = 'ANYMARKET'
    AND dados_completos->>'numero_marketplace' IS NOT NULL;