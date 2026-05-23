-- ================================================================
-- 003-add-monitoring-tables.sql
-- Adiciona tabelas para o novo sistema de monitoramento
-- Mantendo compatibilidade com as tabelas existentes
-- ================================================================

-- TABELA DE BACKFILL RUNS (histórico de importações)
CREATE TABLE IF NOT EXISTS backfill_runs (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,           -- anymarket|jet
    started_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running',  -- running|done|error|partial
    total_found INTEGER DEFAULT 0,
    inserted INTEGER DEFAULT 0,
    updated INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    last_offset INTEGER DEFAULT 0,
    date_from DATE,
    date_to DATE,
    error TEXT,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backfill_runs_status ON backfill_runs(status);
CREATE INDEX IF NOT EXISTS idx_backfill_runs_started ON backfill_runs(started_at DESC);

-- TABELA DE WEBHOOK LOG
CREATE TABLE IF NOT EXISTS webhook_log (
    id SERIAL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,           -- anymarket|jet
    event_type VARCHAR(100),
    payload JSONB,
    processed INTEGER DEFAULT 0,
    error TEXT,
    received_at TIMESTAMP NOT NULL,
    criado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_log_source ON webhook_log(source);
CREATE INDEX IF NOT EXISTS idx_webhook_log_received ON webhook_log(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_log_processed ON webhook_log(processed);

-- TABELA DE METRICS (para dashboard)
CREATE TABLE IF NOT EXISTS metrics_diarias (
    id SERIAL PRIMARY KEY,
    data DATE NOT NULL UNIQUE,
    total_pedidos INTEGER DEFAULT 0,
    pedidos_concluidos INTEGER DEFAULT 0,
    pedidos_atrasados INTEGER DEFAULT 0,
    tempo_medio_horas DECIMAL(5,2),
    taxa_conversao DECIMAL(5,2),
    criado_em TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_data ON metrics_diarias(data DESC);

-- VIEW PARA DASHBOARD (consolidada)
CREATE OR REPLACE VIEW dashboard_resumo AS
SELECT 
    COUNT(DISTINCT m.numero_marketplace) as total_pedidos,
    COUNT(DISTINCT CASE WHEN t.status = 'DELIVERED' OR t.status = 'ok' THEN m.numero_marketplace END) as concluidos,
    COUNT(DISTINCT CASE WHEN t.status NOT IN ('DELIVERED', 'ok', 'CANCELED', 'cancelled') 
        AND t.timestamp < NOW() - INTERVAL '48 hours' THEN m.numero_marketplace END) as atrasados_critico,
    COUNT(DISTINCT CASE WHEN t.status NOT IN ('DELIVERED', 'ok', 'CANCELED', 'cancelled') 
        AND t.timestamp < NOW() - INTERVAL '36 hours' 
        AND t.timestamp >= NOW() - INTERVAL '48 hours' THEN m.numero_marketplace END) as atrasados_atencao,
    COUNT(DISTINCT CASE WHEN t.origem = 'ANYMARKET' AND t.status NOT IN ('INVOICED', 'DELIVERED') 
        AND t.timestamp < NOW() - INTERVAL '2 hours' THEN m.numero_marketplace END) as presos_anymarket,
    COUNT(DISTINCT CASE WHEN t.origem = 'JET' AND t.status NOT IN ('BILLED', 'DELIVERED') 
        AND t.timestamp < NOW() - INTERVAL '2 hours' THEN m.numero_marketplace END) as presos_jet
FROM pedidos_mapeamento m
LEFT JOIN tracking_events t ON m.numero_marketplace = t.pedido_id
WHERE t.timestamp = (
    SELECT MAX(timestamp) FROM tracking_events t2 
    WHERE t2.pedido_id = t.pedido_id
);

-- FUNÇÃO PARA RECALCULAR SLA
CREATE OR REPLACE FUNCTION recalcular_sla_pedido(p_pedido_id VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    v_created_at TIMESTAMP;
    v_horas_passadas INTEGER;
    v_sla VARCHAR;
BEGIN
    -- Pega data de criação do pedido
    SELECT created_at INTO v_created_at 
    FROM pedidos_anymarket 
    WHERE id = p_pedido_id;
    
    IF v_created_at IS NULL THEN
        RETURN 'ok';
    END IF;
    
    v_horas_passadas := EXTRACT(EPOCH FROM (NOW() - v_created_at))/3600;
    
    IF v_horas_passadas >= 48 THEN
        v_sla := 'critical';
    ELSIF v_horas_passadas >= 36 THEN
        v_sla := 'warning';
    ELSE
        v_sla := 'ok';
    END IF;
    
    RETURN v_sla;
END;
$$ LANGUAGE plpgsql;

-- FUNCTION PARA ATUALIZAR METRICS DIÁRIAS
CREATE OR REPLACE FUNCTION atualizar_metrics_diarias()
RETURNS void AS $$
DECLARE
    v_hoje DATE := CURRENT_DATE;
    v_total INTEGER;
    v_concluidos INTEGER;
    v_atrasados INTEGER;
    v_tempo_medio DECIMAL(5,2);
BEGIN
    -- Calcula métricas
    SELECT 
        COUNT(DISTINCT m.numero_marketplace),
        COUNT(DISTINCT CASE WHEN t.status = 'DELIVERED' OR t.status = 'ok' THEN m.numero_marketplace END),
        COUNT(DISTINCT CASE WHEN t.status NOT IN ('DELIVERED', 'ok', 'CANCELED') 
            AND t.timestamp < NOW() - INTERVAL '36 hours' THEN m.numero_marketplace END),
        AVG(EXTRACT(EPOCH FROM (t.timestamp - a.created_at))/3600)
    INTO v_total, v_concluidos, v_atrasados, v_tempo_medio
    FROM pedidos_mapeamento m
    LEFT JOIN tracking_events t ON m.numero_marketplace = t.pedido_id
    LEFT JOIN pedidos_anymarket a ON m.id_anymarket = a.id
    WHERE DATE(a.created_at) = v_hoje;
    
    -- Insere ou atualiza
    INSERT INTO metrics_diarias (data, total_pedidos, pedidos_concluidos, pedidos_atrasados, tempo_medio_horas, taxa_conversao)
    VALUES (v_hoje, COALESCE(v_total, 0), COALESCE(v_concluidos, 0), COALESCE(v_atrasados, 0), v_tempo_medio, 
            CASE WHEN v_total > 0 THEN (v_concluidos::DECIMAL / v_total) * 100 ELSE 0 END)
    ON CONFLICT (data) DO UPDATE SET
        total_pedidos = EXCLUDED.total_pedidos,
        pedidos_concluidos = EXCLUDED.pedidos_concluidos,
        pedidos_atrasados = EXCLUDED.pedidos_atrasados,
        tempo_medio_horas = EXCLUDED.tempo_medio_horas,
        taxa_conversao = EXCLUDED.taxa_conversao,
        atualizado_em = NOW();
END;
$$ LANGUAGE plpgsql;