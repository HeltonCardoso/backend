-- ================================================================
-- 004-add-tracking-improvements.sql
-- Melhorias no tracking e anomalias
-- ================================================================

-- Adicionar colunas de SLA no tracking_events
ALTER TABLE tracking_events 
ADD COLUMN IF NOT EXISTS sla_calculado VARCHAR(20),
ADD COLUMN IF NOT EXISTS tempo_decorrido_horas DECIMAL(5,2);

-- Criar função para calcular SLA automaticamente nos eventos
CREATE OR REPLACE FUNCTION calcular_sla_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_created_at TIMESTAMP;
BEGIN
    -- Busca data de criação do pedido
    SELECT a.created_at INTO v_created_at
    FROM pedidos_anymarket a
    WHERE a.id = NEW.pedido_id;
    
    IF v_created_at IS NOT NULL THEN
        NEW.tempo_decorrido_horas := EXTRACT(EPOCH FROM (NEW.timestamp - v_created_at))/3600;
        
        IF NEW.tempo_decorrido_horas >= 48 THEN
            NEW.sla_calculado := 'critical';
        ELSIF NEW.tempo_decorrido_horas >= 36 THEN
            NEW.sla_calculado := 'warning';
        ELSE
            NEW.sla_calculado := 'ok';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_calcular_sla ON tracking_events;
CREATE TRIGGER trigger_calcular_sla
    BEFORE INSERT ON tracking_events
    FOR EACH ROW
    EXECUTE FUNCTION calcular_sla_trigger();

-- Criar função para detectar anomalias automaticamente
CREATE OR REPLACE FUNCTION detectar_anomalias_trigger()
RETURNS TRIGGER AS $$
DECLARE
    v_ultimo_evento RECORD;
    v_tempo_parado INTEGER;
BEGIN
    -- Verifica se o pedido está parado há mais de 2 horas
    SELECT timestamp INTO v_ultimo_evento
    FROM tracking_events
    WHERE pedido_id = NEW.pedido_id
    AND origem = NEW.origem
    AND timestamp < NEW.timestamp
    ORDER BY timestamp DESC
    LIMIT 1;
    
    IF v_ultimo_evento.timestamp IS NOT NULL THEN
        v_tempo_parado := EXTRACT(EPOCH FROM (NEW.timestamp - v_ultimo_evento.timestamp))/3600;
        
        -- Se passou mais de 2h sem avançar, cria anomalia
        IF v_tempo_parado >= 2 AND NEW.status NOT IN ('DELIVERED', 'CANCELED') THEN
            INSERT INTO anomalias (pedido_id, tipo, origem_falha, criado_em)
            VALUES (NEW.pedido_id, 'PARADO_SEM_EVOLUCAO', NEW.origem, NOW())
            ON CONFLICT (pedido_id, tipo) DO NOTHING;
        END IF;
    END IF;
    
    -- Se chegou ao fim, resolve anomalias
    IF NEW.status IN ('DELIVERED', 'INVOICED') THEN
        UPDATE anomalias 
        SET resolvida = TRUE, resolvida_em = NOW()
        WHERE pedido_id = NEW.pedido_id 
        AND resolvida = FALSE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger
DROP TRIGGER IF EXISTS trigger_detectar_anomalias ON tracking_events;
CREATE TRIGGER trigger_detectar_anomalias
    AFTER INSERT ON tracking_events
    FOR EACH ROW
    EXECUTE FUNCTION detectar_anomalias_trigger();

-- View para monitoramento em tempo real
CREATE OR REPLACE VIEW monitoramento_tempo_real AS
SELECT 
    m.numero_marketplace,
    m.marketplace_origem,
    m.id_anymarket,
    m.id_jet,
    m.id_onclick,
    a.created_at as data_criacao,
    a.total as valor_pedido,
    a.status as status_anymarket,
    j.status as status_jet,
    (
        SELECT status FROM tracking_events t2 
        WHERE t2.pedido_id = m.numero_marketplace 
        ORDER BY t2.timestamp DESC LIMIT 1
    ) as ultimo_status,
    (
        SELECT timestamp FROM tracking_events t2 
        WHERE t2.pedido_id = m.numero_marketplace 
        ORDER BY t2.timestamp DESC LIMIT 1
    ) as ultima_atualizacao,
    EXTRACT(EPOCH FROM (NOW() - a.created_at))/3600 as horas_decorridas,
    CASE 
        WHEN EXTRACT(EPOCH FROM (NOW() - a.created_at))/3600 >= 48 THEN 'critical'
        WHEN EXTRACT(EPOCH FROM (NOW() - a.created_at))/3600 >= 36 THEN 'warning'
        ELSE 'ok'
    END as sla_status,
    EXISTS(SELECT 1 FROM anomalias an WHERE an.pedido_id = m.numero_marketplace AND an.resolvida = FALSE) as tem_anomalia
FROM pedidos_mapeamento m
LEFT JOIN pedidos_anymarket a ON m.id_anymarket = a.id
LEFT JOIN pedidos_jet j ON m.id_jet = j.id
WHERE a.created_at > NOW() - INTERVAL '30 days';