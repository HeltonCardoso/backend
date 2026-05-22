/**
 * backfill.service.js
 * 
 * Responsável por buscar pedidos históricos ANTES dos webhooks.
 * Lógica principal:
 *   1. Busca todos os pedidos no Anymarket (com paginação)
 *   2. Para cada pedido: INSERT se não existe, UPDATE se já existe (nunca duplica)
 *   3. Após popular do Anymarket, enriquece com dados da JET
 *   4. Inferência do ERP: se está na JET com status avançado → marcado como erp/invoiced
 * 
 * Mantém um registro de progresso para poder retomar se interrompido.
 */

const db = require("../models/db");
const anymarketService = require("./anymarket.service");
const jetService = require("./jet.service");

// ─── TABELA DE CONTROLE DE BACKFILL ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS backfill_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT NOT NULL,       -- anymarket|jet
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT DEFAULT 'running', -- running|done|error|partial
    total_found  INTEGER DEFAULT 0,
    inserted     INTEGER DEFAULT 0,
    updated      INTEGER DEFAULT 0,
    skipped      INTEGER DEFAULT 0,
    last_offset  INTEGER DEFAULT 0,   -- para retomar paginação
    date_from    TEXT,
    date_to      TEXT,
    error        TEXT
  );
`);

// ─── ESTADO EM MEMÓRIA DO PROGRESSO ATUAL ────────────────────────────────────
let currentRun = null;

function getProgress() {
  return currentRun;
}

// ─── BACKFILL ANYMARKET ───────────────────────────────────────────────────────
async function backfillAnymarket({ dateFrom, dateTo, onProgress } = {}) {
  if (currentRun && currentRun.status === "running") {
    throw new Error("Já existe um backfill em andamento. Aguarde ou cancele.");
  }

  const now = new Date().toISOString();
  const runId = db.prepare(`
    INSERT INTO backfill_runs (source, started_at, status, date_from, date_to)
    VALUES ('anymarket', ?, 'running', ?, ?)
  `).run(now, dateFrom || null, dateTo || null).lastInsertRowid;

  currentRun = {
    runId,
    source: "anymarket",
    status: "running",
    inserted: 0,
    updated: 0,
    skipped: 0,
    total_found: 0,
    current_offset: 0,
    startedAt: now,
  };

  const PAGE_SIZE = 50;

  // Status que queremos buscar para ter o histórico completo
  const STATUS_LIST = [
    "APPROVED",
    "INVOICED",
    "SHIPPED",
    "DELIVERED",
    "CANCELED",
    "WAITING_PAYMENT",
  ];

  try {
    for (const situationCode of STATUS_LIST) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        // Monta params
        const params = {
          limit: PAGE_SIZE,
          offset,
          status: situationCode,
        };
        if (dateFrom) params.since = dateFrom;

        let orders = [];
        try {
          orders = await anymarketService.fetchOrders(params);
        } catch (err) {
          // Se der erro numa página, loga e continua
          console.error(`[Backfill] Erro buscando status=${situationCode} offset=${offset}:`, err.message);
          break;
        }

        if (!orders || orders.length === 0) {
          hasMore = false;
          break;
        }

        currentRun.total_found += orders.length;

        // Processa cada pedido
        for (const order of orders) {
          const result = upsertOrderSafe(order);
          if (result === "inserted") currentRun.inserted++;
          else if (result === "updated") currentRun.updated++;
          else currentRun.skipped++;
        }

        // Salva progresso no banco
        db.prepare(`
          UPDATE backfill_runs SET
            total_found = ?, inserted = ?, updated = ?, skipped = ?, last_offset = ?
          WHERE id = ?
        `).run(
          currentRun.total_found,
          currentRun.inserted,
          currentRun.updated,
          currentRun.skipped,
          offset,
          runId
        );

        // Callback de progresso para o frontend via SSE
        if (onProgress) {
          onProgress({ ...currentRun, situationCode });
        }

        // Se retornou menos que PAGE_SIZE, chegou no fim
        if (orders.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
          currentRun.current_offset = offset;
          // Pequena pausa para não sobrecarregar a API
          await sleep(300);
        }
      }
    }

    // Marca como concluído
    const finishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE backfill_runs SET status = 'done', finished_at = ?,
        total_found = ?, inserted = ?, updated = ?, skipped = ?
      WHERE id = ?
    `).run(finishedAt, currentRun.total_found, currentRun.inserted, currentRun.updated, currentRun.skipped, runId);

    currentRun.status = "done";
    currentRun.finishedAt = finishedAt;

    console.log(`[Backfill Anymarket] Concluído: ${currentRun.inserted} inseridos, ${currentRun.updated} atualizados, ${currentRun.skipped} ignorados`);
    return currentRun;

  } catch (err) {
    db.prepare(`
      UPDATE backfill_runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?
    `).run(new Date().toISOString(), err.message, runId);

    currentRun.status = "error";
    currentRun.error = err.message;
    throw err;
  }
}

// ─── BACKFILL JET — enriquece pedidos que já existem no banco ────────────────
async function backfillJet({ dateFrom, dateTo, onProgress } = {}) {
  const now = new Date().toISOString();
  const runId = db.prepare(`
    INSERT INTO backfill_runs (source, started_at, status, date_from, date_to)
    VALUES ('jet', ?, 'running', ?, ?)
  `).run(now, dateFrom || null, dateTo || null).lastInsertRowid;

  const jetRun = {
    runId,
    source: "jet",
    status: "running",
    inserted: 0,
    updated: 0,
    skipped: 0,
    total_found: 0,
    startedAt: now,
  };

  const PAGE_SIZE = 50;

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      let jetOrders = [];
      try {
        jetOrders = await jetService.fetchOrders({ page, pageSize: PAGE_SIZE, dateFrom, dateTo });
      } catch (err) {
        console.error(`[Backfill JET] Erro na página ${page}:`, err.message);
        break;
      }

      if (!jetOrders || jetOrders.length === 0) {
        hasMore = false;
        break;
      }

      jetRun.total_found += jetOrders.length;

      for (const jetOrder of jetOrders) {
        const result = enrichFromJet(jetOrder);
        if (result === "updated") jetRun.updated++;
        else if (result === "inserted") jetRun.inserted++;
        else jetRun.skipped++;
      }

      db.prepare(`
        UPDATE backfill_runs SET total_found = ?, updated = ?, inserted = ?, skipped = ?
        WHERE id = ?
      `).run(jetRun.total_found, jetRun.updated, jetRun.inserted, jetRun.skipped, runId);

      if (onProgress) onProgress({ ...jetRun });

      if (jetOrders.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        page++;
        await sleep(300);
      }
    }

    const finishedAt = new Date().toISOString();
    db.prepare(`
      UPDATE backfill_runs SET status = 'done', finished_at = ?,
        total_found = ?, updated = ?, inserted = ?, skipped = ?
      WHERE id = ?
    `).run(finishedAt, jetRun.total_found, jetRun.updated, jetRun.inserted, jetRun.skipped, runId);

    jetRun.status = "done";
    jetRun.finishedAt = finishedAt;

    console.log(`[Backfill JET] Concluído: ${jetRun.updated} atualizados, ${jetRun.inserted} novos, ${jetRun.skipped} sem match`);
    return jetRun;

  } catch (err) {
    db.prepare(`
      UPDATE backfill_runs SET status = 'error', finished_at = ?, error = ? WHERE id = ?
    `).run(new Date().toISOString(), err.message, runId);
    jetRun.status = "error";
    throw err;
  }
}

// ─── UPSERT SEGURO — nunca duplica ───────────────────────────────────────────
function upsertOrderSafe(o) {
  const anymarketId = String(o.id);
  const existing = db.prepare(
    "SELECT id, status, updated_at FROM orders WHERE anymarket_id = ?"
  ).get(anymarketId);

  const now = new Date().toISOString();
  const createdAt = o.createdAt || o.created_at || o.orderDate || now;
  const newStatus = anymarketService.mapStatus
    ? anymarketService.mapStatus(o.situationCode)
    : mapAnymarketStatus(o.situationCode);
  const slaStatus = calcSla(createdAt);

  if (existing) {
    // Só atualiza se o status mudou ou tem dados mais ricos
    const shouldUpdate = existing.status !== newStatus || !existing.updated_at;
    if (!shouldUpdate) return "skipped";

    db.prepare(`
      UPDATE orders SET
        status     = ?,
        sla_status = ?,
        updated_at = ?,
        mp_order_id = COALESCE(NULLIF(mp_order_id,''), ?),
        invoiced_at = COALESCE(invoiced_at, ?),
        raw_data   = ?
      WHERE anymarket_id = ?
    `).run(
      newStatus,
      slaStatus,
      now,
      String(o.marketPlaceId || o.marketplaceOrderId || ""),
      o.invoicedAt || null,
      JSON.stringify(o),
      anymarketId
    );

    logEvent(`AM-${anymarketId}`, "anymarket", "backfill_update", { status: o.situationCode });
    return "updated";

  } else {
    db.prepare(`
      INSERT INTO orders
        (order_id, marketplace, mp_order_id, anymarket_id, value,
         status, sla_status, created_at, updated_at, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `AM-${anymarketId}`,
      o.marketplaceName || o.channel || "Desconhecido",
      String(o.marketPlaceId || o.marketplaceOrderId || ""),
      anymarketId,
      parseFloat(o.totalAmount || o.total || 0),
      newStatus,
      slaStatus,
      createdAt,
      now,
      JSON.stringify(o)
    );

    logEvent(`AM-${anymarketId}`, "anymarket", "backfill_insert", { status: o.situationCode });
    return "inserted";
  }
}

// ─── ENRIQUECER PEDIDO COM DADOS DA JET ──────────────────────────────────────
function enrichFromJet(jetOrder) {
  const now = new Date().toISOString();

  // Tenta encontrar o pedido pelo ID do marketplace ou pelo anymarket_id
  const mpOrderId = String(jetOrder.marketplaceOrderId || jetOrder.externalOrderId || "");
  const jetId     = String(jetOrder.orderId || jetOrder.id || "");

  // Busca por mp_order_id primeiro, depois tenta pelo anymarket_id
  let existing =
    mpOrderId ? db.prepare("SELECT * FROM orders WHERE mp_order_id = ?").get(mpOrderId) : null;

  if (!existing && jetId) {
    existing = db.prepare("SELECT * FROM orders WHERE jet_order_id = ?").get(jetId);
  }

  const jetStatus = mapJetStatus(jetOrder.status || jetOrder.situationCode);
  const slaStatus = existing ? calcSla(existing.created_at) : "ok";

  if (existing) {
    // Enriquece com dados da JET
    db.prepare(`
      UPDATE orders SET
        jet_order_id = ?,
        status       = ?,
        sla_status   = ?,
        updated_at   = ?,
        erp_order_id = COALESCE(erp_order_id, ?)
      WHERE id = ?
    `).run(
      jetId,
      // Só avança o status, nunca regride
      advanceStatus(existing.status, jetStatus),
      slaStatus,
      now,
      String(jetOrder.erpOrderId || jetOrder.erpId || ""),
      existing.id
    );

    logEvent(existing.order_id, "jet", "backfill_enrich", { jetStatus: jetOrder.status });
    return "updated";

  } else {
    // Pedido existe na JET mas não veio do Anymarket ainda
    // Salva mesmo assim para não perder rastreabilidade
    if (!mpOrderId && !jetId) return "skipped";

    db.prepare(`
      INSERT INTO orders
        (order_id, marketplace, mp_order_id, jet_order_id, value,
         status, sla_status, created_at, updated_at, raw_data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `JET-${jetId}`,
      jetOrder.marketplaceName || jetOrder.channel || "Desconhecido",
      mpOrderId,
      jetId,
      parseFloat(jetOrder.totalAmount || jetOrder.total || 0),
      jetStatus,
      "ok",
      jetOrder.createdAt || jetOrder.orderDate || now,
      now,
      JSON.stringify(jetOrder)
    );

    logEvent(`JET-${jetId}`, "jet", "backfill_insert", { jetStatus: jetOrder.status });
    return "inserted";
  }
}

// ─── BACKFILL COMBINADO — roda Anymarket depois JET em sequência ──────────────
async function backfillAll({ dateFrom, dateTo, onProgress } = {}) {
  const results = {};

  onProgress && onProgress({ phase: "anymarket", status: "starting" });
  results.anymarket = await backfillAnymarket({
    dateFrom, dateTo,
    onProgress: (p) => onProgress && onProgress({ phase: "anymarket", ...p }),
  });

  onProgress && onProgress({ phase: "jet", status: "starting" });
  results.jet = await backfillJet({
    dateFrom, dateTo,
    onProgress: (p) => onProgress && onProgress({ phase: "jet", ...p }),
  });

  // Recalcula SLA de todos os pedidos após backfill
  recalcAllSla();

  return results;
}

// ─── RECALCULAR SLA DE TODOS OS PEDIDOS ──────────────────────────────────────
function recalcAllSla() {
  const orders = db.prepare(
    "SELECT id, created_at FROM orders WHERE status NOT IN ('ok','cancelled','delivered')"
  ).all();

  const update = db.prepare("UPDATE orders SET sla_status = ? WHERE id = ?");
  const updateMany = db.transaction((rows) => {
    for (const o of rows) {
      update.run(calcSla(o.created_at), o.id);
    }
  });

  updateMany(orders);
  console.log(`[Backfill] SLA recalculado para ${orders.length} pedidos`);
}

// ─── HISTÓRICO DE RUNS ────────────────────────────────────────────────────────
function getRunHistory(limit = 20) {
  return db.prepare(`
    SELECT * FROM backfill_runs ORDER BY started_at DESC LIMIT ?
  `).all(limit);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function logEvent(orderId, step, eventType, payload) {
  try {
    db.prepare(`
      INSERT INTO order_events (order_id, step, event_type, payload, source, occurred_at)
      VALUES (?, ?, ?, ?, 'backfill', ?)
    `).run(orderId, step, eventType, JSON.stringify(payload), new Date().toISOString());
  } catch (_) {}
}

function mapAnymarketStatus(s) {
  const map = {
    APPROVED: "anymarket", INVOICED: "invoiced", SHIPPED: "returned",
    DELIVERED: "ok", CANCELED: "cancelled",
    WAITING_PAYMENT: "new", PAYMENT_ANALYSIS: "new",
  };
  return map[s] || "anymarket";
}

function mapJetStatus(s) {
  if (!s) return "jet";
  const map = {
    APPROVED: "jet", BILLED: "invoiced", SHIPPED: "returned",
    DELIVERED: "ok", CANCELED: "cancelled",
    NEW: "jet", PROCESSING: "jet", INVOICED: "invoiced",
  };
  return map[String(s).toUpperCase()] || "jet";
}

// Nunca regride status — ex: se já é "invoiced" não volta para "jet"
const STATUS_ORDER = ["new", "anymarket", "jet", "erp", "invoiced", "returned", "ok", "cancelled"];
function advanceStatus(current, incoming) {
  const ci = STATUS_ORDER.indexOf(current);
  const ii = STATUS_ORDER.indexOf(incoming);
  if (ii > ci) return incoming;
  return current;
}

function calcSla(createdAt) {
  const warnH = parseInt(process.env.SLA_WARNING_HOURS || 36);
  const critH = parseInt(process.env.SLA_CRITICAL_HOURS || 48);
  const diffH = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (diffH >= critH) return "critical";
  if (diffH >= warnH) return "warning";
  return "ok";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  backfillAnymarket,
  backfillJet,
  backfillAll,
  recalcAllSla,
  getRunHistory,
  getProgress,
  enrichFromJet,
  upsertOrderSafe,
};
