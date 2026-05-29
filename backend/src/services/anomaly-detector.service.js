// backend/src/services/anomaly-detector.service.js
const pool = require("../../config/database");
const { v4: uuidv4 } = require('uuid');

// Configurações (igual ao antigo)
const SLA_ENTRE_ESTAGIOS = {
  ANYMARKET_para_JET: { horas: 2 },
  JET_para_ONCLICK: { horas: 1 }
};

const PRAZO_DESPACHO_MARKETPLACE = {
  default: { horas: 48, alerta_percentual: 80 },
  MAGAZINE_LUIZA: { horas: 48, alerta_percentual: 80 },
  MERCADO_LIVRE: { horas: 48, alerta_percentual: 80 },
  AMAZON: { horas: 48, alerta_percentual: 80 },
  SHOPEE: { horas: 48, alerta_percentual: 80 }
};

const TIPOS_ANOMALIA = {
  NAO_INTEGROU_JET: { descricao: 'Pedido não chegou na JET dentro do prazo', severidade: 'HIGH' },
  NAO_ENTROU_ONCLICK: { descricao: 'JET integrou mas Onclick não processou', severidade: 'HIGH' },
  FATURADO_APOS_ENVIO: { descricao: 'AnyMarket travado em faturado', severidade: 'MEDIUM' },
  ENVIADO_SEM_PRODUCAO: { descricao: 'JET enviou sem confirmação de produção', severidade: 'MEDIUM' },
  PROXIMO_PRAZO_ENVIO: { descricao: 'Pedido próximo do prazo de despacho', severidade: 'WARNING' },
  ATRASO_ENVIO_PRAZO: { descricao: 'Pedido ULTRAPASSOU o prazo de despacho', severidade: 'URGENT' }
};

function formatarHoras(horas) {
  if (horas < 1) return `${Math.round(horas * 60)} minutos`;
  return `${horas.toFixed(1)} horas`;
}

// Calcular prazo de despacho baseado nos dados do pedido
function calcularPrazoDespacho(dadosCompletos, marketplace) {
  // Tenta extrair o prazo real do pedido
  let prazoHoras = null;
  let fonte = 'fallback';
  
  // 1. Tenta pegar do promisedShippingTime (AnyMarket)
  const promisedTime = dadosCompletos?.shipping?.promisedShippingTime;
  if (promisedTime) {
    const dataLimite = new Date(promisedTime);
    if (!isNaN(dataLimite)) {
      const agora = new Date();
      prazoHoras = Math.max(0, (dataLimite - agora) / (1000 * 60 * 60));
      fonte = 'promised_shipping_time';
    }
  }
  
  // 2. Fallback: configuração por marketplace
  if (!prazoHoras || prazoHoras <= 0) {
    const config = PRAZO_DESPACHO_MARKETPLACE[marketplace] || PRAZO_DESPACHO_MARKETPLACE.default;
    prazoHoras = config.horas;
    fonte = `config_${marketplace}`;
  }
  
  const dataLimite = new Date(Date.now() + prazoHoras * 60 * 60 * 1000);
  
  return {
    prazoHoras,
    fonte,
    dataLimite,
    isPrazoReal: fonte !== 'fallback' && !fonte.startsWith('config_')
  };
}

// Criar anomalia
async function createAnomaly(pedido_id, tipo, origem_falha, marketplace, metadata = {}) {
  try {
    // Verifica se já existe anomalia NÃO RESOLVIDA do mesmo tipo
    const existing = await pool.query(
      `SELECT id FROM anomalias 
       WHERE pedido_id = $1 AND tipo = $2 AND resolvida = false 
       LIMIT 1`,
      [pedido_id, tipo]
    );

    if (existing.rows.length) {
      console.log(`ℹ️ Anomalia ${tipo} para pedido ${pedido_id} já existe (não resolvida)`);
      return;
    }

    // Insere a anomalia
    await pool.query(
      `INSERT INTO anomalias (id, pedido_id, tipo, origem_falha, marketplace, detalhes, criado_em, resolvida)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)`,
      [uuidv4(), pedido_id, tipo, origem_falha, marketplace, JSON.stringify(metadata)]
    );

    const infoAnomalia = TIPOS_ANOMALIA[tipo] || { descricao: tipo, severidade: 'MEDIUM' };
    
    console.log(`\n🚨 ANOMALIA DETECTADA!`);
    console.log(`   Pedido: ${pedido_id}`);
    console.log(`   Tipo: ${tipo}`);
    console.log(`   Descrição: ${infoAnomalia.descricao}`);
    console.log(`   Severidade: ${infoAnomalia.severidade}`);
    
    if (metadata.tempo_decorrido) {
      console.log(`   ⏱️ Tempo decorrido: ${formatarHoras(parseFloat(metadata.tempo_decorrido))}`);
    }
    if (metadata.prazo_total) {
      console.log(`   📅 Prazo total: ${formatarHoras(parseFloat(metadata.prazo_total))}`);
    }
    if (metadata.horas_restantes && parseFloat(metadata.horas_restantes) > 0) {
      console.log(`   ⏳ Restante: ${formatarHoras(parseFloat(metadata.horas_restantes))}`);
    }

    console.log(`✅ Anomalia ${tipo} criada para pedido ${pedido_id}`);
    
  } catch (error) {
    console.error('❌ Erro ao criar anomalia:', error.message);
  }
}

// Verificar pipeline do pedido
async function checkPipelineStatus(pedido_id) {
  try {
    // Busca todos os eventos do pedido
    const events = await pool.query(
      `SELECT origem, status, MAX(timestamp) as ultimo_evento
       FROM tracking_events
       WHERE pedido_id = $1
       GROUP BY origem, status
       ORDER BY ultimo_evento ASC`,
      [pedido_id]
    );

    if (!events.rows.length) {
      console.log(`⚠️ Pedido ${pedido_id} sem eventos`);
      return;
    }

    const origens = events.rows.map(r => r.origem);
    const agora = Date.now();

    // Buscar dados completos do pedido para calcular prazo
    const pedidoQuery = await pool.query(`
      SELECT 
        dados_completos,
        dados_completos->>'marketplace' as marketplace
      FROM tracking_events
      WHERE pedido_id = $1 AND origem = 'ANYMARKET'
      ORDER BY timestamp DESC
      LIMIT 1
    `, [pedido_id]);

    const marketplace = pedidoQuery.rows[0]?.marketplace || 'default';
    const dadosCompletos = pedidoQuery.rows[0]?.dados_completos || {};

    // Calcula o prazo real do pedido
    const prazoInfo = calcularPrazoDespacho(dadosCompletos, marketplace);
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 ANALISANDO PEDIDO ${pedido_id}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`🏪 Marketplace: ${marketplace}`);
    console.log(`📅 Prazo de despacho: ${prazoInfo.prazoHoras.toFixed(1)} horas`);
    console.log(`📍 Fonte: ${prazoInfo.fonte}`);

    // Status finais - ignorar verificações
    const statusFinais = ['ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED'];
    const anymarketEvent = events.rows.find(r => r.origem === 'ANYMARKET');
    const statusAtual = anymarketEvent?.status || '';
    
    if (statusFinais.includes(statusAtual)) {
      console.log(`ℹ️ Pedido finalizado (${statusAtual}) — pipeline encerrado`);
      return;
    }

    // Pipeline visual
    const stages = ['ANYMARKET', 'JET', 'ONCLICK', 'RETORNO_JET', 'RETORNO_ANYMARKET'];
    console.log(`\n📊 Pipeline:`);
    stages.forEach(stage => {
      const evento = events.rows.find(r => r.origem === stage);
      const icone = evento ? '✅' : '⏳';
      console.log(`   ${icone} ${stage}`);
    });

    // Verificação 1: AnyMarket → JET
    const temAnymarket = origens.includes('ANYMARKET');
    const temJet = origens.includes('JET');

    if (temAnymarket && !temJet) {
      const eventoAnymarket = events.rows.find(r => r.origem === 'ANYMARKET');
      const horasEsperando = (agora - new Date(eventoAnymarket.ultimo_evento)) / (1000 * 60 * 60);
      const sla = SLA_ENTRE_ESTAGIOS.ANYMARKET_para_JET.horas;

      if (horasEsperando > sla) {
        await createAnomaly(pedido_id, 'NAO_INTEGROU_JET', 'ANYMARKET', marketplace, {
          detalhes: `Pedido não integrou na JET após ${horasEsperando.toFixed(1)}h (SLA: ${sla}h)`,
          tempo_decorrido: horasEsperando.toFixed(1)
        });
      }
    }

    // Verificação 2: JET → ONCLICK
    const temOnclick = origens.includes('ONCLICK');
    
    if (temJet && !temOnclick) {
      const eventoJet = events.rows.find(r => r.origem === 'JET');
      const horasEsperando = (agora - new Date(eventoJet.ultimo_evento)) / (1000 * 60 * 60);
      const sla = SLA_ENTRE_ESTAGIOS.JET_para_ONCLICK.horas;

      if (horasEsperando > sla) {
        await createAnomaly(pedido_id, 'NAO_ENTROU_ONCLICK', 'JET', marketplace, {
          detalhes: `Pedido integrado na JET mas não entrou na Onclick após ${horasEsperando.toFixed(1)}h`,
          tempo_decorrido: horasEsperando.toFixed(1)
        });
      }
    }

    // Verificação 3: ONCLICK → ENVIO (prazo)
    if (temOnclick) {
      const eventoOnclick = events.rows.find(r => r.origem === 'ONCLICK');
      const tempoDecorrido = (agora - new Date(eventoOnclick.ultimo_evento)) / (1000 * 60 * 60);
      const temEnvio = origens.includes('RETORNO_JET') || origens.includes('ENVIADO');
      
      if (temEnvio) {
        console.log(`✅ Pedido já foi enviado!`);
        return;
      }
      
      const limiteEnvioHoras = prazoInfo.prazoHoras;
      const percentualPrazo = (tempoDecorrido / limiteEnvioHoras) * 100;
      const prazoVencido = tempoDecorrido > limiteEnvioHoras;
      
      const config = PRAZO_DESPACHO_MARKETPLACE[marketplace] || PRAZO_DESPACHO_MARKETPLACE.default;
      const alertaPercentual = config.alerta_percentual || 80;
      const alertaPrevio = percentualPrazo > alertaPercentual && limiteEnvioHoras > 4;
      
      if (prazoVencido) {
        const atrasoHoras = (tempoDecorrido - limiteEnvioHoras).toFixed(1);
        await createAnomaly(pedido_id, 'ATRASO_ENVIO_PRAZO', 'ONCLICK', marketplace, {
          detalhes: `Pedido NÃO foi enviado. Atraso de ${atrasoHoras}h`,
          tempo_decorrido: tempoDecorrido.toFixed(1),
          prazo_total: limiteEnvioHoras.toFixed(1),
          horas_restantes: 0
        });
      } else if (alertaPrevio) {
        const horasRestantes = (limiteEnvioHoras - tempoDecorrido).toFixed(1);
        await createAnomaly(pedido_id, 'PROXIMO_PRAZO_ENVIO', 'ONCLICK', marketplace, {
          detalhes: `Pedido próximo do prazo. Faltam ${formatarHoras(parseFloat(horasRestantes))}`,
          tempo_decorrido: tempoDecorrido.toFixed(1),
          prazo_total: limiteEnvioHoras.toFixed(1),
          horas_restantes: horasRestantes
        });
      }
    }

    console.log(`${'═'.repeat(60)}\n`);

  } catch (error) {
    console.error('❌ Erro ao verificar pipeline:', error.message);
  }
}

module.exports = {
  createAnomaly,
  checkPipelineStatus,
  calcularPrazoDespacho,
  formatarHoras,
  SLA_ENTRE_ESTAGIOS,
  PRAZO_DESPACHO_MARKETPLACE,
  TIPOS_ANOMALIA
};