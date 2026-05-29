// backend/src/services/anymarket.service.js
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const pool = require("../../config/database");  // ← PostgreSQL pool

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

// Mapeamento de status
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
  const numeroMarketplace = String(o.marketPlaceId || o.marketplaceOrderId || "");
  const createdAt = o.createdAt || o.created_at || new Date().toISOString();
  const currentStatus = mapStatus(o.status || o.situationCode);
  
  const marketplaceOrigem = o.marketPlace || o.marketplaceName || null;
  const loja = o.accountName || null;
  const marketplaceCanal = o.marketPlace || o.marketplaceName || null;

  if (!numeroMarketplace) {
    console.error(`[Upsert] Pedido ${anymarketId} sem numero_marketplace, ignorando`);
    return { error: 'sem_numero_marketplace' };
  }

  try {
    // Verificar se o pedido já existe
    const existing = await pool.query(
      `SELECT id, id_anymarket, numero_marketplace 
       FROM pedidos_mapeamento 
       WHERE numero_marketplace = $1 OR id_anymarket = $2`,
      [numeroMarketplace, anymarketId]
    );

    if (existing.rows.length > 0) {
      const pedidoExistente = existing.rows[0];
      
      // Buscar último status registrado
      const lastEvent = await pool.query(
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
      await pool.query(`
        UPDATE pedidos_mapeamento 
        SET id_anymarket = $1, 
            marketplace_origem = $2,
            loja = $3,
            marketplace_canal = $4,
            atualizado_em = NOW()
        WHERE numero_marketplace = $5
      `, [anymarketId, marketplaceOrigem, loja, marketplaceCanal, numeroMarketplace]);
      
      // Se status mudou, registrar evento
      if (statusChanged) {
        await pool.query(`
          INSERT INTO tracking_events (
            id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
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
          JSON.stringify(o)
        ]);
        
        console.log(`[Upsert] Pedido ${anymarketId} status alterado: ${lastStatus} → ${currentStatus}`);
      } else {
        console.log(`[Upsert] Pedido ${anymarketId} atualizado (mesmo status: ${currentStatus})`);
      }
      
      return { action: 'updated', numero_marketplace: numeroMarketplace };
      
    } else {
      // INSERT - Novo pedido
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
      
      // Registrar primeiro evento
      await pool.query(`
        INSERT INTO tracking_events (
          id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
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
        JSON.stringify(o)
      ]);
      
      console.log(`[Upsert] Pedido ${anymarketId} inserido (status: ${currentStatus})`);
      return { action: 'inserted', numero_marketplace: numeroMarketplace };
    }
  } catch (err) {
    console.error(`[Upsert] Erro ao processar pedido ${anymarketId}:`, err.message);
    throw err;
  }
}

// CORRIGIDO: Processar webhook usando PostgreSQL
async function processWebhook(payload) {
  const now = new Date().toISOString();

  try {
    // 🔥 CORREÇÃO: Extrair o pedido do content
    let orderData = payload;
    
    // Se tiver a estrutura { type, event, content }, usa o content
    if (payload.content && payload.content.id) {
      orderData = payload.content;
      console.log(`[Webhook] Extraindo order do content: ${orderData.id}`);
    }
    
    // Se tiver a estrutura { data: { ... } }
    if (payload.data && payload.data.id) {
      orderData = payload.data;
    }
    
    const orderId = orderData.id || payload.id;
    if (!orderId) {
      console.error('[Webhook] Payload sem orderId:', JSON.stringify(payload).substring(0, 500));
      return { ok: false, error: 'Webhook sem orderId' };
    }

    // Mapear o evento para status
    const eventToStatus = {
      'PAID_WAITING_SHIP': 'PAGO_AGUARDANDO_ENVIO',
      'PAID_WAITING_DELIVERY': 'PAGO_AGUARDANDO_ENTREGA',
      'INVOICED': 'FATURADO',
      'SHIPPED': 'ENVIADO',
      'DELIVERED': 'ENTREGUE',
      'CANCELED': 'CANCELADO',
      'APPROVED': 'APROVADO'
    };
    
    // Pega o status do event ou do orderData.status
    const statusRaw = orderData.status || payload.event || payload.type;
    const currentStatus = eventToStatus[statusRaw] || mapStatus(statusRaw);
    
    // Prepara os dados do pedido no formato que o upsertOrder espera
    const orderForUpsert = {
      id: orderId,
      marketPlaceId: orderData.marketPlaceId || orderData.marketplaceOrderId || orderData.oi || orderId,
      marketPlace: orderData.marketPlace || orderData.marketplaceName,
      status: currentStatus,
      situationCode: payload.event,
      createdAt: orderData.createdAt || orderData.created_at || now,
      accountName: orderData.accountName,
      total: orderData.total || orderData.totalAmount
    };
    
    console.log(`[Webhook] Processando pedido: ${orderId}, status: ${currentStatus}`);

    // Registrar log do webhook
    const logResult = await pool.query(`
      INSERT INTO webhook_log (source, event_type, payload, received_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, ['anymarket', payload.type || payload.event || "unknown", JSON.stringify(payload), now]);

    const logId = logResult.rows[0].id;

    // Processar o pedido
    const result = await upsertOrder(orderForUpsert);

    // Marcar como processado
    await pool.query(`UPDATE webhook_log SET processed = 1 WHERE id = $1`, [logId]);
    
    console.log(`[Webhook Anymarket] Processado com sucesso: ${orderId}`);
    return { ok: true, orderId, result };
    
  } catch (err) {
    console.error(`[Webhook Anymarket] Erro:`, err.message);
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