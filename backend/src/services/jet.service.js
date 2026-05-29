// backend/src/services/jet.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const pool = require("../../config/database");

const API_KEY = process.env.JET_API_TOKEN;
const BASE_URL = 'https://openapi.plataformaneo.com.br/order/api/v1/id';

if (!API_KEY) {
  console.warn('⚠️ Aviso: JET_API_TOKEN não configurado. As buscas de pedidos falharão.');
}

// Mapeamento de status
const STATUS_MAP = {
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
  'cancelled': 'CANCELADO'
};

// Cache em memória
const recentlyProcessed = new Map();
const cachePedidos = new Map();

const isDuplicate = (key) => {
  const last = recentlyProcessed.get(key);
  if (last && Date.now() - last < 30000) return true;
  recentlyProcessed.set(key, Date.now());
  return false;
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Buscar detalhes do pedido na API
async function buscarDetalhesPedido(idOrder, tentativa = 1) {
  const maxTentativas = 3;

  if (cachePedidos.has(idOrder)) {
    const cached = cachePedidos.get(idOrder);
    if (Date.now() - cached.timestamp < 86400000) {
      console.log(`📦 Pedido JET ${idOrder} veio do cache`);
      return cached.dados;
    }
  }

  const url = `${BASE_URL}/${idOrder}`;

  for (let tentativaAtual = 1; tentativaAtual <= maxTentativas; tentativaAtual++) {
    try {
      console.log(`🔍 Buscando pedido JET ${idOrder} (tentativa ${tentativaAtual}/${maxTentativas})...`);
      const inicio = Date.now();

      const response = await axios({
        method: 'GET',
        url: url,
        headers: {
          'apiKey': API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      });

      const tempo = Date.now() - inicio;

      if (response.data) {
        console.log(`✅ Pedido JET ${idOrder} obtido em ${tempo / 1000}s`);
        const dados = response.data.result || response.data;
        
        cachePedidos.set(idOrder, { dados: dados, timestamp: Date.now() });
        return dados;
      }

    } catch (error) {
      const isTimeout = error.code === 'ECONNABORTED';
      const status = error.response?.status;

      if (isTimeout) {
        console.log(`⏳ Timeout na tentativa ${tentativaAtual}, aguardando 3s...`);
        await delay(3000);
        continue;
      }

      if (status === 404 && tentativaAtual < maxTentativas) {
        console.log(`⚠️ Pedido JET ${idOrder} não encontrado (404), aguardando e tentando novamente...`);
        await delay(3000);
        continue;
      }

      if (tentativaAtual === maxTentativas) {
        console.error(`❌ Erro ao buscar pedido JET ${idOrder}:`, isTimeout ? 'Timeout' : (status || error.message));
      }
    }
  }

  return null;
}

// Extrair informações relevantes
function extrairInfoRelevante(detalhes) {
  if (!detalhes) return null;

  return {
    id: detalhes.idOrder,
    numero_marketplace: detalhes.marketPlaceNumberOrder,
    marketplace: detalhes.marketPlaceName,
    status: detalhes.historyListOrderStatus?.[0]?.statusCode || 'DESCONHECIDO'
  };
}

// Processar webhook PRINCIPAL
async function processWebhook(payload) {
  try {
    // Aceita diferentes formatos de payload
    const idInterno = payload.Id || payload.id || payload.orderId;
    const numeroPedido = payload.ModifiedId || payload.modifiedId || payload.marketPlaceNumberOrder;
    const event = payload.Event || payload.event || payload.status;
    const eventOccurredAt = payload.EventOccurredAt || payload.eventOccurredAt || payload.timestamp || new Date().toISOString();

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📥 WEBHOOK JET RECEBIDO!`);
    console.log(`   Evento: ${event}`);
    console.log(`   ID Interno: ${idInterno}`);
    console.log(`   Número Pedido: ${numeroPedido}`);

    // Deduplicação
    const dedupKey = `jet-${idInterno}-${event}`;
    if (isDuplicate(dedupKey)) {
      console.log(`⏭️ Ignorando duplicata JET: ${idInterno} - ${event}`);
      return { ok: true, dedup: true };
    }

    if (!numeroPedido && !idInterno) {
      console.error(`❌ Webhook JET sem identificador`);
      return { ok: false, error: 'Sem identificador' };
    }

    const searchId = numeroPedido || idInterno;

    // Buscar dados completos na API
    console.log(`🔍 Buscando dados completos do pedido ${searchId} na API...`);
    const jsonCompleto = await buscarDetalhesPedido(searchId);
    
    if (!jsonCompleto) {
      console.warn(`⚠️ Não conseguiu buscar dados da API JET para ${searchId}`);
      return await salvarWebhookSemAPI(idInterno, searchId, event, eventOccurredAt, payload);
    }

    const infoEssencial = extrairInfoRelevante(jsonCompleto);

    if (!infoEssencial || !infoEssencial.numero_marketplace) {
      console.warn(`⚠️ Não conseguiu extrair numero_marketplace`);
      return await salvarWebhookSemAPI(idInterno, searchId, event, eventOccurredAt, payload);
    }

    const numeroMarketplace = infoEssencial.numero_marketplace;
    const normalizedStatus = STATUS_MAP[event] || event;

    console.log(`✅ Marketplace ID: ${numeroMarketplace}`);
    console.log(`🏪 Marketplace: ${infoEssencial.marketplace}`);
    console.log(`📊 Status: ${event} → ${normalizedStatus}`);

    // Salvar evento JET
    await pool.query(
      `INSERT INTO tracking_events 
       (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
         timestamp = EXCLUDED.timestamp,
         payload = EXCLUDED.payload,
         dados_completos = EXCLUDED.dados_completos`,
      [
        uuidv4(),
        numeroMarketplace,
        'JET',
        normalizedStatus,
        new Date(eventOccurredAt),
        JSON.stringify(payload),
        JSON.stringify(jsonCompleto)
      ]
    );

    console.log(`✅ JET ${numeroMarketplace} - Evento ${event} salvo`);

    // Salvar/atualizar mapeamento
    await pool.query(
      `INSERT INTO pedidos_mapeamento 
       (id_jet, numero_marketplace, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (numero_marketplace) DO UPDATE SET
         id_jet = $1,
         atualizado_em = NOW()`,
      [searchId, numeroMarketplace]
    );

    // Eventos especiais
    if (event === 'Pedido.EmProducao') {
      await pool.query(
        `INSERT INTO tracking_events 
         (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (pedido_id, origem, status) DO NOTHING`,
        [
          uuidv4(),
          numeroMarketplace,
          'ONCLICK',
          'EM_PRODUCAO',
          new Date(eventOccurredAt),
          JSON.stringify({ inferido_de: 'JET', evento_jet: event }),
          JSON.stringify({ inferido_de: 'JET', json_completo_jet: jsonCompleto })
        ]
      );
      console.log(`🏭 [ONCLICK] Pedido ${numeroMarketplace} em produção`);
    }

    if (event === 'Pedido.Enviado') {
      await pool.query(
        `INSERT INTO tracking_events 
         (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (pedido_id, origem, status) DO NOTHING`,
        [
          uuidv4(),
          numeroMarketplace,
          'RETORNO_JET',
          'CONFIRMADO',
          new Date(eventOccurredAt),
          JSON.stringify(payload),
          JSON.stringify(jsonCompleto)
        ]
      );
      console.log(`↩️ [RETORNO_JET] Pedido ${numeroMarketplace} confirmado`);
    }

    // Log do webhook
    await pool.query(
      `INSERT INTO webhook_log (source, event_type, payload, received_at, processed)
       VALUES ($1, $2, $3, $4, $5)`,
      ['jet', event, JSON.stringify(payload), new Date(), true]
    );

    console.log(`✅ Webhook JET processado com sucesso`);
    
    return { ok: true, numero_marketplace: numeroMarketplace, status: normalizedStatus };

  } catch (error) {
    console.error('❌ Erro ao processar JET:', error.message);
    return { ok: false, error: error.message };
  }
}

// Fallback quando não consegue buscar dados da API
async function salvarWebhookSemAPI(idInterno, numeroPedido, event, eventOccurredAt, payload) {
  try {
    const normalizedStatus = STATUS_MAP[event] || event;

    await pool.query(
      `INSERT INTO tracking_events 
       (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (pedido_id, origem, status) DO NOTHING`,
      [
        uuidv4(),
        numeroPedido,
        'JET',
        normalizedStatus,
        new Date(eventOccurredAt),
        JSON.stringify(payload),
        JSON.stringify({ erro: 'Não foi possível buscar dados da API JET' })
      ]
    );

    await pool.query(
      `INSERT INTO webhook_log (source, event_type, payload, received_at, processed)
       VALUES ($1, $2, $3, $4, $5)`,
      ['jet', event, JSON.stringify(payload), new Date(), true]
    );

    console.log(`✅ JET ${numeroPedido} salvo em modo fallback`);
    return { ok: true, fallback: true };
  } catch (error) {
    console.error('❌ Erro no fallback:', error.message);
    return { ok: false, error: error.message };
  }
}

module.exports = {
  buscarDetalhesPedido,
  extrairInfoRelevante,
  processWebhook
};