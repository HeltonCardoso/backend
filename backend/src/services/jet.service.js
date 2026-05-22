/**
 * jet.service.js
 * 
 * Integração com a API da JET e-Commerce.
 * Suporta:
 *  - Busca de pedidos com paginação
 *  - Enriquecimento de pedidos existentes no banco
 *  - Processamento de webhooks da JET
 */

const axios = require("axios");
const db = require("../models/db");

const BASE_URL = process.env.JET_BASE_URL || "https://api.jet.com.br/api";

// ─── AUTH — JET usa OAuth2 client_credentials ─────────────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const { data } = await axios.post(`${BASE_URL}/token`, null, {
    params: {
      grant_type: "client_credentials",
      client_id: process.env.JET_CLIENT_ID,
      client_secret: process.env.JET_CLIENT_SECRET,
    },
    timeout: 10000,
  });

  _token = data.access_token;
  // Expira 5min antes para segurança
  _tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return _token;
}

async function apiGet(path, params = {}) {
  const token = await getToken();
  const { data } = await axios.get(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
    timeout: 15000,
  });
  return data;
}

// ─── BUSCAR PEDIDOS ───────────────────────────────────────────────────────────
async function fetchOrders({ page = 1, pageSize = 50, dateFrom, dateTo, status } = {}) {
  const params = { page, pageSize };
  if (dateFrom) params.startDate = dateFrom;
  if (dateTo)   params.endDate   = dateTo;
  if (status)   params.status    = status;

  // Endpoint da JET para pedidos
  // Ajuste o path conforme documentação do seu contrato
  const data = await apiGet("/orders", params);

  // A JET pode retornar { orders: [...] } ou { content: [...] } ou array direto
  return data.orders || data.content || data || [];
}

// Busca pedido individual pelo ID da JET
async function fetchOrder(jetOrderId) {
  return apiGet(`/orders/${jetOrderId}`);
}

// Busca pedido pelo ID do marketplace
async function fetchOrderByMpId(mpOrderId) {
  const data = await apiGet("/orders", { marketplaceOrderId: mpOrderId });
  const list = data.orders || data.content || data || [];
  return list[0] || null;
}

// ─── MAPEAR STATUS JET → INTERNO ──────────────────────────────────────────────
function mapStatus(jetStatus) {
  if (!jetStatus) return "jet";
  const s = String(jetStatus).toUpperCase();
  const map = {
    NEW: "jet",
    APPROVED: "jet",
    PROCESSING: "jet",
    BILLED: "invoiced",
    INVOICED: "invoiced",
    SHIPPED: "returned",
    DELIVERED: "ok",
    CANCELED: "cancelled",
    RETURNED: "cancelled",
  };
  return map[s] || "jet";
}

// ─── ENRIQUECER PEDIDO JÁ NO BANCO ───────────────────────────────────────────
function enrichOrder(jetOrder) {
  const now = new Date().toISOString();
  const jetId     = String(jetOrder.orderId || jetOrder.id || "");
  const mpOrderId = String(jetOrder.marketplaceOrderId || jetOrder.externalOrderId || "");
  const jetStatus = mapStatus(jetOrder.status || jetOrder.situationCode);
  const erpId     = String(jetOrder.erpOrderId || jetOrder.erpId || "");

  // Localiza o pedido — tenta por mp_order_id, depois jet_order_id
  let row = mpOrderId
    ? db.prepare("SELECT * FROM orders WHERE mp_order_id = ?").get(mpOrderId)
    : null;

  if (!row && jetId) {
    row = db.prepare("SELECT * FROM orders WHERE jet_order_id = ?").get(jetId);
  }

  if (row) {
    const newStatus = advanceStatus(row.status, jetStatus);
    db.prepare(`
      UPDATE orders SET
        jet_order_id = COALESCE(NULLIF(jet_order_id,''), ?),
        erp_order_id = COALESCE(NULLIF(erp_order_id,''), ?),
        status       = ?,
        sla_status   = ?,
        updated_at   = ?
      WHERE id = ?
    `).run(jetId, erpId, newStatus, calcSla(row.created_at), now, row.id);

    logEvent(row.order_id, "jet", "enriched", { jetStatus, erpId });
    return { action: "updated", orderId: row.order_id };
  }

  // Não encontrou — insere como pedido JET
  const internalId = `JET-${jetId || Date.now()}`;
  db.prepare(`
    INSERT INTO orders
      (order_id, marketplace, mp_order_id, jet_order_id, erp_order_id,
       value, status, sla_status, created_at, updated_at, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    internalId,
    jetOrder.marketplaceName || jetOrder.channel || "Desconhecido",
    mpOrderId,
    jetId,
    erpId,
    parseFloat(jetOrder.totalAmount || jetOrder.total || 0),
    jetStatus,
    "ok",
    jetOrder.createdAt || jetOrder.orderDate || now,
    now,
    JSON.stringify(jetOrder)
  );

  logEvent(internalId, "jet", "inserted", { jetStatus });
  return { action: "inserted", orderId: internalId };
}

// ─── PROCESSAR WEBHOOK JET ────────────────────────────────────────────────────
function processWebhook(payload) {
  const now = new Date().toISOString();

  const logId = db.prepare(`
    INSERT INTO webhook_log (source, event_type, payload, received_at)
    VALUES ('jet', ?, ?, ?)
  `).run(payload.event || payload.type || "unknown", JSON.stringify(payload), now).lastInsertRowid;

  try {
    // A JET pode mandar diferentes formatos dependendo do evento
    const jetOrder = payload.order || payload.data || payload;
    const result = enrichOrder(jetOrder);

    db.prepare("UPDATE webhook_log SET processed = 1 WHERE id = ?").run(logId);
    return result;
  } catch (err) {
    db.prepare("UPDATE webhook_log SET error = ? WHERE id = ?").run(err.message, logId);
    throw err;
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function logEvent(orderId, step, eventType, payload) {
  try {
    db.prepare(`
      INSERT INTO order_events (order_id, step, event_type, payload, source, occurred_at)
      VALUES (?, ?, ?, ?, 'jet', ?)
    `).run(orderId, step, eventType, JSON.stringify(payload), new Date().toISOString());
  } catch (_) {}
}

const STATUS_ORDER = ["new", "anymarket", "jet", "erp", "invoiced", "returned", "ok", "cancelled"];
function advanceStatus(current, incoming) {
  const ci = STATUS_ORDER.indexOf(current);
  const ii = STATUS_ORDER.indexOf(incoming);
  return ii > ci ? incoming : current;
}

function calcSla(createdAt) {
  const warnH = parseInt(process.env.SLA_WARNING_HOURS || 36);
  const critH = parseInt(process.env.SLA_CRITICAL_HOURS || 48);
  const diffH = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (diffH >= critH) return "critical";
  if (diffH >= warnH) return "warning";
  return "ok";
}

module.exports = {
  fetchOrders,
  fetchOrder,
  fetchOrderByMpId,
  mapStatus,
  enrichOrder,
  processWebhook,
};
