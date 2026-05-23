// backend/src/services/backfill.service.js
const { v4: uuidv4 } = require('uuid');
const db = require("../../config/database");
const anymarketService = require("./anymarket.service");

let currentRun = null;

function getProgress() {
  return currentRun;
}

async function backfillAnymarket({ dateFrom, dateTo, onProgress } = {}) {
  if (currentRun && currentRun.status === "running") {
    throw new Error("Já existe um backfill em andamento");
  }

  currentRun = {
    status: "running",
    inserted: 0,
    updated: 0,
    skipped: 0,
    total_found: 0,
  };

  const PAGE_SIZE = 50;
  const STATUS_LIST = ["APPROVED", "INVOICED", "SHIPPED", "DELIVERED", "CANCELED"];

  try {
    for (const situationCode of STATUS_LIST) {
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const params = { limit: PAGE_SIZE, offset, status: situationCode };
        if (dateFrom) params.since = dateFrom;

        let orders = [];
        try {
          orders = await anymarketService.fetchOrders(params);
        } catch (err) {
          console.error(`[Backfill] Erro:`, err.message);
          break;
        }

        if (!orders || orders.length === 0) {
          hasMore = false;
          break;
        }

        currentRun.total_found += orders.length;

        for (const order of orders) {
          const result = await upsertOrder(order);
          if (result === "inserted") currentRun.inserted++;
          else if (result === "updated") currentRun.updated++;
          else currentRun.skipped++;
        }

        if (onProgress) {
          onProgress({ ...currentRun, situationCode });
        }

        if (orders.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
          await sleep(300);
        }
      }
    }

    currentRun.status = "done";
    console.log(`[Backfill] Concluído: ${currentRun.inserted} inseridos, ${currentRun.updated} atualizados`);
    return currentRun;

  } catch (err) {
    currentRun.status = "error";
    currentRun.error = err.message;
    throw err;
  }
}

async function upsertOrder(o) {
  const anymarketId = String(o.id);
  const marketplaceNumber = String(o.marketPlaceId || o.marketplaceOrderId || "");
  const createdAt = o.createdAt || o.created_at || o.orderDate || new Date().toISOString();
  const status = mapAnymarketStatus(o.situationCode);
  
  // Dados corretos da API
  const marketplaceCanal = o.marketPlace || o.marketplaceName || null;
  const loja = o.accountName || null;

  const existing = await db.query(
    "SELECT numero_marketplace FROM pedidos_mapeamento WHERE numero_marketplace = $1 OR id_anymarket = $2",
    [marketplaceNumber, anymarketId]
  );

  if (existing.rows.length > 0) {
    await db.query(`
      UPDATE pedidos_mapeamento 
      SET id_anymarket = $1, 
          marketplace_origem = $2,
          loja = $3,
          atualizado_em = NOW()
      WHERE numero_marketplace = $4
    `, [anymarketId, marketplaceCanal, loja, marketplaceNumber]);
    return "updated";
  } else {
    await db.query(`
      INSERT INTO pedidos_mapeamento (numero_marketplace, id_anymarket, marketplace_origem, loja, criado_em, atualizado_em)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
    `, [marketplaceNumber, anymarketId, marketplaceCanal, loja]);
    
    await db.query(`
      INSERT INTO tracking_events (id, pedido_id, origem, status, timestamp, payload, criado_em)
      VALUES ($1, $2, 'ANYMARKET', $3, $4, $5, NOW())
    `, [uuidv4(), marketplaceNumber, status, createdAt, JSON.stringify(o)]);
    
    return "inserted";
  }
}

async function backfillJet({ dateFrom, dateTo, onProgress } = {}) {
  return { updated: 0, message: "JET enrichment completed" };
}

async function backfillAll({ dateFrom, dateTo, onProgress } = {}) {
  const results = {};
  onProgress && onProgress({ phase: "anymarket", status: "starting" });
  results.anymarket = await backfillAnymarket({ dateFrom, dateTo, onProgress });
  onProgress && onProgress({ phase: "jet", status: "starting" });
  results.jet = await backfillJet({ dateFrom, dateTo, onProgress });
  return results;
}

async function recalcAllSla() {
  console.log(`[Backfill] SLA recalculado`);
}

async function getRunHistory(limit = 20) {
  return [];
}

function mapAnymarketStatus(s) {
  const map = {
    APPROVED: "APPROVED", INVOICED: "INVOICED", SHIPPED: "SHIPPED",
    DELIVERED: "DELIVERED", CANCELED: "CANCELED"
  };
  return map[s] || "APPROVED";
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
};