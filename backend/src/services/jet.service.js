// backend/src/services/jet.service.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const pool = require("../../config/database");

const API_KEY = process.env.JET_API_TOKEN;
const BASE_URL = 'https://openapi.plataformaneo.com.br/order/api/v1/id';

if (!API_KEY) {
  console.warn('⚠️ Aviso: JET_API_TOKEN não configurado. As buscas de pedidos falharão.');
}

// Mapeamento de status JET (igual ao antigo)
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
  'cancelled': 'CANCELADO',
  'approved': 'APROVADO',
  'invoiced': 'FATURADO'
};

// Cache de deduplicação
const recentlyProcessed = new Map();

const isDuplicate = (key) => {
  const last = recentlyProcessed.get(key);
  if (last && Date.now() - last < 30000) return true;
  recentlyProcessed.set(key, Date.now());
  return false;
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Cache de pedidos da API (24 horas)
const cachePedidos = new Map();

// ──────────────────────────────────────────────────────────────────────────────
// 1. BUSCAR DETALHES DO PEDIDO NA API JET
// ──────────────────────────────────────────────────────────────────────────────
async function buscarDetalhesPedido(idOrder, tentativa = 1) {
  const maxTentativas = 3;

  // Verifica cache
  if (cachePedidos.has(idOrder)) {
    const cached = cachePedidos.get(idOrder);
    if (Date.now() - cached.timestamp < 86400000) { // 24 horas
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

// ──────────────────────────────────────────────────────────────────────────────
// 2. EXTRAIR INFORMAÇÕES RELEVANTES (numero_marketplace, etc)
// ──────────────────────────────────────────────────────────────────────────────
function extrairInfoRelevante(detalhes) {
  if (!detalhes) return null;

  return {
    id: detalhes.idOrder,
    numero_marketplace: detalhes.marketPlaceNumberOrder,
    marketplace: detalhes.marketPlaceName,
    status: detalhes.historyListOrderStatus?.[0]?.statusCode || 'DESCONHECIDO'
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. PROCESSAR WEBHOOK JET (igual ao antigo)
// ──────────────────────────────────────────────────────────────────────────────
async function processWebhook(payload) {
  try {
    const { Id: idInterno, ModifiedId: numeroPedido, Event, EventOccurredAt } = payload;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📥 WEBHOOK JET RECEBIDO!`);
    console.log(`   Evento: ${Event}`);
    console.log(`   ID Interno: ${idInterno}`);
    console.log(`   Número Pedido: ${numeroPedido}`);

    // Deduplicação
    const dedupKeyJet = `jet-${idInterno}-${Event}`;
    if (isDuplicate(dedupKeyJet)) {
      console.log(`⏭️ Ignorando duplicata JET: ${idInterno} - ${Event}`);
      return { ok: true, dedup: true };
    }

    if (!numeroPedido) {
      console.error(`❌ Webhook JET sem numeroPedido`);
      return { ok: false, error: 'Webhook sem numeroPedido' };
    }

    // 1️⃣ BUSCAR DADOS COMPLETOS NA API
    console.log(`🔍 Buscando dados completos do pedido JET ${numeroPedido} na API...`);
    const jsonCompleto = await buscarDetalhesPedido(numeroPedido);
    
    if (!jsonCompleto) {
      console.warn(`⚠️ Não conseguiu buscar dados da API JET ${numeroPedido}`);
      return await salvarWebhookSemAPI(idInterno, numeroPedido, Event, EventOccurredAt, payload);
    }

    // 2️⃣ EXTRAIR INFORMAÇÕES ESSENCIAIS
    const infoEssencial = extrairInfoRelevante(jsonCompleto);

    if (!infoEssencial || !infoEssencial.numero_marketplace) {
      console.warn(`⚠️ Não conseguiu extrair numero_marketplace do pedido JET ${numeroPedido}`);
      return await salvarWebhookSemAPI(idInterno, numeroPedido, Event, EventOccurredAt, payload);
    }

    const numeroMarketplace = infoEssencial.numero_marketplace;
    const normalizedStatus = STATUS_MAP[Event] || Event;

    console.log(`✅ Marketplace ID: ${numeroMarketplace}`);
    console.log(`🏪 Marketplace: ${infoEssencial.marketplace}`);
    console.log(`📊 Status: ${Event} → ${normalizedStatus}`);

    // 3️⃣ SALVAR EVENTO JET
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
        new Date(EventOccurredAt),
        JSON.stringify(payload),
        JSON.stringify(jsonCompleto)
      ]
    );

    console.log(`✅ JET ${numeroPedido} - Evento ${Event} salvo`);

    // 4️⃣ SALVAR MAPEAMENTO
    await pool.query(
      `INSERT INTO pedidos_mapeamento 
       (id_jet, numero_marketplace, atualizado_em)
       VALUES ($1, $2, NOW())
       ON CONFLICT (numero_marketplace) DO UPDATE SET
         id_jet = $1,
         atualizado_em = NOW()`,
      [numeroPedido, numeroMarketplace]
    );

    // 5️⃣ EVENTOS ESPECÍFICOS: Pedido em produção
    if (Event === 'Pedido.EmProducao') {
      await pool.query(
        `INSERT INTO tracking_events 
         (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           payload = EXCLUDED.payload`,
        [
          uuidv4(),
          numeroMarketplace,
          'ONCLICK',
          'EM_PRODUCAO',
          new Date(EventOccurredAt),
          JSON.stringify({ inferido_de: 'JET', evento_jet: Event }),
          JSON.stringify({ inferido_de: 'JET', evento_jet: Event, json_completo_jet: jsonCompleto })
        ]
      );
      console.log(`🏭 [ONCLICK] Pedido ${numeroMarketplace} em produção (via JET.EmProducao)`);
    }

    // 6️⃣ EVENTOS ESPECÍFICOS: Pedido enviado
    if (Event === 'Pedido.Enviado') {
      // Inferir saída da ONCLICK
      await pool.query(
        `INSERT INTO tracking_events 
         (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           payload = EXCLUDED.payload`,
        [
          uuidv4(),
          numeroMarketplace,
          'ONCLICK',
          'FATURADO_ENVIADO',
          new Date(EventOccurredAt),
          JSON.stringify({ inferido_de: 'JET', evento_jet: Event }),
          JSON.stringify({ inferido_de: 'JET', evento_jet: Event, json_completo_jet: jsonCompleto })
        ]
      );
      console.log(`📦 [ONCLICK] Pedido ${numeroMarketplace} faturado e enviado (via JET.Enviado)`);

      // Gravar RETORNO_JET
      await pool.query(
        `INSERT INTO tracking_events 
         (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
           timestamp = EXCLUDED.timestamp,
           payload = EXCLUDED.payload`,
        [
          uuidv4(),
          numeroMarketplace,
          'RETORNO_JET',
          'CONFIRMADO',
          new Date(EventOccurredAt),
          JSON.stringify(payload),
          JSON.stringify(jsonCompleto)
        ]
      );
      console.log(`↩️ [RETORNO_JET] Pedido ${numeroMarketplace} confirmado como enviado`);
    }

    // Registrar log
    await pool.query(
      `INSERT INTO webhook_log (source, event_type, payload, received_at, processed)
       VALUES ($1, $2, $3, $4, $5)`,
      ['jet', Event, JSON.stringify(payload), new Date(), true]
    );

    console.log(`✅ Webhook JET ${idInterno} processado com sucesso`);
    
    return { 
      ok: true, 
      orderId: idInterno, 
      numero_marketplace: numeroMarketplace,
      status: normalizedStatus
    };

  } catch (error) {
    console.error('❌ Erro ao processar JET:', error.message);
    return { ok: false, error: error.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. SALVAR WEBHOOK SEM DADOS DA API (fallback)
// ──────────────────────────────────────────────────────────────────────────────
async function salvarWebhookSemAPI(idInterno, numeroPedido, event, eventOccurredAt, payload) {
  try {
    const normalizedStatus = STATUS_MAP[event] || event;

    await pool.query(
      `INSERT INTO tracking_events 
       (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (pedido_id, origem, status) DO UPDATE SET
         timestamp = EXCLUDED.timestamp,
         payload = EXCLUDED.payload`,
      [
        uuidv4(),
        numeroPedido,
        'JET',
        normalizedStatus,
        new Date(eventOccurredAt),
        JSON.stringify(payload),
        JSON.stringify({ erro: 'Não foi possível buscar dados da API JET', webhook_original: payload })
      ]
    );

    await pool.query(
      `INSERT INTO webhook_log (source, event_type, payload, received_at, processed)
       VALUES ($1, $2, $3, $4, $5)`,
      ['jet', event, JSON.stringify(payload), new Date(), true]
    );

    console.log(`✅ JET ${numeroPedido} salvo (sem dados da API)`);
    return { ok: true, fallback: true, numero_marketplace: numeroPedido };
  } catch (error) {
    console.error('❌ Erro ao salvar webhook JET:', error.message);
    return { ok: false, error: error.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. STATUS DO CACHE
// ──────────────────────────────────────────────────────────────────────────────
function statusCache() {
  const total = cachePedidos.size;
  console.log(`📊 Cache JET: ${total} pedido${total !== 1 ? 's' : ''} armazenado${total !== 1 ? 's' : ''}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────────────────────
module.exports = {
  buscarDetalhesPedido,
  extrairInfoRelevante,
  processWebhook,
  statusCache
};