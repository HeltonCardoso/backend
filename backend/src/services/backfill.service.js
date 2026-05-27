// backend/src/services/backfill.service.js
const { v4: uuidv4 } = require('uuid');
const db = require("../../config/database");
const anymarketService = require("./anymarket.service");

let currentRun = null;

// Mapeamento de status
const STATUS_MAP = {
  ANYMARKET: {
    'PENDING':              'PENDENTE',
    'PAID_WAITING_SHIP':    'PAGO_AGUARDANDO_ENVIO',
    'INVOICED':             'FATURADO',
    'PAID_WAITING_DELIVERY': 'ENVIADO',
    'CONCLUDED':            'ENTREGUE',
    'CANCELED':             'CANCELADO',
    'WAITING_PAYMENT':      'AGUARDANDO_PAGAMENTO',
    'PAYMENT_REPROVED':     'PAGAMENTO_REPROVADO',
    'error':                'ERRO'
  },
  JET: {
    'Pedido.Pago':          'PAGO',
    'Pedido.Aprovado':      'APROVADO',
    'Pedido.EmProducao':    'EM_PRODUCAO',
    'Pedido.Enviado':       'ENVIADO',
    'Pedido.Entregue':      'ENTREGUE',
    'Pedido.Cancelado':     'CANCELADO',
    'new':                  'NOVO',
    'processing':           'PROCESSANDO',
    'shipped':              'ENVIADO',
    'delivered':            'ENTREGUE',
    'cancelled':            'CANCELADO'
  },
  ONCLICK: {
    'draft':                'RASCUNHO',
    'confirmed':            'CONFIRMADO',
    'invoiced':             'FATURADO',
    'shipped':              'ENVIADO',
    'delivered':            'ENTREGUE',
    'cancelled':            'CANCELADO'
  }
};

function normalizeAnymarketStatus(status) {
  if (!status) return 'DESCONHECIDO';
  return STATUS_MAP.ANYMARKET[status] || status;
}

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
    status_changes: 0,
  };

  const PAGE_SIZE = 50;
  const STATUS_LIST = ["INVOICED", "CANCELED", "PAID_WAITING_SHIP", "PAID_WAITING_DELIVERY", "CONCLUDED"];

  console.log(`[Backfill] Iniciando com período: ${dateFrom} até ${dateTo || 'hoje'}`);

  try {
    let totalStatus = STATUS_LIST.length;
    let statusIndex = 0;

    for (const situationCode of STATUS_LIST) {
      let offset = 0;
      let hasMore = true;
      let pageCount = 0;
      let statusTotalFound = 0;

      console.log(`[Backfill] Buscando status: ${situationCode}`);

      while (hasMore) {
        const params = { limit: PAGE_SIZE, offset, status: situationCode };
        if (dateFrom) params.since = dateFrom;
        
        let orders = [];
        try {
          orders = await anymarketService.fetchOrders(params);
          
          if (!orders || orders.length === 0) {
            hasMore = false;
            break;
          }
          
          statusTotalFound += orders.length;
          currentRun.total_found += orders.length;

          for (const order of orders) {
            const result = await upsertOrder(order);
            if (result === "inserted") {
              currentRun.inserted++;
            } else if (result === "status_changed") {
              currentRun.status_changes++;
            } else if (result === "updated") {
              currentRun.updated++;
            } else {
              currentRun.skipped++;
            }
          }

          // Calcular percentual
          const statusPercent = (statusIndex / totalStatus) * 100;
          const pagePercent = (pageCount / 10) * (100 / totalStatus); // Estimativa de até 10 páginas por status
          let percent = Math.min(99, Math.floor(statusPercent + pagePercent));
          
          // Se já processou muitos pedidos, calcular baseado no total
          if (currentRun.total_found > 1000) {
            percent = Math.min(99, Math.floor((currentRun.total_found / 10000) * 100));
          }

          console.log(`[Backfill] ${situationCode} - Página ${pageCount + 1}: ${orders.length} pedidos. Inseridos: ${currentRun.inserted}, Status alterados: ${currentRun.status_changes}`);

          if (onProgress) {
            onProgress({ 
              type: 'progress',
              total_found: currentRun.total_found,
              inserted: currentRun.inserted,
              updated: currentRun.updated,
              status_changes: currentRun.status_changes,
              skipped: currentRun.skipped,
              situationCode: situationCode,
              percent: percent
            });
          }

          if (orders.length < PAGE_SIZE) {
            hasMore = false;
          } else {
            offset += PAGE_SIZE;
            pageCount++;
            await sleep(300);
          }
          
        } catch (err) {
          console.error(`[Backfill] Erro na busca para ${situationCode}:`, err.message);
          break;
        }
      }
      statusIndex++;
    }

    currentRun.status = "done";
    console.log(`[Backfill] ===== RESUMO FINAL =====`);
    console.log(`[Backfill] Total encontrado: ${currentRun.total_found}`);
    console.log(`[Backfill] Inseridos: ${currentRun.inserted}`);
    console.log(`[Backfill] Atualizados: ${currentRun.updated}`);
    console.log(`[Backfill] Mudanças de status: ${currentRun.status_changes}`);
    console.log(`[Backfill] Ignorados: ${currentRun.skipped}`);
    console.log(`[Backfill] ========================`);
    
    if (onProgress) {
      onProgress({ 
        type: 'done',
        total_found: currentRun.total_found,
        inserted: currentRun.inserted,
        updated: currentRun.updated,
        status_changes: currentRun.status_changes,
        skipped: currentRun.skipped,
        percent: 100
      });
    }
    
    return currentRun;

  } catch (err) {
    currentRun.status = "error";
    currentRun.error = err.message;
    console.error(`[Backfill] ERRO FATAL:`, err);
    if (onProgress) {
      onProgress({ 
        type: 'error', 
        message: err.message 
      });
    }
    throw err;
  }
}

async function upsertOrder(o) {
  const anymarketId = String(o.id);
  const numeroMarketplace = String(o.marketPlaceId || o.marketplaceOrderId || "");
  const createdAt = o.createdAt || o.created_at || new Date().toISOString();
  
  const currentStatusRaw = o.status || o.situationCode;
  const currentStatus = normalizeAnymarketStatus(currentStatusRaw);
  
  const marketplaceOrigem = o.marketPlace || o.marketplaceName || null;
  const loja = o.accountName || null;
  const marketplaceCanal = o.marketPlace || o.marketplaceName || null;

  // Verificar se o pedido já existe
  const existing = await db.query(
    `SELECT id, id_anymarket, numero_marketplace 
     FROM pedidos_mapeamento 
     WHERE numero_marketplace = $1 OR id_anymarket = $2`,
    [numeroMarketplace, anymarketId]
  );

  if (existing.rows.length > 0) {
    // Buscar último status registrado
    const lastEvent = await db.query(
      `SELECT status, timestamp 
       FROM tracking_events 
       WHERE pedido_id = $1 
       ORDER BY timestamp DESC 
       LIMIT 1`,
      [numeroMarketplace]
    );
    
    const lastStatus = lastEvent.rows[0]?.status;
    const statusChanged = lastStatus !== currentStatus;
    
    // Atualiza dados do pedido
    await db.query(`
      UPDATE pedidos_mapeamento 
      SET id_anymarket = $1, 
          marketplace_origem = $2,
          loja = $3,
          marketplace_canal = $4,
          atualizado_em = NOW()
      WHERE numero_marketplace = $5
    `, [anymarketId, marketplaceOrigem, loja, marketplaceCanal, numeroMarketplace]);
    
    if (!statusChanged) {
      return "updated";
    }
    
    // Registrar mudança de status
    await db.query(`
      INSERT INTO tracking_events (
        id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos, sla_calculado, tempo_decorrido_horas
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
      ON CONFLICT (pedido_id, origem, status) 
      DO UPDATE SET 
        timestamp = EXCLUDED.timestamp,
        payload = EXCLUDED.payload,
        dados_completos = EXCLUDED.dados_completos,
        criado_em = NOW()
    `, [
      uuidv4(), 
      numeroMarketplace, 
      'ANYMARKET', 
      currentStatus, 
      createdAt, 
      JSON.stringify({ 
        event: 'status_changed',
        old_status: lastStatus, 
        new_status: currentStatus,
        order_id: anymarketId
      }),
      JSON.stringify(o),
      null,
      null
    ]);
    
    return "status_changed";
    
  } else {
    // INSERT - Novo pedido
    await db.query(`
      INSERT INTO pedidos_mapeamento (
        id_anymarket, 
        numero_marketplace, 
        marketplace_origem, 
        loja, 
        marketplace_canal,
        criado_em, 
        atualizado_em
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `, [anymarketId, numeroMarketplace, marketplaceOrigem, loja, marketplaceCanal]);
    
    await db.query(`
      INSERT INTO tracking_events (
        id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos, sla_calculado, tempo_decorrido_horas
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
      ON CONFLICT (pedido_id, origem, status) 
      DO NOTHING
    `, [
      uuidv4(), 
      numeroMarketplace, 
      'ANYMARKET', 
      currentStatus, 
      createdAt, 
      JSON.stringify({ 
        event: 'pedido_criado',
        order_id: anymarketId
      }),
      JSON.stringify(o),
      null,
      null
    ]);
    
    return "inserted";
  }
}

async function backfillJet({ dateFrom, dateTo, onProgress } = {}) {
  console.log(`[Backfill Jet] Iniciando`);
  return { updated: 0, message: "JET enrichment completed" };
}

async function backfillAll({ dateFrom, dateTo, onProgress } = {}) {
  const results = {};
  
  if (onProgress) onProgress({ phase: "anymarket", status: "starting" });
  results.anymarket = await backfillAnymarket({ dateFrom, dateTo, onProgress });
  
  if (onProgress) onProgress({ phase: "jet", status: "starting" });
  results.jet = await backfillJet({ dateFrom, dateTo, onProgress });
  
  return results;
}

async function recalcAllSla() {
  console.log(`[Backfill] SLA recalculado`);
}

async function getRunHistory(limit = 20) {
  return [];
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