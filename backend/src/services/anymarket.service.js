// backend/src/services/anymarket.service.js
const axios = require("axios");
const { v4: uuidv4 } = require('uuid');
const pool = require("../../config/database");
const anomalyDetector = require('./anomaly-detector.service');

const API_KEY = process.env.ANYMARKET_TOKEN;
const BASE_URL = process.env.ANYMARKET_BASE_URL || "https://api.anymarket.com.br/v2";

// ──────────────────────────────────────────────────────────────────────────────
// 1. MAPEAMENTO DE STATUS
// ──────────────────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'ORDER': 'PENDENTE',
  'PAID_WAITING_SHIP': 'PAGO_AGUARDANDO_ENVIO',
  'PAID_WAITING_DELIVERY': 'PAGO_AGUARDANDO_ENTREGA',
  'INVOICED': 'FATURADO',
  'SHIPPED': 'ENVIADO',
  'DELIVERED': 'ENTREGUE',
  'CONCLUDED': 'CONCLUIDO',
  'CANCELED': 'CANCELADO',
  'APPROVED': 'APROVADO',
  'WAITING_PAYMENT': 'AGUARDANDO_PAGAMENTO',
  'PAYMENT_ANALYSIS': 'ANALISE_PAGAMENTO',
  'PAYMENT_REPROVED': 'PAGAMENTO_REPROVADO'
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. CACHE DE DEDUPLICAÇÃO
// ──────────────────────────────────────────────────────────────────────────────
const recentlyProcessed = new Map();

const isDuplicate = (key) => {
  const last = recentlyProcessed.get(key);
  if (last && Date.now() - last < 30000) return true;
  recentlyProcessed.set(key, Date.now());
  return false;
};

// ──────────────────────────────────────────────────────────────────────────────
// 3. FUNÇÃO PARA CALCULAR SLA
// ──────────────────────────────────────────────────────────────────────────────
function calcularSLA(createdAt) {
  if (!createdAt) return { sla: 'ok', horas: 0 };
  
  const createdDate = new Date(createdAt);
  const agora = new Date();
  const horasDecorridas = (agora - createdDate) / (1000 * 60 * 60);
  
  // Configuração dos limites (você pode ajustar)
  const WARNING_HOURS = process.env.SLA_WARNING_HOURS ? parseFloat(process.env.SLA_WARNING_HOURS) : 36;
  const CRITICAL_HOURS = process.env.SLA_CRITICAL_HOURS ? parseFloat(process.env.SLA_CRITICAL_HOURS) : 48;
  
  let sla = 'ok';
  if (horasDecorridas >= CRITICAL_HOURS) {
    sla = 'critical';
  } else if (horasDecorridas >= WARNING_HOURS) {
    sla = 'warning';
  }
  
  return { sla, horas: horasDecorridas };
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. BUSCAR DADOS COMPLETOS NA API
// ──────────────────────────────────────────────────────────────────────────────
async function buscarDetalhesPedido(pedidoId) {
  try {
    console.log(`🔍 Consultando AnyMarket API: ${pedidoId}`);
    
    const response = await axios.get(`${BASE_URL}/orders/${pedidoId}`, {
      headers: {
        'Content-Type': 'application/json',
        'gumgaToken': API_KEY
      },
      timeout: 60000
    });

    if (response.data) {
      console.log(`✅ Pedido AnyMarket ${pedidoId} encontrado`);
      return response.data;
    }
    return null;
  } catch (error) {
    console.error(`❌ Erro ao buscar pedido AnyMarket ${pedidoId}:`, error.response?.status, error.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. EXTRAIR INFORMAÇÕES RELEVANTES
// ──────────────────────────────────────────────────────────────────────────────
function extrairInfoRelevante(dados) {
  if (!dados) return null;

  try {
    return {
      id_anymarket: dados.id,
      numero_marketplace: dados.marketPlaceId,
      marketplace_number: dados.marketPlaceNumber || dados.marketPlaceId,
      marketplace: dados.marketPlace,
      status: dados.status || 'DESCONHECIDO',
      status_marketplace: dados.marketPlaceStatus || 'DESCONHECIDO',
      created_at: dados.createdAt || dados.created_at || new Date().toISOString(),
      // ME2 detection (Mercado Livre)
      produtos: (dados.items || []).map(item => ({
        shippingtype: item.shippings?.[0]?.shippingtype || ''
      }))
    };
  } catch (error) {
    console.error('❌ Erro ao extrair info AnyMarket:', error.message);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. FUNÇÃO PRINCIPAL - PROCESSAR WEBHOOK
// ──────────────────────────────────────────────────────────────────────────────
async function processWebhook(payload) {
  try {
    const { content, event } = payload;
    const idAnyMarket = content?.id;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📥 WEBHOOK ANYMARKET RECEBIDO!`);
    console.log(`   Evento: ${event}`);
    console.log(`   ID AnyMarket: ${idAnyMarket}`);

    // Deduplicação
    const dedupKey = `anymarket-${idAnyMarket}-${event}`;
    if (isDuplicate(dedupKey)) {
      console.log(`⏭️ Ignorando duplicata AnyMarket: ${idAnyMarket} - ${event}`);
      return { ok: true, dedup: true };
    }

    if (!idAnyMarket) {
      console.error(`❌ Webhook AnyMarket sem content.id`);
      return { ok: false, error: 'Webhook sem orderId' };
    }

    // 1️⃣ BUSCAR DADOS COMPLETOS NA API
    console.log(`🔍 Buscando dados completos do pedido ${idAnyMarket} na API...`);
    const jsonCompleto = await buscarDetalhesPedido(idAnyMarket);
    
    if (!jsonCompleto) {
      console.warn(`⚠️ Não conseguiu buscar dados da API AnyMarket ${idAnyMarket}`);
      return { ok: false, error: 'Falha ao buscar dados da API' };
    }

    // 2️⃣ EXTRAIR INFORMAÇÕES ESSENCIAIS
    const infoEssencial = extrairInfoRelevante(jsonCompleto);

    if (!infoEssencial || !infoEssencial.numero_marketplace) {
      console.error(`❌ Não conseguiu extrair numero_marketplace do pedido AnyMarket ${idAnyMarket}`);
      return { ok: false, error: 'Não foi possível extrair numero_marketplace' };
    }

    const numeroMarketplace = infoEssencial.numero_marketplace;
    const createdAt = infoEssencial.created_at;

    // 3️⃣ CALCULAR SLA
    const { sla: slaStatus, horas: horasDecorridas } = calcularSLA(createdAt);

    console.log(`✅ Marketplace ID obtido: ${numeroMarketplace}`);
    console.log(`🏪 Marketplace: ${infoEssencial.marketplace}`);
    console.log(`📊 Status: ${event} → ${STATUS_MAP[event] || event}`);
    console.log(`⏱️ SLA: ${slaStatus} | Tempo decorrido: ${horasDecorridas.toFixed(1)}h`);

    // 4️⃣ SALVAR MAPEAMENTO
    await pool.query(
      `INSERT INTO pedidos_mapeamento 
       (id_anymarket, numero_marketplace, marketplace_origem, criado_em, atualizado_em)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (numero_marketplace) DO UPDATE SET
         id_anymarket = $1,
         marketplace_origem = $3,
         atualizado_em = NOW()`,
      [idAnyMarket, numeroMarketplace, infoEssencial.marketplace]
    );

    // 5️⃣ NORMALIZAR STATUS
    const normalizedStatus = STATUS_MAP[event] || event;

    // 6️⃣ SALVAR TRACKING (com JSON COMPLETO e SLA!)
    await pool.query(
      `INSERT INTO tracking_events 
       (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em, sla_calculado, tempo_decorrido_horas) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
       ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
         timestamp = EXCLUDED.timestamp,
         payload = EXCLUDED.payload,
         dados_completos = EXCLUDED.dados_completos,
         sla_calculado = EXCLUDED.sla_calculado,
         tempo_decorrido_horas = EXCLUDED.tempo_decorrido_horas`,
      [
        uuidv4(),
        numeroMarketplace,
        'ANYMARKET',
        normalizedStatus,
        new Date(),
        JSON.stringify(payload),
        JSON.stringify(jsonCompleto),
        slaStatus,
        horasDecorridas
      ]
    );

    console.log(`✅ ANYMARKET ${numeroMarketplace} salvo com status ${normalizedStatus}`);

    // 7️⃣ PAID_WAITING_DELIVERY = AnyMarket confirmou envio
    if (event === 'PAID_WAITING_DELIVERY') {
      await pool.query(
        `INSERT INTO tracking_events 
         (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em, sla_calculado, tempo_decorrido_horas) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
         ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           payload = EXCLUDED.payload,
           sla_calculado = EXCLUDED.sla_calculado,
           tempo_decorrido_horas = EXCLUDED.tempo_decorrido_horas`,
        [
          uuidv4(),
          numeroMarketplace,
          'RETORNO_ANYMARKET',
          'ENVIADO',
          new Date(),
          JSON.stringify(payload),
          JSON.stringify(jsonCompleto),
          slaStatus,
          horasDecorridas
        ]
      );
      console.log(`↩️ [RETORNO_ANYMARKET] Pedido ${numeroMarketplace} confirmado como enviado`);
    }

    // 8️⃣ VERIFICAR ANOMALIA: FATURADO_APOS_ENVIO (exceto ME2)
    if (event === 'INVOICED') {
      const jetEnviado = await pool.query(
        `SELECT id FROM tracking_events 
         WHERE pedido_id = $1 AND origem = 'JET' AND status = 'ENVIADO' LIMIT 1`,
        [numeroMarketplace]
      );

      if (jetEnviado.rows.length) {
        const pedidoIsMe2 = infoEssencial.produtos?.some(item =>
          (item.shippingtype || '').toLowerCase().includes('me2')
        );
        
        if (!pedidoIsMe2) {
          console.warn(`⚠️ Pedido ${numeroMarketplace} ficou FATURADO após JET enviar (não é ME2)`);
          await anomalyDetector.createAnomaly(
            numeroMarketplace,
            'FATURADO_APOS_ENVIO',
            'ANYMARKET',
            infoEssencial.marketplace,
            { detalhes: 'AnyMarket ficou como Faturado após JET já ter confirmado envio' }
          );
        } else {
          console.log(`ℹ️ Pedido ${numeroMarketplace} ME2 - aguardando bipagem da etiqueta`);
        }
      }
    }

    // 9️⃣ VERIFICAR PIPELINE (anomalias de SLA, prazo, etc)
    console.log(`📊 Verificando pipeline do pedido ${numeroMarketplace}...`);
    await anomalyDetector.checkPipelineStatus(numeroMarketplace);

    // 🔟 REGISTRAR LOG DO WEBHOOK
    await pool.query(
      `INSERT INTO webhook_log (source, event_type, payload, received_at, processed)
       VALUES ($1, $2, $3, $4, $5)`,
      ['anymarket', event, JSON.stringify(payload), new Date(), 1]
    );

    console.log(`✅ Webhook AnyMarket ${idAnyMarket} processado com sucesso`);
    
    return { 
      ok: true, 
      orderId: idAnyMarket, 
      numero_marketplace: numeroMarketplace,
      status: normalizedStatus,
      marketplace: infoEssencial.marketplace,
      sla: slaStatus,
      horas_decorridas: horasDecorridas.toFixed(1)
    };

  } catch (error) {
    console.error('❌ Erro ao processar AnyMarket:', error.message);
    
    // Registrar erro no log
    try {
      await pool.query(
        `INSERT INTO webhook_log (source, event_type, payload, received_at, processed, error)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['anymarket', payload?.event || 'unknown', JSON.stringify(payload), new Date(), 0, error.message]
      );
    } catch (logErr) {
      console.error('❌ Erro ao logar:', logErr.message);
    }
    
    return { ok: false, error: error.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. FUNÇÃO PARA BUSCAR PEDIDOS (polling/backfill)
// ──────────────────────────────────────────────────────────────────────────────
async function fetchOrders(params) {
  if (params.limit && params.limit < 5) {
    params.limit = 5;
  }
  
  console.log(`[AnyMarket API] Buscando pedidos com:`, params);
  
  try {
    const response = await axios.get(`${BASE_URL}/orders`, {
      headers: {
        "gumgaToken": API_KEY,
        "Content-Type": "application/json",
      },
      params,
      timeout: 15000
    });
    
    const orders = response.data?.content || [];
    console.log(`[AnyMarket API] Resposta: ${orders.length} pedidos encontrados`);
    return orders;
  } catch (error) {
    console.error(`[AnyMarket API] Erro:`, error.response?.data || error.message);
    throw error;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. SINCRONIZAR PEDIDOS (buscar da API e salvar)
// ──────────────────────────────────────────────────────────────────────────────
async function syncOrders(since) {
  const sinceDate = since || new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const orders = await fetchOrders({ since: sinceDate, limit: 50 });
  let upserted = 0;

  for (const o of orders) {
    const jsonCompleto = await buscarDetalhesPedido(o.id);
    if (jsonCompleto) {
      const infoEssencial = extrairInfoRelevante(jsonCompleto);
      if (infoEssencial?.numero_marketplace) {
        const { sla: slaStatus, horas: horasDecorridas } = calcularSLA(infoEssencial.created_at);
        
        await pool.query(
          `INSERT INTO pedidos_mapeamento 
           (id_anymarket, numero_marketplace, marketplace_origem, criado_em, atualizado_em)
           VALUES ($1, $2, $3, NOW(), NOW())
           ON CONFLICT (numero_marketplace) DO UPDATE SET
             id_anymarket = $1,
             atualizado_em = NOW()`,
          [o.id, infoEssencial.numero_marketplace, infoEssencial.marketplace]
        );
        
        await pool.query(
          `INSERT INTO tracking_events 
           (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em, sla_calculado, tempo_decorrido_horas) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
           ON CONFLICT (pedido_id, origem, status) DO NOTHING`,
          [
            uuidv4(),
            infoEssencial.numero_marketplace,
            'ANYMARKET',
            'PENDENTE',
            new Date(infoEssencial.created_at),
            JSON.stringify({ event: 'backfill' }),
            JSON.stringify(jsonCompleto),
            slaStatus,
            horasDecorridas
          ]
        );
        upserted++;
      }
    }
  }

  console.log(`[Anymarket] Sincronizados ${upserted} pedidos`);
  return upserted;
}

// ──────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────────────────────
module.exports = { 
  processWebhook,
  buscarDetalhesPedido,
  extrairInfoRelevante,
  fetchOrders,
  syncOrders,
  calcularSLA
};