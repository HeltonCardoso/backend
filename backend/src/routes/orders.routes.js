const express = require("express");
const router = express.Router();
const pool = require("../../config/database");
const authService = require('../services/auth.service');

// Proteger todas as rotas
router.use(authService.authenticate);

// GET /api/orders - Usando sua view monitoramento_tempo_real
router.get("/", async (req, res) => {
  const {
    status, marketplace, sla_status, search,
    limit = 100, offset = 0,
    dateFrom, dateTo
  } = req.query;

  let query = `
    SELECT * FROM monitoramento_tempo_real
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 1;

  if (status) {
    query += ` AND ultimo_status = $${paramCount++}`;
    params.push(status);
  }
  if (marketplace) {
    query += ` AND marketplace_origem = $${paramCount++}`;
    params.push(marketplace);
  }
  if (sla_status) {
    query += ` AND sla_status = $${paramCount++}`;
    params.push(sla_status);
  }
  if (dateFrom) {
    query += ` AND data_criacao >= $${paramCount++}`;
    params.push(dateFrom);
  }
  if (dateTo) {
    query += ` AND data_criacao <= $${paramCount++}`;
    params.push(dateTo);
  }
  if (search) {
    query += ` AND (numero_marketplace ILIKE $${paramCount++} OR id_anymarket::TEXT ILIKE $${paramCount++})`;
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern);
  }

  query += ` ORDER BY data_criacao DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
  params.push(parseInt(limit), parseInt(offset));

  const result = await pool.query(query, params);
  
  // Total count
  const countQuery = `
    SELECT COUNT(*) as total FROM monitoramento_tempo_real
    WHERE 1=1
  `;
  // (Adicione os mesmos filtros aqui)
  
  res.json({
    orders: result.rows,
    total: result.rows.length,
    limit: parseInt(limit),
    offset: parseInt(offset)
  });
});

// GET /api/orders/summary - Usando dashboard_resumo
router.get("/summary", async (req, res) => {
  const summary = await pool.query("SELECT * FROM dashboard_resumo");
  const byMarketplace = await pool.query(`
    SELECT marketplace_origem, COUNT(*) as total
    FROM pedidos_mapeamento
    GROUP BY marketplace_origem
  `);
  const byStep = await pool.query(`
    SELECT origem, status, COUNT(*) as total
    FROM tracking_events
    WHERE timestamp > NOW() - INTERVAL '7 days'
    GROUP BY origem, status
    ORDER BY total DESC
  `);
  
  res.json({
    summary: summary.rows[0],
    byMarketplace: byMarketplace.rows,
    byStep: byStep.rows
  });
});

module.exports = router;