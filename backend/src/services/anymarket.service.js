// backend/src/services/anymarket.service.js
const axios = require("axios");
const db = require("../models/db");

const BASE_URL = process.env.ANYMARKET_BASE_URL || "https://api.anymarket.com.br/v2";
const TOKEN = process.env.ANYMARKET_TOKEN;

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    "gumgaToken": TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

// ─── BUSCAR PEDIDOS DA API ────────────────────────────────────────────────────
async function fetchOrders(params) {
  // Garante limit mínimo
  if (params.limit && params.limit < 5) {
    params.limit = 5;
  }
  
  console.log(`[AnyMarket API] Buscando pedidos com:`, params);
  
  try {
    const response = await api.get('/orders', { params });
    
    // A API retorna { content: [...], page: {...}, links: [...] }
    const orders = response.data?.content || [];
    
    console.log(`[AnyMarket API] Resposta: ${orders.length} pedidos encontrados (Total disponível: ${response.data?.page?.totalElements || 0})`);
    
    if (orders.length > 0) {
      console.log(`[AnyMarket API] Primeiro pedido:`, {
        id: orders[0].id,
        marketPlaceId: orders[0].marketPlaceId,
        marketPlace: orders[0].marketPlace,
        createdAt: orders[0].createdAt,
        status: orders[0].status
      });
    }
    
    return orders;
  } catch (error) {
    console.error(`[AnyMarket API] Erro:`, error.response?.data || error.message);
    throw error;
  }
}

// Busca pedido individual
async function fetchOrder(anymarketId) {
  const { data } = await api.get(`/orders/${anymarketId}`);
  return data;
}

// ─── SINCRONIZAR PEDIDOS COM O BANCO ─────────────────────────────────────────
async function syncOrders(since) {
  const sinceDate = since || new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const orders = await fetchOrders({ since: sinceDate, limit: 50 });
  let upserted = 0;

  for (const o of orders) {
    await upsertOrder(o);
    upserted++;
  }

  console.log(`[Anymarket] Sincronizados ${upserted} pedidos`);
  return upserted;
}

// ─── MAPEAR STATUS ANYMARKET → STATUS INTERNO ────────────────────────────────
function mapStatus(anymarketStatus) {
  const map = {
    "APPROVED": "anymarket",
    "INVOICED": "invoiced",
    "SHIPPED": "returned",
    "DELIVERED": "ok",
    "CANCELED": "cancelled",
    "WAITING_PAYMENT": "new",
    "PAYMENT_ANALYSIS": "new",
    "PAID_WAITING_SHIP": "paid",
  };
  return map[anymarketStatus] || "anymarket";
}

// ─── SALVAR/ATUALIZAR PEDIDO NO BANCO ─────────────────────────────────────────
async function upsertOrder(o) {
  const existing = db.prepare("SELECT id FROM orders WHERE anymarket_id = ?").get(String(o.id));
  const now = new Date().toISOString();
  const status = mapStatus(o.status || o.situationCode);

  if (existing) {
    db.prepare(`
      UPDATE orders SET
        status = ?, sla_status = ?, updated_at = ?,
        mp_order_id = ?, invoiced_at = ?,
        raw_data = ?
      WHERE anymarket_id = ?
    `).run(
      status,
      calcSla(o.createdAt || o.created_at || now),
      now,
      String(o.marketPlaceId || o.marketplaceOrderId || ""),
      o.invoicedAt || o.paymentDate || null,
      JSON.stringify(o),
      String(o.id)
    );
    console.log(`[Upsert] Pedido ${o.id} atualizado`);
  } else {
    db.prepare(`
      INSERT INTO orders
        (order_id, marketplace, mp_order_id, anymarket_id, value,
         status, sla_status, created_at, updated_at, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `AM-${o.id}`,
      o.marketPlace || o.marketplaceName || o.channel || "Desconhecido",
      String(o.marketPlaceId || o.marketplaceOrderId || ""),
      String(o.id),
      parseFloat(o.total || o.totalAmount || 0),
      status,
      calcSla(o.createdAt || o.created_at || now),
      o.createdAt || o.created_at || now,
      now,
      JSON.stringify(o)
    );
    console.log(`[Upsert] Pedido ${o.id} inserido`);
  }

  // Registra evento
  db.prepare(`
    INSERT INTO order_events (order_id, step, event_type, payload, source, occurred_at)
    VALUES (?, 'anymarket', 'processed', ?, 'api_poll', ?)
  `).run(`AM-${o.id}`, JSON.stringify({ status: o.status, situationCode: o.situationCode }), now);
  
  return existing ? "updated" : "inserted";
}

// ─── PROCESSAR WEBHOOK ───────────────────────────────────────────────────────
function processWebhook(payload) {
  const now = new Date().toISOString();

  const logId = db.prepare(`
    INSERT INTO webhook_log (source, event_type, payload, received_at)
    VALUES ('anymarket', ?, ?, ?)
  `).run(payload.type || payload.situationCode || "unknown", JSON.stringify(payload), now).lastInsertRowid;

  try {
    const orderId = payload.orderId || payload.id;
    if (!orderId) throw new Error("Webhook sem orderId");

    const existing = db.prepare("SELECT id, order_id FROM orders WHERE anymarket_id = ?").get(String(orderId));
    const status = mapStatus(payload.situationCode || payload.status);

    if (existing) {
      db.prepare(`
        UPDATE orders SET status = ?, sla_status = ?, updated_at = ?
        WHERE anymarket_id = ?
      `).run(status, calcSla(existing.created_at), now, String(orderId));
    } else {
      db.prepare(`
        INSERT INTO orders (order_id, marketplace, anymarket_id, value, status, sla_status, created_at, updated_at, raw_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `AM-${orderId}`,
        payload.marketplaceName || "Desconhecido",
        String(orderId),
        parseFloat(payload.totalAmount || 0),
        status,
        "ok",
        now, now,
        JSON.stringify(payload)
      );
    }

    db.prepare(`
      INSERT INTO order_events (order_id, step, event_type, payload, source, occurred_at)
      VALUES (?, 'anymarket', 'received', ?, 'webhook', ?)
    `).run(`AM-${orderId}`, JSON.stringify(payload), now);

    db.prepare("UPDATE webhook_log SET processed = 1 WHERE id = ?").run(logId);
    
    return { ok: true, orderId };
  } catch (err) {
    db.prepare("UPDATE webhook_log SET error = ? WHERE id = ?").run(err.message, logId);
    throw err;
  }
}

function calcSla(createdAt) {
  const warnH = parseInt(process.env.SLA_WARNING_HOURS || 36);
  const critH = parseInt(process.env.SLA_CRITICAL_HOURS || 48);
  const diffH = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (diffH >= critH) return "critical";
  if (diffH >= warnH) return "warning";
  return "ok";
}

module.exports = { fetchOrders, fetchOrder, syncOrders, upsertOrder, processWebhook };