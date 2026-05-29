// backend/src/services/anymarket.service.js
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const pool = require("../../config/database");

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

// Mapeamento de status ANYMARKET → status interno
function mapStatus(anymarketStatus) {
  const map = {
    "APPROVED": "APROVADO",
    "INVOICED": "FATURADO",
    "SHIPPED": "ENVIADO",
    "DELIVERED": "ENTREGUE",
    "CONCLUDED": "CONCLUIDO",
    "CANCELED": "CANCELADO",
    "WAITING_PAYMENT": "AGUARDANDO_PAGAMENTO",
    "PAYMENT_ANALYSIS": "ANALISE_PAGAMENTO",
    "PAID_WAITING_SHIP": "PAGO_AGUARDANDO_ENVIO",
    "PAID_WAITING_DELIVERY": "PAGO_AGUARDANDO_ENTREGA",
    "PENDING": "PENDENTE",
    "PAYMENT_REPROVED": "PAGAMENTO_REPROVADO"
  };
  return map[anymarketStatus] || anymarketStatus;
}

// Buscar pedidos da API AnyMarket
async function fetchOrders(params) {
  if (params.limit && params.limit < 5) {
    params.limit = 5;
  }
  
  console.log(`[AnyMarket API] Buscando pedidos com:`, params);
  
  try {
    const response = await api.get('/orders', { params });
    const orders = response.data?.content || [];
    
    console.log(`[AnyMarket API] Resposta: ${orders.length} pedidos encontrados`);
    return orders;
  } catch (error) {
    console.error(`[AnyMarket API] Erro:`, error.response?.data || error.message);
    throw error;
  }
}

// CORRIGIDO: Salvar/atualizar pedido usando PostgreSQL
async function upsertOrder(o) {
  const anymarketId = String(o.id);
  
  // 🔥 CORREÇÃO CRUCIAL: NÃO usar o.oi como fallback!
  // O .oi é código interno da AnyMarket, não é o número do pedido no marketplace
  const numeroMarketplace = String(o.marketPlaceId || o.marketplaceOrderId || "");
  
  const createdAt = o.createdAt || o.created_at || new Date().toISOString();
  const currentStatus = mapStatus(o.status || o.situationCode);
  
  const marketplaceOrigem = o.marketPlace || o.marketplaceName || null;
  const loja = o.accountName || null;
  const marketplaceCanal = o.marketPlace || o.marketplaceName || null;

  // Validação: se não tem numero_marketplace, NÃO SALVAR
  if (!numeroMarketplace || numeroMarketplace === "undefined" || numeroMarketplace === "") {
    console.error(`[Upsert] ⚠️ Pedido ${anymarketId} ignorado - sem marketPlaceId! Oi recebido: ${o.oi}`);
    return { 
      action: 'ignored', 
      error: 'sem_marketplace_id',
      anymarketId,
      oi_recebido: o.oi 
    };
  }

  console.log(`[Upsert] Processando: AnyMarket=${anymarketId} | Marketplace=${numeroMarketplace} | Status=${currentStatus}`);

  try {
    // Verificar se o pedido já existe
    const existing = await pool.query(
      `SELECT id, id_anymarket, numero_marketplace 
       FROM pedidos_mapeamento 
       WHERE numero_marketplace = $1 OR id_anymarket = $2`,
      [numeroMarketplace, anymarketId]
    );

    if (existing.rows.length > 0) {
      // Buscar último status
      const lastEvent = await pool.query(
        `SELECT status FROM tracking_events 
         WHERE pedido_id = $1 ORDER BY timestamp DESC LIMIT 1`,
        [numeroMarketplace]
      );
      
      const lastStatus = lastEvent.rows[0]?.status;
      const statusChanged = lastStatus !== currentStatus;
      
      // Atualizar pedido
      await pool.query(`
        UPDATE pedidos_mapeamento 
        SET id_anymarket = $1, 
            marketplace_origem = $2,
            loja = $3,
            marketplace_canal = $4,
            atualizado_em = NOW()
        WHERE numero_marketplace = $5
      `, [anymarketId, marketplaceOrigem, loja, marketplaceCanal, numeroMarketplace]);
      
      if (statusChanged) {
        await pool.query(`
          INSERT INTO tracking_events (
            id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
          ON CONFLICT (pedido_id, origem, status) 
          DO UPDATE SET 
            timestamp = EXCLUDED.timestamp,
            payload = EXCLUDED.payload,
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
            new_status: currentStatus 
          }),
          JSON.stringify(o)
        ]);
        
        console.log(`[Upsert] ✅ Pedido ${anymarketId}: ${lastStatus} → ${currentStatus}`);
      } else {
        console.log(`[Upsert] 📝 Pedido ${anymarketId} atualizado (mesmo status)`);
      }
      
      return { action: 'updated', numero_marketplace: numeroMarketplace };
      
    } else {
      // NOVO PEDIDO
      await pool.query(`
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
      
      await pool.query(`
        INSERT INTO tracking_events (
          id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
        ON CONFLICT (pedido_id, origem, status) DO NOTHING
      `, [
        uuidv4(), 
        numeroMarketplace, 
        'ANYMARKET', 
        currentStatus, 
        createdAt, 
        JSON.stringify({ 
          event: 'pedido_criado' 
        }),
        JSON.stringify(o)
      ]);
      
      console.log(`[Upsert] 🆕 Pedido ${anymarketId} INSERIDO | Marketplace: ${numeroMarketplace}`);
      return { action: 'inserted', numero_marketplace: numeroMarketplace };
    }
  } catch (err) {
    console.error(`[Upsert] ❌ Erro no pedido ${anymarketId}:`, err.message);
    throw err;
  }
}

// CORRIGIDO: Processar webhook
async function processWebhook(payload) {
  const now = new Date().toISOString();

  try {
    // Função para extrair o pedido de qualquer formato
    function extractOrder(data) {
      // Caso 1: { content: { id, ... } }
      if (data.content?.id) return data.content;
      
      // Caso 2: { data: { id, ... } }
      if (data.data?.id) return data.data;
      
      // Caso 3: { id, ... } direto
      if (data.id) return data;
      
      // Caso 4: array com um pedido
      if (Array.isArray(data) && data[0]?.id) return data[0];
      
      return data;
    }
    
    const rawOrder = extractOrder(payload);
    const orderId = rawOrder.id;
    
    if (!orderId) {
      console.error('[Webhook] Não foi possível extrair orderId do payload:', 
        JSON.stringify(payload).substring(0, 300));
      return { ok: false, error: 'Webhook sem orderId' };
    }

    // Mapeamento de eventos para status
    const statusMap = {
      'ORDER': 'PENDENTE',
      'PAID_WAITING_SHIP': 'PAGO_AGUARDANDO_ENVIO',
      'PAID_WAITING_DELIVERY': 'PAGO_AGUARDANDO_ENTREGA',
      'INVOICED': 'FATURADO',
      'SHIPPED': 'ENVIADO',
      'DELIVERED': 'ENTREGUE',
      'CANCELED': 'CANCELADO',
      'APPROVED': 'APROVADO',
      'WAITING_PAYMENT': 'AGUARDANDO_PAGAMENTO'
    };
    
    // Determinar o status
    const eventType = payload.event || payload.type;
    const orderStatus = rawOrder.status || rawOrder.situationCode;
    const currentStatus = statusMap[eventType] || statusMap[orderStatus] || mapStatus(orderStatus) || 'DESCONHECIDO';
    
    // Montar objeto padronizado para o upsertOrder
    const orderForUpsert = {
      id: orderId,
      marketPlaceId: rawOrder.marketPlaceId || rawOrder.marketplaceOrderId || rawOrder.marketPlaceNumber,
      marketPlace: rawOrder.marketPlace || rawOrder.marketplaceName || payload.marketplaceName,
      status: currentStatus,
      situationCode: payload.event || orderStatus,
      createdAt: rawOrder.createdAt || rawOrder.created_at || rawOrder.orderDate || now,
      accountName: rawOrder.accountName,
      total: rawOrder.total || rawOrder.totalAmount
    };
    
    console.log(`[Webhook] 🚚 Pedido ${orderId} | Status: ${currentStatus} | Evento: ${payload.event || payload.type}`);

    // Registrar log do webhook
    const logResult = await pool.query(`
      INSERT INTO webhook_log (source, event_type, payload, received_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, ['anymarket', payload.event || payload.type || "unknown", JSON.stringify(payload), now]);

    const logId = logResult.rows[0].id;

    // Processar o pedido
    const result = await upsertOrder(orderForUpsert);

    // Marcar como processado
    await pool.query(`UPDATE webhook_log SET processed = 1 WHERE id = $1`, [logId]);
    
    console.log(`[Webhook] ✅ Pedido ${orderId} processado com sucesso`);
    return { ok: true, orderId, result };
    
  } catch (err) {
    console.error(`[Webhook] ❌ Erro:`, err.message);
    return { ok: false, error: err.message };
  }
}

// Sincronizar pedidos (buscar da API)
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

module.exports = { 
  fetchOrders, 
  processWebhook,
  upsertOrder,
  syncOrders
};