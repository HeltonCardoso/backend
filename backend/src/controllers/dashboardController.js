// backend/src/controllers/dashboardController.js
const pool = require('../../config/database');

const DESCRICAO_ANOMALIA = {
  NAO_INTEGROU_JET: 'Pedido não chegou na JET dentro do prazo (30min)',
  NAO_ENTROU_ONCLICK: 'JET integrou mas Onclick não processou (1h)',
  FATURADO_APOS_ENVIO: 'AnyMarket travado em faturado',
  ENVIADO_SEM_PRODUCAO: 'JET enviou sem confirmação de produção',
  PROXIMO_PRAZO_ENVIO: 'Pedido próximo do prazo de despacho',
  ATRASO_ENVIO_PRAZO: 'Pedido ULTRAPASSOU o prazo de despacho',
  PARADO_SEM_EVOLUCAO: 'Pedido sem atualização há mais que o prazo de preparação',
  RETORNO_JET_SEM_CONFIRMACAO_ANYMARKET: 'JET enviou mas AnyMarket não confirmou',
  ONCLICK_FATUROU_SEM_RETORNO_JET: 'ONCLICK faturou mas JET não confirmou envio',
  ATRASO_PRAZO_PREPARACAO: 'Pedido atrasado no prazo de preparação',
  PROXIMO_PRAZO_PREPARACAO: 'Pedido próximo do prazo de preparação',
  DEMOROU_PARA_PRODUZIR: 'Pedido demorou mais de 2h para entrar em produção',
  PRODUCAO_DEMORADA: 'Pedido em produção há mais de 48h',
  PEDIDO_TRAVADO_JET: 'Pedido travado na JET há mais de 72h'
};

const DashboardController = {

  async getMetricasGerais(req, res) {
    try {
      // Pipeline stages
      const origemResult = await pool.query(`
        WITH niveis_origem AS (
          SELECT DISTINCT ON (te.pedido_id)
            te.pedido_id,
            CASE 
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
        SELECT origem_atual as origem, COUNT(*) as total
        FROM niveis_origem
        WHERE origem_atual IS NOT NULL
        GROUP BY origem_atual
      `);
      
      const metricas = { ANYMARKET: 0, JET: 0, ONCLICK: 0, RETORNO_JET: 0, RETORNO_ANYMARKET: 0 };
      origemResult.rows.forEach(r => { metricas[r.origem] = parseInt(r.total); });

      // Anomalias por tipo
      const anomaliasPorTipo = await pool.query(`
        SELECT tipo, COUNT(*) as total
        FROM anomalias 
        WHERE resolvida = false
        GROUP BY tipo
      `);
      
      const anomaliasMap = {};
      anomaliasPorTipo.rows.forEach(r => { anomaliasMap[r.tipo] = parseInt(r.total); });
      
      const anomaliasDetalhadas = {
        nao_integrou_jet: anomaliasMap['NAO_INTEGROU_JET'] || 0,
        nao_entrou_onclick: anomaliasMap['NAO_ENTROU_ONCLICK'] || 0,
        faturado_apos_envio: anomaliasMap['FATURADO_APOS_ENVIO'] || 0,
        enviado_sem_producao: anomaliasMap['ENVIADO_SEM_PRODUCAO'] || 0,
        atraso_envio_prazo: anomaliasMap['ATRASO_ENVIO_PRAZO'] || 0,
        parado_sem_evolucao: anomaliasMap['PARADO_SEM_EVOLUCAO'] || 0,
        proximo_prazo_envio: anomaliasMap['PROXIMO_PRAZO_ENVIO'] || 0,
        pedido_travado_jet: anomaliasMap['PEDIDO_TRAVADO_JET'] || 0,
        retorno_jet_sem_confirmacao: anomaliasMap['RETORNO_JET_SEM_CONFIRMACAO_ANYMARKET'] || 0,
        atraso_prazo_preparacao: anomaliasMap['ATRASO_PRAZO_PREPARACAO'] || 0,
        demorou_para_produzir: anomaliasMap['DEMOROU_PARA_PRODUZIR'] || 0,
        producao_demorada: anomaliasMap['PRODUCAO_DEMORADA'] || 0
      };
      
      const totalAnomalias = Object.values(anomaliasDetalhadas).reduce((a, b) => a + b, 0);
      
      // Pedidos travados
      const pedidosTravados = await pool.query(`
        SELECT COUNT(DISTINCT a.pedido_id) as total
        FROM anomalias a
        WHERE a.resolvida = false
          AND a.tipo IN ('ATRASO_ENVIO_PRAZO', 'PARADO_SEM_EVOLUCAO', 'PEDIDO_TRAVADO_JET')
      `);
      
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
        LIMIT 10
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
      const taxaSync = totalAnymarketAtivos > 0 ? ((totalJetAtivos / totalAnymarketAtivos) * 100).toFixed(1) : 0;

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
          anomalias: anomaliasDetalhadas,
          anomaliasNaoResolvidas: totalAnomalias,
          pedidosTravados: parseInt(pedidosTravados.rows[0].total) || 0,
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
      const { limit = 50, offset = 0, resolvida, tipo } = req.query;
      const params = [];
      let where = 'WHERE 1=1';
      
      if (resolvida !== undefined) {
        params.push(resolvida === 'true');
        where += ` AND resolvida = $${params.length}`;
      }
      
      if (tipo) {
        params.push(tipo);
        where += ` AND tipo = $${params.length}`;
      }
      
      // Query de contagem
      const countResult = await pool.query(`
        SELECT COUNT(*) as total FROM anomalias ${where}
      `, params);
      const total = parseInt(countResult.rows[0].total);
      
      // Query com paginação
      params.push(parseInt(limit), parseInt(offset));
      const result = await pool.query(`
        SELECT id, pedido_id, tipo, origem_falha, marketplace, criado_em, resolvida, detalhes
        FROM anomalias
        ${where}
        ORDER BY criado_em DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `, params);

      const anomalias = result.rows.map(a => ({
        ...a,
        descricao: DESCRICAO_ANOMALIA[a.tipo] || a.tipo
      }));

      res.json({ 
        success: true, 
        anomalias,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    } catch (error) {
      console.error('Erro getAnomalias:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async getPedidosPipeline(req, res) {
    try {
      const { page = 1, limit = 20, marketplace, loja, sort, quickFilter, search, anomaliaTipo } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

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
      
      if (search) {
        params.push(`%${search}%`);
        baseWhere += ` AND (
          te.pedido_id ILIKE $${params.length}
          OR pm.id_anymarket ILIKE $${params.length}
          OR pm.id_jet ILIKE $${params.length}
          OR pm.id_onclick ILIKE $${params.length}
          OR pm.loja ILIKE $${params.length}
        )`;
      }
      
      // Filtro por tipo de anomalia
      let anomaliaFilter = '';
      if (anomaliaTipo && anomaliaTipo !== '') {
        params.push(anomaliaTipo);
        anomaliaFilter = ` AND a.tipo = $${params.length}`;
      }

      const travadosFiltro = quickFilter === 'foraPrazo' ? `AND (
        (prazo_despacho IS NOT NULL AND prazo_despacho < NOW())
        OR (prazo_despacho IS NULL AND horas_sem_update > 1)
      )` : '';

      const orderBy = {
        prazo_asc: 'horas_ate_prazo ASC NULLS LAST',
        prazo_desc: 'horas_ate_prazo ASC NULLS LAST',
        parado_desc: 'horas_sem_update DESC NULLS LAST',
      }[sort] || 'ultimo_evento DESC NULLS LAST';

      const pedidosQuery = `
        WITH eventos_pedido AS (
          SELECT
            te.pedido_id,
            ARRAY_AGG(DISTINCT te.origem) AS origens,
            MAX(te.timestamp) AS ultimo_evento,
            MIN(te.timestamp) AS primeiro_evento,
            pm.marketplace_origem AS marketplace,
            pm.loja,
            pm.id_anymarket,
            pm.id_jet,
            pm.id_onclick,
            pm.prazo_despacho,
            EXTRACT(EPOCH FROM (NOW() - MAX(te.timestamp))) / 3600 AS horas_sem_update,
            CASE
              WHEN pm.prazo_despacho IS NOT NULL
              THEN EXTRACT(EPOCH FROM (pm.prazo_despacho - NOW())) / 3600
              ELSE NULL
            END AS horas_ate_prazo,
            a.tipo AS anomalia_tipo,
            a.descricao AS anomalia_descricao
          FROM tracking_events te
          LEFT JOIN pedidos_mapeamento pm ON te.pedido_id = pm.numero_marketplace
          LEFT JOIN anomalias a ON te.pedido_id = a.pedido_id AND a.resolvida = false
          ${baseWhere}
          GROUP BY te.pedido_id, pm.marketplace_origem, pm.loja,
                   pm.id_anymarket, pm.id_jet, pm.id_onclick, pm.prazo_despacho,
                   a.tipo, a.descricao
        )
        SELECT *
        FROM eventos_pedido
        WHERE 1=1
          ${travadosFiltro}
          ${anomaliaFilter}
        ORDER BY ${orderBy}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      const countQuery = `
        WITH eventos_pedido AS (
          SELECT
            te.pedido_id,
            pm.prazo_despacho,
            EXTRACT(EPOCH FROM (NOW() - MAX(te.timestamp))) / 3600 AS horas_sem_update,
            a.tipo AS anomalia_tipo
          FROM tracking_events te
          LEFT JOIN pedidos_mapeamento pm ON te.pedido_id = pm.numero_marketplace
          LEFT JOIN anomalias a ON te.pedido_id = a.pedido_id AND a.resolvida = false
          ${baseWhere}
          GROUP BY te.pedido_id, pm.prazo_despacho, a.tipo
        )
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'NAO_INTEGROU_JET') AS nao_integrou_jet,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'NAO_ENTROU_ONCLICK') AS nao_entrou_onclick,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'FATURADO_APOS_ENVIO') AS faturado_apos_envio,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'ATRASO_ENVIO_PRAZO') AS atraso_envio_prazo,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'PARADO_SEM_EVOLUCAO') AS parado_sem_evolucao,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'PROXIMO_PRAZO_ENVIO') AS proximo_prazo_envio,
          COUNT(*) FILTER (WHERE anomalia_tipo = 'PEDIDO_TRAVADO_JET') AS pedido_travado_jet
        FROM eventos_pedido
        WHERE 1=1
          ${travadosFiltro}
          ${anomaliaFilter}
      `;

      params.push(parseInt(limit), offset);

      const [pedidosResult, countResult] = await Promise.all([
        pool.query(pedidosQuery, params),
        pool.query(countQuery, params.slice(0, -2)),
      ]);

      const totais = countResult.rows[0];
      const total = parseInt(totais.total);

      res.json({
        success: true,
        pedidos: pedidosResult.rows,
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        summary: {
          total,
          nao_integrou_jet: parseInt(totais.nao_integrou_jet || 0),
          nao_entrou_onclick: parseInt(totais.nao_entrou_onclick || 0),
          faturado_apos_envio: parseInt(totais.faturado_apos_envio || 0),
          atraso_envio_prazo: parseInt(totais.atraso_envio_prazo || 0),
          parado_sem_evolucao: parseInt(totais.parado_sem_evolucao || 0),
          proximo_prazo_envio: parseInt(totais.proximo_prazo_envio || 0),
          pedido_travado_jet: parseInt(totais.pedido_travado_jet || 0)
        }
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
          LIMIT 10
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