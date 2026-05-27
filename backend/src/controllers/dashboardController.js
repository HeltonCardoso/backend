// backend/src/controllers/dashboardController.js
const pool = require('../../config/database');

const DESCRICAO_ANOMALIA = {
  NAO_INTEGROU_JET:     'Pedido não chegou na JET dentro do prazo',
  NAO_FATUROU_ONCLICK:  'JET integrou mas Onclick não faturou',
  FATUROU_NAO_RETORNOU: 'Onclick faturou mas JET não confirmou envio',
  FATURADO_APOS_ENVIO:  'AnyMarket ficou como Faturado após envio',
  ENVIADO_SEM_FATURAMENTO: 'JET enviou sem confirmação de faturamento',
  TRAVADO:              'Pedido sem atualização por mais de 1 hora',
  NAO_ENTROU_ONCLICK:   'JET integrou mas pedido não entrou na Onclick',
  PROXIMO_PRAZO_ENVIO:  'Pedido próximo do prazo de despacho',
  ATRASO_ENVIO_PRAZO:   'Pedido ULTRAPASSOU o prazo de despacho'
};

const DashboardController = {

  async getMetricasGerais(req, res) {
    try {
      // CORRIGIDO: Ordem correta do pipeline baseada no nível de progresso
      const origemResult = await pool.query(`
        WITH niveis_origem AS (
          SELECT DISTINCT ON (te.pedido_id)
            te.pedido_id,
            CASE 
              -- Prioridade: maior número = mais avançado
              -- Ordem correta do fluxo: ANYMARKET(1) → JET(2) → ONCLICK(3) → RETORNO_JET(4) → RETORNO_ANYMARKET(5)
              WHEN te.origem = 'RETORNO_ANYMARKET' THEN 5
              WHEN te.origem = 'RETORNO_JET' THEN 4
              WHEN te.origem = 'ONCLICK' THEN 3
              WHEN te.origem = 'JET' THEN 2
              WHEN te.origem = 'ANYMARKET' THEN 1
              ELSE 0
            END as prioridade,
            te.origem as origem_atual
          FROM tracking_events te
          WHERE te.pedido_id NOT IN (
            SELECT pedido_id FROM tracking_events 
            WHERE origem = 'ANYMARKET' 
            AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
          )
          ORDER BY te.pedido_id, prioridade DESC, te.timestamp DESC
        )
        SELECT 
          origem_atual as origem,
          COUNT(*) as total
        FROM niveis_origem
        WHERE origem_atual IS NOT NULL
        GROUP BY origem_atual
      `);
      
      // Garantir que TODAS as origens existam no objeto (mesmo com 0)
      const metricas = { 
        ANYMARKET: 0, 
        JET: 0, 
        ONCLICK: 0, 
        RETORNO_JET: 0,
        RETORNO_ANYMARKET: 0
      };
      
      origemResult.rows.forEach(r => { 
        metricas[r.origem] = parseInt(r.total); 
      });

      const anomaliasResult = await pool.query(
        `SELECT COUNT(*) AS total FROM anomalias WHERE resolvida = false`
      );
      const anomaliasNaoResolvidas = parseInt(anomaliasResult.rows[0].total);

      const pipelineResult = await pool.query(`
        WITH ultimo_estagio AS (
          SELECT DISTINCT ON (te.pedido_id)
            te.pedido_id,
            te.origem,
            te.status,
            te.timestamp
          FROM tracking_events te
          WHERE te.pedido_id NOT IN (
            SELECT pedido_id FROM tracking_events 
            WHERE origem = 'ANYMARKET' 
            AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
          )
          ORDER BY te.pedido_id, te.timestamp DESC
        )
        SELECT origem as estagio, COUNT(*) as total
        FROM ultimo_estagio
        GROUP BY origem
        ORDER BY 
          CASE 
            WHEN origem = 'ANYMARKET' THEN 1
            WHEN origem = 'JET' THEN 2
            WHEN origem = 'ONCLICK' THEN 3
            WHEN origem = 'RETORNO_JET' THEN 4
            WHEN origem = 'RETORNO_ANYMARKET' THEN 5
            ELSE 6
          END
      `);
      
      const porEstagio = {};
      pipelineResult.rows.forEach(r => { porEstagio[r.estagio] = parseInt(r.total); });

      const travadosResult = await pool.query(`
        WITH ultimo_evento AS (
          SELECT DISTINCT ON (te.pedido_id)
            te.pedido_id, 
            te.origem, 
            te.status, 
            te.timestamp,
            pm.prazo_despacho
          FROM tracking_events te
          LEFT JOIN pedidos_mapeamento pm ON te.pedido_id = pm.numero_marketplace
          ORDER BY te.pedido_id, te.timestamp DESC
        ),
        pedidos_finalizados AS (
          SELECT pedido_id FROM tracking_events
          WHERE origem = 'ANYMARKET' 
          AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
        ),
        pedidos_completos AS (
          SELECT pedido_id FROM tracking_events
          WHERE origem = 'RETORNO_ANYMARKET'
        )
        SELECT COUNT(*) as total
        FROM ultimo_evento u
        WHERE u.pedido_id NOT IN (SELECT pedido_id FROM pedidos_finalizados)
          AND u.pedido_id NOT IN (SELECT pedido_id FROM pedidos_completos)
          AND u.origem NOT IN ('RETORNO_ANYMARKET','RETORNO_MARKETPLACE')
          AND u.status NOT IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
          AND (
            (u.prazo_despacho IS NOT NULL AND NOW() > u.prazo_despacho)
            OR
            (u.prazo_despacho IS NULL AND u.timestamp < NOW() - INTERVAL '1 hour')
          )
      `);
      const pedidosTravados = parseInt(travadosResult.rows[0].total);

      const marketplaceResult = await pool.query(`
        SELECT 
          pm.marketplace_origem as marketplace,
          COUNT(DISTINCT te.pedido_id) as total
        FROM tracking_events te
        JOIN pedidos_mapeamento pm ON te.pedido_id = pm.numero_marketplace
        WHERE te.criado_em >= NOW() - INTERVAL '24 hours'
          AND te.origem = 'ANYMARKET'
          AND pm.marketplace_origem IS NOT NULL
          AND te.status NOT IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
        GROUP BY pm.marketplace_origem
        ORDER BY total DESC
      `);

      const anymarketNaoFinalizados = await pool.query(`
        SELECT COUNT(DISTINCT pedido_id) as total
        FROM tracking_events
        WHERE origem = 'ANYMARKET'
          AND pedido_id NOT IN (
            SELECT pedido_id FROM tracking_events 
            WHERE origem = 'ANYMARKET' 
            AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
          )
      `);
      
      const jetNaoFinalizados = await pool.query(`
        SELECT COUNT(DISTINCT pedido_id) as total
        FROM tracking_events
        WHERE origem = 'JET'
          AND pedido_id NOT IN (
            SELECT pedido_id FROM tracking_events 
            WHERE origem = 'ANYMARKET' 
            AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
          )
      `);
      
      const totalAnymarketAtivos = parseInt(anymarketNaoFinalizados.rows[0].total) || 0;
      const totalJetAtivos = parseInt(jetNaoFinalizados.rows[0].total) || 0;
      const taxaSync = totalAnymarketAtivos > 0
        ? ((totalJetAtivos / totalAnymarketAtivos) * 100).toFixed(1)
        : 0;

      const pedidos24hResult = await pool.query(`
        SELECT COUNT(DISTINCT te.pedido_id) as total
        FROM tracking_events te
        WHERE te.criado_em >= NOW() - INTERVAL '24 hours'
          AND te.origem = 'ANYMARKET'
          AND te.pedido_id NOT IN (
            SELECT pedido_id FROM tracking_events 
            WHERE origem = 'ANYMARKET' 
            AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
          )
      `);

      res.json({
        success: true,
        data: {
          metricas,
          anomaliasNaoResolvidas,
          pedidosTravados,
          porEstagio,
          taxaSincronizacaoJet: parseFloat(taxaSync),
          pedidos24h: parseInt(pedidos24hResult.rows[0].total),
          porMarketplace: marketplaceResult.rows
        }
      });
    } catch (error) {
      console.error('Erro getMetricasGerais:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async getAnomalias(req, res) {
    try {
      const { limit = 20, resolvida } = req.query;
      const params = [];
      let where = 'WHERE 1=1';
      if (resolvida !== undefined) {
        params.push(resolvida === 'true');
        where += ` AND resolvida = $${params.length}`;
      }
      params.push(parseInt(limit));
      const result = await pool.query(`
        SELECT id, pedido_id, tipo, origem_falha, marketplace, criado_em, resolvida
        FROM anomalias
        ${where}
        ORDER BY criado_em DESC
        LIMIT $${params.length}
      `, params);

      const anomalias = result.rows.map(a => ({
        ...a,
        descricao: DESCRICAO_ANOMALIA[a.tipo] || a.tipo
      }));

      res.json({ success: true, anomalias });
    } catch (error) {
      console.error('Erro getAnomalias:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async getPedidosPipeline(req, res) {
    try {
      const { page = 1, limit = 20, marketplace, travados, loja, sort, quickFilter } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // ── Filtros base: exclui pedidos finalizados ───────────────────
      let baseWhere = `WHERE te.origem IN ('ANYMARKET','JET','ONCLICK','RETORNO_JET','RETORNO_ANYMARKET')
        AND te.pedido_id NOT IN (
          SELECT pedido_id FROM tracking_events
          WHERE origem = 'ANYMARKET'
          AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
        )`;
      const params = [];

      if (marketplace) {
        params.push(marketplace);
        baseWhere += ` AND pm.marketplace_origem = $${params.length}`;
      }

      if (loja) {
        params.push(loja);
        baseWhere += ` AND pm.loja = $${params.length}`;
      }

      // ── Filtro "fora do prazo" aplicado no CTE externo ────────────
      // Caso 1: tem prazo e já venceu
      // Caso 2: não tem prazo e está sem update há mais de 1h
      // (os dois são OR — qualquer um já caracteriza "fora do prazo")
      const travadosFiltro = travados === 'true'
        ? `AND (
             (prazo_despacho IS NOT NULL AND prazo_despacho < NOW())
             OR
             (prazo_despacho IS NULL AND horas_sem_update > 1)
           )`
        : '';

      // ── Quick filters dos contadores clicáveis ─────────────────────
      const quickFilterClause = {
        foraPrazo: `AND (
                      (prazo_despacho IS NOT NULL AND prazo_despacho < NOW())
                      OR (prazo_despacho IS NULL AND horas_sem_update > 1)
                    )`,
        urgentes:  `AND prazo_despacho IS NOT NULL
                    AND prazo_despacho >= NOW()
                    AND prazo_despacho < NOW() + INTERVAL '24 hours'`,
        semPrazo:  `AND prazo_despacho IS NULL`,
      }[quickFilter] || '';

      // ── Ordenação ─────────────────────────────────────────────────
      // prazo_asc  → urgentes/atrasados primeiro (menor horas_ate_prazo, negativos sobem)
      // prazo_desc → mais atrasados primeiro (idem — valor mais negativo = mais atrasado)
      // parado_desc → parado há mais tempo primeiro
      const orderBy = {
        prazo_asc:   'horas_ate_prazo ASC NULLS LAST',
        prazo_desc:  'horas_ate_prazo ASC NULLS LAST',
        parado_desc: 'horas_sem_update DESC NULLS LAST',
      }[sort] || 'ultimo_evento DESC NULLS LAST';

      // ── Query principal com paginação ──────────────────────────────
      const pedidosQuery = `
        WITH eventos_pedido AS (
          SELECT
            te.pedido_id,
            ARRAY_AGG(DISTINCT te.origem) AS origens,
            MAX(te.timestamp)             AS ultimo_evento,
            MIN(te.timestamp)             AS primeiro_evento,
            pm.marketplace_origem         AS marketplace,
            pm.loja,
            pm.id_anymarket,
            pm.id_jet,
            pm.id_onclick,
            pm.prazo_despacho,
            EXTRACT(EPOCH FROM (NOW() - MAX(te.timestamp))) / 3600          AS horas_sem_update,
            CASE
              WHEN pm.prazo_despacho IS NOT NULL
              THEN EXTRACT(EPOCH FROM (pm.prazo_despacho - NOW())) / 3600
              ELSE NULL
            END AS horas_ate_prazo
          FROM tracking_events te
          LEFT JOIN pedidos_mapeamento pm ON te.pedido_id = pm.numero_marketplace
          ${baseWhere}
          GROUP BY te.pedido_id, pm.marketplace_origem, pm.loja,
                   pm.id_anymarket, pm.id_jet, pm.id_onclick, pm.prazo_despacho
        )
        SELECT *
        FROM eventos_pedido
        WHERE 1=1
          ${travadosFiltro}
          ${quickFilterClause}
        ORDER BY ${orderBy}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      // ── Query de contagem total (com os mesmos filtros, sem paginação) ──
      // Retorna também os totais para a barra de resumo do frontend.
      const countQuery = `
        WITH eventos_pedido AS (
          SELECT
            te.pedido_id,
            pm.prazo_despacho,
            EXTRACT(EPOCH FROM (NOW() - MAX(te.timestamp))) / 3600 AS horas_sem_update
          FROM tracking_events te
          LEFT JOIN pedidos_mapeamento pm ON te.pedido_id = pm.numero_marketplace
          ${baseWhere}
          GROUP BY te.pedido_id, pm.prazo_despacho
        )
        SELECT
          COUNT(*)                                                        AS total,
          COUNT(*) FILTER (
            WHERE (prazo_despacho IS NOT NULL AND prazo_despacho < NOW())
               OR (prazo_despacho IS NULL AND horas_sem_update > 1)
          )                                                               AS fora_prazo,
          COUNT(*) FILTER (
            WHERE prazo_despacho IS NOT NULL
              AND prazo_despacho >= NOW()
              AND prazo_despacho < NOW() + INTERVAL '24 hours'
          )                                                               AS urgentes,
          COUNT(*) FILTER (WHERE prazo_despacho IS NULL)                 AS sem_prazo
        FROM eventos_pedido
        WHERE 1=1
          ${travadosFiltro}
          ${quickFilterClause}
      `;

      params.push(parseInt(limit), offset);

      const [pedidosResult, countResult] = await Promise.all([
        pool.query(pedidosQuery, params),
        pool.query(countQuery, params.slice(0, -2)),  // sem limit/offset
      ]);

      const totais = countResult.rows[0];
      const total  = parseInt(totais.total);

      res.json({
        success: true,
        pedidos: pedidosResult.rows,
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        // Totais globais do filtro — usados na barra de resumo do frontend
        summary: {
          total,
          foraPrazo: parseInt(totais.fora_prazo),
          urgentes:  parseInt(totais.urgentes),
          semPrazo:  parseInt(totais.sem_prazo),
        },
      });
    } catch (error) {
      console.error('Erro getPedidosPipeline:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async getPedidoDetalhes(req, res) {
    try {
      const { numeroMarketplace } = req.params;
      const [mapeamento, events, anomalias] = await Promise.all([
        pool.query(`SELECT * FROM pedidos_mapeamento WHERE numero_marketplace = $1`, [numeroMarketplace]),
        pool.query(`SELECT * FROM tracking_events WHERE pedido_id = $1 ORDER BY timestamp ASC`, [numeroMarketplace]),
        pool.query(`SELECT * FROM anomalias WHERE pedido_id = $1 ORDER BY criado_em DESC`, [numeroMarketplace])
      ]);

      const anomaliasComDescricao = anomalias.rows.map(a => ({
        ...a,
        descricao: DESCRICAO_ANOMALIA[a.tipo] || a.tipo
      }));

      res.json({
        success: true,
        mapeamento: mapeamento.rows[0] || null,
        events: events.rows,
        anomalias: anomaliasComDescricao
      });
    } catch (error) {
      console.error('Erro getPedidoDetalhes:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async getGraficoStatusPorPlataforma(req, res) {
    try {
      const [statusResult, marketplaceResult, volumeResult] = await Promise.all([
        pool.query(`
          SELECT origem, status, COUNT(DISTINCT pedido_id) AS total
          FROM tracking_events
          WHERE origem IN ('ANYMARKET','JET','ONCLICK')
            AND pedido_id NOT IN (
              SELECT pedido_id FROM tracking_events 
              WHERE origem = 'ANYMARKET' 
              AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
            )
          GROUP BY origem, status ORDER BY origem, total DESC
        `),
        pool.query(`
          SELECT pm.marketplace_origem as marketplace, COUNT(DISTINCT pm.numero_marketplace) as total
          FROM pedidos_mapeamento pm
          WHERE pm.marketplace_origem IS NOT NULL
            AND pm.numero_marketplace NOT IN (
              SELECT pedido_id FROM tracking_events 
              WHERE origem = 'ANYMARKET' 
              AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
            )
          GROUP BY pm.marketplace_origem ORDER BY total DESC
        `),
        pool.query(`
          SELECT 
            DATE_TRUNC('hour', timestamp) as hora,
            COUNT(DISTINCT pedido_id) as total
          FROM tracking_events
          WHERE origem = 'ANYMARKET'
            AND timestamp >= NOW() - INTERVAL '24 hours'
            AND pedido_id NOT IN (
              SELECT pedido_id FROM tracking_events 
              WHERE origem = 'ANYMARKET' 
              AND status IN ('ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED')
            )
          GROUP BY hora ORDER BY hora ASC
        `)
      ]);

      const grouped = { ANYMARKET: [], JET: [], ONCLICK: [] };
      statusResult.rows.forEach(r => {
        if (grouped[r.origem]) grouped[r.origem].push({ status: r.status, total: parseInt(r.total) });
      });

      res.json({
        success: true,
        porStatus: grouped,
        porMarketplace: marketplaceResult.rows,
        volumeHoras: volumeResult.rows
      });
    } catch (error) {
      console.error('Erro getGraficoStatusPorPlataforma:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async resolverAnomalia(req, res) {
    try {
      const { id } = req.params;
      await pool.query(
        `UPDATE anomalias SET resolvida = true, resolvida_em = NOW() WHERE id = $1`,
        [id]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Erro resolverAnomalia:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
};

module.exports = DashboardController;