// backend/src/services/jet.service.js
/**
 * jet.service.js - CORRIGIDO para usar pedidos_mapeamento + tracking_events
 */

const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const db = require("../../config/database");

const BASE_URL = process.env.JET_BASE_URL || "https://api.jet.com.br/api";

// ─── AUTH - JET OAuth2 ─────────────────────────────────────────────────────
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

// ─── MAPEAMENTO DE STATUS JET → STATUS INTERNO ─────────────────────────────
function mapStatus(jetStatus) {
  const map = {
    'Pedido.Pago': 'PAGO',
    'Pedido.Aprovado': 'APROVADO',
    'Pedido.EmProducao': 'EM_PRODUCAO',
    'Pedido.Enviado': 'ENVIADO',
    'Pedido.Entregue': 'ENTREGUE',
    'Pedido.Cancelado': 'CANCELADO',
    'new': 'NOVO',
    'processing': 'PROCESSANDO',
    'shipped': 'ENVIADO',
    'delivered': 'ENTREGUE',
    'cancelled': 'CANCELADO',
    'approved': 'APROVADO',
    'invoiced': 'FATURADO'
  };
  return map[jetStatus] || jetStatus || 'DESCONHECIDO';
}

// ─── BUSCAR PEDIDOS NA API JET ─────────────────────────────────────────────
async function fetchOrders({ page = 1, pageSize = 50, dateFrom, dateTo, status } = {}) {
  const params = { page, pageSize };
  if (dateFrom) params.startDate = dateFrom;
  if (dateTo)   params.endDate   = dateTo;
  if (status)   params.status    = status;

  const data = await apiGet("/orders", params);
  return data.orders || data.content || data || [];
}

async function fetchOrder(jetOrderId) {
  return apiGet(`/orders/${jetOrderId}`);
}

// ─── CORRIGIDO: Salvar/atualizar pedido da JET ─────────────────────────────
async function upsertJetOrder(jetOrder) {
  const now = new Date().toISOString();
  
  // Extrair IDs
  const jetOrderId = String(jetOrder.orderId || jetOrder.id || "");
  const mpOrderId = String(jetOrder.marketplaceOrderId || jetOrder.externalOrderId || "");
  const erpOrderId = String(jetOrder.erpOrderId || jetOrder.erpId || "");
  
  // Status mapeado
  const currentStatus = mapStatus(jetOrder.status || jetOrder.situationCode);
  
  // Extrair marketplace
  const marketplaceOrigem = jetOrder.marketplaceName || jetOrder.channel || "JET";
  const loja = jetOrder.accountName || jetOrder.storeName || null;
  
  // Qual ID usar para buscar? Prioridade: mpOrderId (número do marketplace) > jetOrderId
  const buscarPor = mpOrderId || jetOrderId;
  
  if (!buscarPor) {
    console.error('[JET] Pedido sem identificador:', jetOrder);
    return { error: 'Pedido sem identificador' };
  }

  // Buscar pedido existente
  const existing = await db.query(
    `SELECT id, id_jet, id_anymarket, numero_marketplace 
     FROM pedidos_mapeamento 
     WHERE numero_marketplace = $1 OR id_jet = $2`,
    [buscarPor, jetOrderId]
  );

  if (existing.rows.length > 0) {
    const pedidoExistente = existing.rows[0];
    const numeroMarketplace = pedidoExistente.numero_marketplace;
    
    // Buscar último status da JET para este pedido
    const lastEvent = await db.query(
      `SELECT status, timestamp 
       FROM tracking_events 
       WHERE pedido_id = $1 AND origem = 'JET'
       ORDER BY timestamp DESC 
       LIMIT 1`,
      [numeroMarketplace]
    );
    
    const lastStatus = lastEvent.rows[0]?.status;
    const statusChanged = lastStatus !== currentStatus;
    
    // Atualizar mapeamento
    await db.query(`
      UPDATE pedidos_mapeamento 
      SET id_jet = $1,
          id_erp = $2,
          marketplace_origem = COALESCE($3, marketplace_origem),
          loja = COALESCE($4, loja),
          atualizado_em = NOW()
      WHERE numero_marketplace = $5
    `, [jetOrderId, erpOrderId, marketplaceOrigem, loja, numeroMarketplace]);
    
    // Se status mudou, registrar evento
    if (statusChanged) {
      await db.query(`
        INSERT INTO tracking_events (
          id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
        ON CONFLICT (pedido_id, origem, status) 
        DO UPDATE SET 
          timestamp = EXCLUDED.timestamp,
          payload = EXCLUDED.payload,
          dados_completos = EXCLUDED.dados_completos
      `, [
        uuidv4(),
        numeroMarketplace,
        'JET',
        currentStatus,
        jetOrder.orderDate || jetOrder.createdAt || now,
        JSON.stringify({
          event: 'status_changed',
          old_status: lastStatus,
          new_status: currentStatus,
          jet_order_id: jetOrderId,
          erp_order_id: erpOrderId
        }),
        JSON.stringify(jetOrder)
      ]);
      
      console.log(`[JET] Pedido ${jetOrderId} status alterado: ${lastStatus} → ${currentStatus}`);
    } else {
      console.log(`[JET] Pedido ${jetOrderId} atualizado (mesmo status: ${currentStatus})`);
    }
    
    return { action: 'updated', numero_marketplace: numeroMarketplace };
    
  } else {
    // PEDIDO NOVO - Inserir
    const novoNumeroMarketplace = mpOrderId || jetOrderId;
    
    await db.query(`
      INSERT INTO pedidos_mapeamento (
        id_jet,
        id_erp,
        numero_marketplace,
        marketplace_origem,
        loja,
        criado_em,
        atualizado_em
      )
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    `, [jetOrderId, erpOrderId, novoNumeroMarketplace, marketplaceOrigem, loja]);
    
    // Registrar primeiro evento
    await db.query(`
      INSERT INTO tracking_events (
        id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
      ON CONFLICT (pedido_id, origem, status) 
      DO NOTHING
    `, [
      uuidv4(),
      novoNumeroMarketplace,
      'JET',
      currentStatus,
      jetOrder.orderDate || jetOrder.createdAt || now,
      JSON.stringify({
        event: 'pedido_criado',
        jet_order_id: jetOrderId,
        erp_order_id: erpOrderId
      }),
      JSON.stringify(jetOrder)
    ]);
    
    console.log(`[JET] Pedido ${jetOrderId} inserido (status: ${currentStatus})`);
    return { action: 'inserted', numero_marketplace: novoNumeroMarketplace };
  }
}

// ─── CORRIGIDO: Processar webhook da JET ─────────────────────────────────────
async function processWebhook(payload) {
  const now = new Date().toISOString();
  
  // Extrair o pedido do payload (diferentes formatos possíveis)
  const jetOrder = payload.order || payload.data || payload;
  
  // Registrar log do webhook
  const logResult = await db.query(`
    INSERT INTO webhook_log (source, event_type, payload, received_at)
    VALUES ('jet', $1, $2, $3)
    RETURNING id
  `, [payload.event || payload.type || "unknown", JSON.stringify(payload), now]);
  
  const logId = logResult.rows[0].id;
  
  try {
    const result = await upsertJetOrder(jetOrder);
    
    await db.query(`UPDATE webhook_log SET processed = true WHERE id = $1`, [logId]);
    
    console.log(`[Webhook JET] Processado com sucesso:`, result);
    return { ok: true, ...result };
    
  } catch (err) {
    console.error(`[Webhook JET] Erro:`, err.message);
    await db.query(`UPDATE webhook_log SET error = $1 WHERE id = $2`, [err.message, logId]);
    throw err;
  }
}

// ─── FUNÇÃO PARA ENRIQUECER PEDIDOS EXISTENTES ──────────────────────────────
async function enrichExistingOrders(limit = 100) {
  // Buscar pedidos que têm id_anymarket mas não têm id_jet
  const pedidos = await db.query(`
    SELECT numero_marketplace, id_anymarket
    FROM pedidos_mapeamento
    WHERE id_jet IS NULL 
      AND id_anymarket IS NOT NULL
    LIMIT $1
  `, [limit]);
  
  let atualizados = 0;
  
  for (const pedido of pedidos.rows) {
    try {
      // Buscar na API do JET pelo número do marketplace
      const jetOrders = await fetchOrders({ 
        marketplaceOrderId: pedido.numero_marketplace 
      });
      
      if (jetOrders && jetOrders.length > 0) {
        await upsertJetOrder(jetOrders[0]);
        atualizados++;
      }
    } catch (err) {
      console.error(`[JET Enrich] Erro ao processar ${pedido.numero_marketplace}:`, err.message);
    }
  }
  
  return { atualizados, total: pedidos.rows.length };
}

module.exports = {
  fetchOrders,
  fetchOrder,
  mapStatus,
  upsertJetOrder,
  processWebhook,
  enrichExistingOrders
};