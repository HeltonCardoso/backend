/**
 * orders.routes.js
 * Endpoints para o dashboard consumir os pedidos do banco.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../models/db");

// ─── GET /api/orders ──────────────────────────────────────────────────────────
// Query params: status, marketplace, sla_status, search, limit, offset, dateFrom, dateTo
router.get("/", (req, res) => {
  const {
    status, marketplace, sla_status, search,
    limit = 100, offset = 0,
    dateFrom, dateTo,
    orderBy = "created_at", dir = "DESC",
  } = req.query;

  const where = ["1=1"];
  const params = [];

  if (status)      { where.push("status = ?");      params.push(status); }
  if (marketplace) { where.push("marketplace = ?"); params.push(marketplace); }
  if (sla_status)  { where.push("sla_status = ?");  params.push(sla_status); }
  if (dateFrom)    { where.push("created_at >= ?"); params.push(dateFrom); }
  if (dateTo)      { where.push("created_at <= ?"); params.push(dateTo); }
  if (search) {
    where.push("(order_id LIKE ? OR mp_order_id LIKE ? OR anymarket_id LIKE ? OR jet_order_id LIKE ?)");
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const safeOrder = ["created_at","updated_at","value","status"].includes(orderBy) ? orderBy : "created_at";
  const safeDir   = dir === "ASC" ? "ASC" : "DESC";

  const rows = db.prepare(`
    SELECT * FROM orders
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE sla_status WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
      ${safeOrder} ${safeDir}
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const total = db.prepare(`
    SELECT COUNT(*) as n FROM orders WHERE ${where.join(" AND ")}
  `).get(...params).n;

  res.json({ orders: rows, total, limit: parseInt(limit), offset: parseInt(offset) });
});

// ─── GET /api/orders/summary ──────────────────────────────────────────────────
// Cards do dashboard
router.get("/summary", (req, res) => {
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN sla_status = 'critical' THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN sla_status = 'warning'  THEN 1 ELSE 0 END) as warning,
      SUM(CASE WHEN status NOT IN ('ok','cancelled') AND (
            jet_order_id IS NULL OR jet_order_id = ''
          ) THEN 1 ELSE 0 END) as stuck_anymarket,
      SUM(CASE WHEN status IN ('jet','erp') AND (
            erp_order_id IS NULL OR erp_order_id = ''
          ) THEN 1 ELSE 0 END) as stuck_jet,
      SUM(CASE WHEN status = 'invoiced' THEN 1 ELSE 0 END) as invoiced_not_returned,
      SUM(CASE WHEN status = 'ok'        THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM orders
  `).get();

  // Por marketplace
  const byMarketplace = db.prepare(`
    SELECT marketplace, COUNT(*) as total,
      SUM(CASE WHEN sla_status = 'critical' THEN 1 ELSE 0 END) as critical
    FROM orders GROUP BY marketplace ORDER BY total DESC
  `).all();

  // Por etapa travada
  const byStep = db.prepare(`
    SELECT status, COUNT(*) as total FROM orders
    WHERE status NOT IN ('ok','cancelled')
    GROUP BY status ORDER BY total DESC
  `).all();

  res.json({ summary, byMarketplace, byStep });
});

// ─── GET /api/orders/:id ──────────────────────────────────────────────────────
router.get("/:id", (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE order_id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Pedido não encontrado" });

  const events = db.prepare(`
    SELECT * FROM order_events WHERE order_id = ? ORDER BY occurred_at ASC
  `).all(req.params.id);

  res.json({ ...order, events });
});

module.exports = router;
