// backend/src/services/backfill.service.js
const { v4: uuidv4 } = require('uuid');
const db = require("../../config/database");
const anymarketService = require("./anymarket.service");
const jetService = require("./jet.service");

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================
// BACKFILL ANYMARKET (busca pedidos históricos)
// ============================================================
async function backfillAnymarket({ dateFrom, dateTo, onProgress } = {}) {
  if (currentRun && currentRun.status === "running") {
    throw new Error("Já existe um backfill em andamento");
  }

  currentRun = {
    status: "running",
    type: "anymarket",
    inserted: 0,
    updated: 0,
    skipped: 0,
    total_found: 0,
    status_changes: 0,
  };

  const PAGE_SIZE = 50;
  const STATUS_LIST = ["INVOICED", "CANCELED", "PAID_WAITING_SHIP", "PAID_WAITING_DELIVERY", "CONCLUDED"];

  console.log(`[Backfill AnyMarket] Iniciando com período: ${dateFrom} até ${dateTo || 'hoje'}`);

  try {
    let totalStatus = STATUS_LIST.length;
    let statusIndex = 0;

    for (const situationCode of STATUS_LIST) {
      let offset = 0;
      let hasMore = true;
      let pageCount = 0;

      console.log(`[Backfill AnyMarket] Buscando status: ${situationCode}`);

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

          const statusPercent = (statusIndex / totalStatus) * 100;
          const pagePercent = (pageCount / 10) * (100 / totalStatus);
          let percent = Math.min(99, Math.floor(statusPercent + pagePercent));
          
          if (currentRun.total_found > 1000) {
            percent = Math.min(99, Math.floor((currentRun.total_found / 10000) * 100));
          }

          console.log(`[Backfill AnyMarket] ${situationCode} - Página ${pageCount + 1}: ${orders.length} pedidos`);

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
          console.error(`[Backfill AnyMarket] Erro na busca:`, err.message);
          break;
        }
      }
      statusIndex++;
    }

    currentRun.status = "done";
    console.log(`[Backfill AnyMarket] ===== RESUMO FINAL =====`);
    console.log(`[Backfill AnyMarket] Total encontrado: ${currentRun.total_found}`);
    console.log(`[Backfill AnyMarket] Inseridos: ${currentRun.inserted}`);
    console.log(`[Backfill AnyMarket] Atualizados: ${currentRun.updated}`);
    console.log(`[Backfill AnyMarket] Mudanças de status: ${currentRun.status_changes}`);
    console.log(`[Backfill AnyMarket] Ignorados: ${currentRun.skipped}`);
    
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
    console.error(`[Backfill AnyMarket] ERRO FATAL:`, err);
    if (onProgress) {
      onProgress({ type: 'error', message: err.message });
    }
    throw err;
  }
}

// ============================================================
// UPSERT ORDER (com campos completos)
// ============================================================
async function upsertOrder(o) {
  const anymarketId = String(o.id);
  const numeroMarketplace = String(o.marketPlaceId || o.marketplaceOrderId || "");
  const createdAt = o.createdAt || o.created_at || new Date().toISOString();
  
  const currentStatusRaw = o.status || o.situationCode;
  const currentStatus = normalizeAnymarketStatus(currentStatusRaw);
  
  const marketplaceOrigem = o.marketPlace || o.marketplaceName || null;
  const loja = o.accountName || null;
  const marketplaceCanal = o.marketPlace || o.marketplaceName || null;
  const promisedShippingTime = o.shipping?.promisedShippingTime;
  const prazoDespacho = promisedShippingTime ? new Date(promisedShippingTime) : null;

  // Verificar se o pedido já existe
  const existing = await db.query(
    `SELECT id, id_anymarket, numero_marketplace 
     FROM pedidos_mapeamento 
     WHERE numero_marketplace = $1 OR id_anymarket = $2`,
    [numeroMarketplace, anymarketId]
  );

  if (existing.rows.length > 0) {
    // ATUALIZAR pedido existente
    await db.query(`
      UPDATE pedidos_mapeamento 
      SET id_anymarket = $1, 
          marketplace_origem = COALESCE(pedidos_mapeamento.marketplace_origem, $2),
          loja = COALESCE(pedidos_mapeamento.loja, $3),
          marketplace_canal = COALESCE(pedidos_mapeamento.marketplace_canal, $4),
          prazo_despacho = COALESCE(pedidos_mapeamento.prazo_despacho, $5),
          atualizado_em = NOW()
      WHERE numero_marketplace = $6
    `, [anymarketId, marketplaceOrigem, loja, marketplaceCanal, prazoDespacho, numeroMarketplace]);
    
    return "updated";
    
  } else {
    // INSERT - Novo pedido
    await db.query(`
      INSERT INTO pedidos_mapeamento (
        id_anymarket, 
        numero_marketplace, 
        marketplace_origem, 
        loja, 
        marketplace_canal,
        prazo_despacho,
        criado_em, 
        atualizado_em
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    `, [anymarketId, numeroMarketplace, marketplaceOrigem, loja, marketplaceCanal, prazoDespacho]);
    
    // Criar tracking event básico
    await db.query(`
      INSERT INTO tracking_events (
        id, pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
      )
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
      ON CONFLICT (pedido_id, origem, status) 
      DO NOTHING
    `, [
      uuidv4(), 
      numeroMarketplace, 
      'ANYMARKET', 
      currentStatus, 
      createdAt, 
      JSON.stringify({ event: 'backfill', order_id: anymarketId }),
      JSON.stringify(o)
    ]);
    
    return "inserted";
  }
}

// ============================================================
// BACKFILL JET - ENRIQUECER PEDIDOS QUE JÁ TÊM ID_JET
// ============================================================
async function backfillJet({ onProgress } = {}) {
  if (currentRun && currentRun.status === "running") {
    throw new Error("Já existe um backfill em andamento");
  }

  currentRun = {
    status: "running",
    type: "jet",
    total: 0,
    updated: 0,
    events_created: 0,
    errors: 0,
    skipped: 0
  };

  console.log(`[Backfill JET] Iniciando enriquecimento de pedidos com id_jet...`);

  try {
    // Buscar pedidos que JÁ TÊM id_jet, mas faltam dados (delivery_time_jet vazio)
    const { rows: pedidos } = await db.query(`
      SELECT 
        numero_marketplace, 
        id_jet,
        marketplace_origem,
        delivery_time_jet
      FROM pedidos_mapeamento 
      WHERE id_jet IS NOT NULL 
        AND id_jet != ''
        AND (delivery_time_jet IS NULL OR delivery_time_jet = 0)
      ORDER BY criado_em DESC
      LIMIT 500
    `);

    currentRun.total = pedidos.length;
    console.log(`[Backfill JET] Encontrados ${pedidos.length} pedidos para enriquecer`);

    if (onProgress) {
      onProgress({ type: 'start', total: pedidos.length });
    }

    for (let i = 0; i < pedidos.length; i++) {
      const pedido = pedidos[i];
      
      try {
        console.log(`[Backfill JET] Processando ${i+1}/${pedidos.length}: ${pedido.numero_marketplace} (id_jet: ${pedido.id_jet})`);
        
        // Buscar dados completos na API da JET usando o id_jet que já temos
        const jetData = await jetService.buscarDetalhesPedido(pedido.id_jet);
        
        if (jetData) {
          // Extrair dados do JSON
          const deliveryTime = jetData.deliveryTime || 0;
          const prazoPreparacaoHoras = deliveryTime === 0 ? 24 : deliveryTime * 24;
          
          // Atualizar pedido_mapeamento com deliveryTime e prazo
          await db.query(`
            UPDATE pedidos_mapeamento 
            SET delivery_time_jet = $1,
                prazo_preparacao_horas = $2,
                atualizado_em = NOW()
            WHERE numero_marketplace = $3
          `, [deliveryTime, prazoPreparacaoHoras, pedido.numero_marketplace]);
          
          currentRun.updated++;
          
          // Verificar se já existem eventos JET para este pedido
          const eventosExistentes = await db.query(`
            SELECT id FROM tracking_events 
            WHERE pedido_id = $1 AND origem = 'JET'
            LIMIT 1
          `, [pedido.numero_marketplace]);
          
          // Criar eventos históricos se não existirem
          if (eventosExistentes.rows.length === 0) {
            const history = jetData.historyListOrderStatus || [];
            let eventosCriados = 0;
            
            // Percorrer histórico de status da JET
            for (const statusHistory of history) {
              const statusCode = statusHistory.statusCode;
              const dateRegister = statusHistory.dateRegisterStatus;
              
              let statusName = 'DESCONHECIDO';
              if (statusCode === '01') statusName = 'INTEGRADO';
              if (statusCode === '04') statusName = 'PROCESSANDO';
              if (statusCode === '07') statusName = 'EM_PRODUCAO';
              if (statusCode === '05') statusName = 'PRONTO';
              
              if (statusName !== 'DESCONHECIDO' && dateRegister) {
                await db.query(`
                  INSERT INTO tracking_events 
                  (id, pedido_id, origem, status, timestamp, dados_completos, criado_em)
                  VALUES ($1, $2, $3, $4, $5, $6, NOW())
                  ON CONFLICT (pedido_id, origem, status) DO NOTHING
                `, [
                  uuidv4(),
                  pedido.numero_marketplace,
                  'JET',
                  statusName,
                  new Date(dateRegister),
                  JSON.stringify(jetData)
                ]);
                eventosCriados++;
              }
            }
            
            // Se não criou nenhum evento, cria pelo menos um básico
            if (eventosCriados === 0) {
              const dataCriacao = jetData.dateOrder || jetData.marketPlaceDateCreated;
              if (dataCriacao) {
                await db.query(`
                  INSERT INTO tracking_events 
                  (id, pedido_id, origem, status, timestamp, dados_completos, criado_em)
                  VALUES ($1, $2, $3, $4, $5, $6, NOW())
                  ON CONFLICT (pedido_id, origem, status) DO NOTHING
                `, [
                  uuidv4(),
                  pedido.numero_marketplace,
                  'JET',
                  'INTEGRADO',
                  new Date(dataCriacao),
                  JSON.stringify(jetData)
                ]);
                eventosCriados = 1;
              }
            }
            
            currentRun.events_created += eventosCriados;
            console.log(`[Backfill JET] ✅ Criados ${eventosCriados} eventos para ${pedido.numero_marketplace} (deliveryTime: ${deliveryTime} dias)`);
          } else {
            console.log(`[Backfill JET] ✅ Já existem eventos para ${pedido.numero_marketplace}, apenas atualizado deliveryTime: ${deliveryTime} dias`);
          }
          
        } else {
          currentRun.errors++;
          console.log(`[Backfill JET] ❌ Não foi possível buscar dados da JET para id_jet: ${pedido.id_jet}`);
        }
        
        // Progresso a cada 10 pedidos
        if ((i + 1) % 10 === 0 && onProgress) {
          onProgress({
            type: 'progress',
            processed: i + 1,
            total: pedidos.length,
            updated: currentRun.updated,
            events_created: currentRun.events_created,
            errors: currentRun.errors,
            percent: Math.round(((i + 1) / pedidos.length) * 100)
          });
        }
        
        await sleep(500); // Delay para não sobrecarregar a API
        
      } catch (error) {
        currentRun.errors++;
        console.error(`[Backfill JET] Erro no pedido ${pedido.numero_marketplace}:`, error.message);
      }
    }

    currentRun.status = "done";
    console.log(`\n[Backfill JET] ===== RESUMO FINAL =====`);
    console.log(`[Backfill JET] Total processados: ${currentRun.total}`);
    console.log(`[Backfill JET] Pedidos enriquecidos: ${currentRun.updated}`);
    console.log(`[Backfill JET] Eventos criados: ${currentRun.events_created}`);
    console.log(`[Backfill JET] Erros: ${currentRun.errors}`);
    console.log(`[Backfill JET] Ignorados: ${currentRun.skipped}`);

    if (onProgress) {
      onProgress({ type: 'done', ...currentRun });
    }

    return currentRun;

  } catch (err) {
    currentRun.status = "error";
    currentRun.error = err.message;
    console.error(`[Backfill JET] ERRO FATAL:`, err);
    if (onProgress) {
      onProgress({ type: 'error', message: err.message });
    }
    throw err;
  }
}

// ============================================================
// CORRIGIR PEDIDOS EXISTENTES (metadados faltantes)
// ============================================================
async function corrigirPedidosExistentes({ onProgress } = {}) {
  if (currentRun && currentRun.status === "running") {
    throw new Error("Já existe um backfill em andamento");
  }

  currentRun = {
    status: "running",
    type: "correcao",
    total: 0,
    atualizados: 0,
    erros: 0
  };

  console.log(`[Correção] Buscando pedidos com dados faltantes...`);

  try {
    const { rows: pedidos } = await db.query(`
      SELECT 
        numero_marketplace,
        id_anymarket
      FROM pedidos_mapeamento 
      WHERE (loja IS NULL OR loja = '')
         OR (marketplace_canal IS NULL OR marketplace_canal = '')
         OR (prazo_despacho IS NULL)
        AND id_anymarket IS NOT NULL
      ORDER BY criado_em DESC
      LIMIT 500
    `);

    currentRun.total = pedidos.length;
    console.log(`[Correção] Encontrados ${pedidos.length} pedidos para corrigir`);

    if (onProgress) {
      onProgress({ type: 'start', total: pedidos.length });
    }

    for (let i = 0; i < pedidos.length; i++) {
      const pedido = pedidos[i];
      
      try {
        const anymarketData = await anymarketService.buscarDetalhesPedido(pedido.id_anymarket);
        
        if (anymarketData) {
          const loja = anymarketData.accountName || null;
          const marketplaceCanal = anymarketData.marketPlace || null;
          const promisedShippingTime = anymarketData.shipping?.promisedShippingTime;
          const prazoDespacho = promisedShippingTime ? new Date(promisedShippingTime) : null;
          
          await db.query(`
            UPDATE pedidos_mapeamento 
            SET loja = COALESCE(pedidos_mapeamento.loja, $1),
                marketplace_canal = COALESCE(pedidos_mapeamento.marketplace_canal, $2),
                prazo_despacho = COALESCE(pedidos_mapeamento.prazo_despacho, $3),
                atualizado_em = NOW()
            WHERE numero_marketplace = $4
          `, [loja, marketplaceCanal, prazoDespacho, pedido.numero_marketplace]);
          
          currentRun.atualizados++;
          console.log(`[Correção] ✅ Atualizado: ${pedido.numero_marketplace}`);
        } else {
          currentRun.erros++;
        }
        
        if ((i + 1) % 10 === 0 && onProgress) {
          onProgress({
            type: 'progress',
            processed: i + 1,
            total: pedidos.length,
            atualizados: currentRun.atualizados,
            percent: Math.round(((i + 1) / pedidos.length) * 100)
          });
        }
        
        await sleep(200);
        
      } catch (error) {
        currentRun.erros++;
        console.error(`[Correção] Erro:`, error.message);
      }
    }

    currentRun.status = "done";
    console.log(`[Correção] ===== RESUMO FINAL =====`);
    console.log(`[Correção] Total: ${currentRun.total}`);
    console.log(`[Correção] Atualizados: ${currentRun.atualizados}`);
    console.log(`[Correção] Erros: ${currentRun.erros}`);

    if (onProgress) {
      onProgress({ type: 'done', ...currentRun });
    }

    return currentRun;

  } catch (err) {
    currentRun.status = "error";
    currentRun.error = err.message;
    console.error(`[Correção] ERRO FATAL:`, err);
    if (onProgress) {
      onProgress({ type: 'error', message: err.message });
    }
    throw err;
  }
}

// ============================================================
// BACKFILL COMPLETO
// ============================================================
async function backfillAll({ dateFrom, dateTo, onProgress } = {}) {
  const results = {};
  
  if (onProgress) onProgress({ phase: "anymarket", status: "starting" });
  results.anymarket = await backfillAnymarket({ dateFrom, dateTo, onProgress });
  
  if (onProgress) onProgress({ phase: "jet", status: "starting" });
  results.jet = await backfillJet({ onProgress });
  
  return results;
}

async function recalcAllSla() {
  console.log(`[Backfill] Recalculando SLA...`);
  // Implementar se necessário
}

async function getRunHistory(limit = 20) {
  return [];
}

module.exports = {
  backfillAnymarket,
  backfillJet,
  backfillAll,
  corrigirPedidosExistentes,
  recalcAllSla,
  getRunHistory,
  getProgress,
};