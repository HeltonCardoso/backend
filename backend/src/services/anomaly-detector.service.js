// backend/src/services/anomaly-detector.service.js
const pool = require("../../config/database");
const { v4: uuidv4 } = require('uuid');

// Configurações
const SLA_ENTRE_ESTAGIOS = {
  ANYMARKET_para_JET: { horas: 0.5 },   // 30 minutos
  JET_para_ONCLICK: { horas: 1 }        // 1 hora
};

const PRAZO_DESPACHO_MARKETPLACE = {
  default: { horas: 48, alerta_percentual: 80 },
  MAGAZINE_LUIZA: { horas: 48, alerta_percentual: 80 },
  MERCADO_LIVRE: { horas: 48, alerta_percentual: 80 },
  AMAZON: { horas: 48, alerta_percentual: 80 },
  SHOPEE: { horas: 48, alerta_percentual: 80 },
  MADEIRA_MADEIRA: { horas: 72, alerta_percentual: 80 }
};

const TIPOS_ANOMALIA = {
  NAO_INTEGROU_JET: { descricao: 'Pedido não chegou na JET dentro do prazo (30min)', severidade: 'HIGH' },
  NAO_ENTROU_ONCLICK: { descricao: 'JET integrou mas Onclick não processou (1h)', severidade: 'HIGH' },
  FATURADO_APOS_ENVIO: { descricao: 'AnyMarket travado em faturado após JET enviar', severidade: 'MEDIUM' },
  ENVIADO_SEM_PRODUCAO: { descricao: 'JET enviou sem confirmação de produção', severidade: 'MEDIUM' },
  PROXIMO_PRAZO_ENVIO: { descricao: 'Pedido próximo do prazo de despacho do marketplace', severidade: 'WARNING' },
  ATRASO_ENVIO_PRAZO: { descricao: 'Pedido ULTRAPASSOU o prazo de despacho do marketplace', severidade: 'URGENTE' },
  TRAVADO_SEM_ATUALIZACAO: { descricao: 'Pedido sem atualização por mais de 2 horas', severidade: 'HIGH' },
  RETORNO_JET_SEM_CONFIRMACAO_ANYMARKET: { descricao: 'JET enviou mas AnyMarket não confirmou', severidade: 'HIGH' },
  ONCLICK_FATUROU_SEM_RETORNO_JET: { descricao: 'ONCLICK faturou mas JET não confirmou envio', severidade: 'HIGH' },
  // ⭐ NOVAS ANOMALIAS BASEADAS NO deliveryTime DA JET
  ATRASO_PRAZO_PREPARACAO: { descricao: 'Pedido NÃO foi despachado dentro do prazo de preparação (deliveryTime)', severidade: 'URGENTE' },
  PROXIMO_PRAZO_PREPARACAO: { descricao: 'Pedido próximo do prazo de preparação (deliveryTime)', severidade: 'WARNING' },
  DEMOROU_PARA_PRODUZIR: { descricao: 'Pedido demorou mais de 2h para entrar em produção', severidade: 'HIGH' },
  PRODUCAO_DEMORADA: { descricao: 'Pedido em produção há mais de 48h', severidade: 'HIGH' },
  PEDIDO_TRAVADO_JET: { descricao: 'Pedido travado na JET há mais de 72h', severidade: 'URGENTE' }
};

function formatarHoras(horas) {
  if (horas < 1) return `${Math.round(horas * 60)} minutos`;
  if (horas < 24) return `${horas.toFixed(1)} horas`;
  return `${(horas / 24).toFixed(1)} dias`;
}

function calcularPrazoDespacho(dadosCompletos, marketplace) {
  let prazoHoras = null;
  let fonte = 'fallback';
  
  const promisedTime = dadosCompletos?.shipping?.promisedShippingTime;
  if (promisedTime) {
    const dataLimite = new Date(promisedTime);
    if (!isNaN(dataLimite)) {
      const agora = new Date();
      prazoHoras = Math.max(0, (dataLimite - agora) / (1000 * 60 * 60));
      fonte = 'promised_shipping_time';
    }
  }
  
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

async function createAnomaly(pedido_id, tipo, origem_falha, marketplace, metadata = {}) {
  try {
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
    if (metadata.atraso_horas) {
      console.log(`   ⏰ Atraso: ${formatarHoras(parseFloat(metadata.atraso_horas))}`);
    }
    
  } catch (error) {
    console.error('❌ Erro ao criar anomalia:', error.message);
  }
}

// ⭐ NOVA FUNÇÃO: Verificar prazo de preparação baseado no deliveryTime da JET
async function verificarPrazoPreparacao(pedido_id, marketplace) {
  try {
    const result = await pool.query(`
      SELECT delivery_time_jet, prazo_preparacao_horas, criado_em
      FROM pedidos_mapeamento
      WHERE numero_marketplace = $1
    `, [pedido_id]);

    if (!result.rows.length) return;

    const deliveryTimeDias = result.rows[0].delivery_time_jet ?? null;
    let prazoPreparacaoHoras = result.rows[0].prazo_preparacao_horas;
    const dataCriacao = result.rows[0].criado_em;

    // Se não tem deliveryTime da JET, não consegue calcular
    if (deliveryTimeDias === null) {
      console.log(`   ⚠️ Sem deliveryTime da JET para este pedido`);
      return;
    }

    const horasDecorridas = (new Date() - new Date(dataCriacao)) / (1000 * 60 * 60);
    
    console.log(`   📦 DeliveryTime JET: ${deliveryTimeDias} dias ${deliveryTimeDias === 0 ? '(pronta entrega)' : ''}`);
    console.log(`   ⏰ Prazo preparação: ${prazoPreparacaoHoras}h`);
    console.log(`   ⏱️ Horas decorridas: ${horasDecorridas.toFixed(1)}h`);

    // Verificar se já foi enviado (RETORNO_JET)
    const enviado = await pool.query(`
      SELECT id FROM tracking_events 
      WHERE pedido_id = $1 AND origem = 'RETORNO_JET'
      LIMIT 1
    `, [pedido_id]);

    if (enviado.rows.length) {
      console.log(`   ✅ Pedido já foi enviado, prazo de preparação atendido`);
      return;
    }

    // Verificar se passou do prazo de preparação
    if (horasDecorridas > prazoPreparacaoHoras) {
      const atrasoHoras = (horasDecorridas - prazoPreparacaoHoras).toFixed(1);
      await createAnomaly(
        pedido_id,
        'ATRASO_PRAZO_PREPARACAO',
        'JET',
        marketplace,
        {
          detalhes: `Pedido NÃO foi despachado dentro do prazo de preparação (${deliveryTimeDias} dias)`,
          delivery_time_dias: deliveryTimeDias,
          prazo_horas: prazoPreparacaoHoras,
          tempo_decorrido: horasDecorridas.toFixed(1),
          atraso_horas: atrasoHoras
        }
      );
    } else if (horasDecorridas > prazoPreparacaoHoras * 0.8) {
      // Aviso quando estiver próximo do prazo (80%)
      const horasRestantes = (prazoPreparacaoHoras - horasDecorridas).toFixed(1);
      await createAnomaly(
        pedido_id,
        'PROXIMO_PRAZO_PREPARACAO',
        'JET',
        marketplace,
        {
          detalhes: `Pedido próximo do prazo de preparação (${deliveryTimeDias} dias). Faltam ${formatarHoras(parseFloat(horasRestantes))}`,
          delivery_time_dias: deliveryTimeDias,
          percentual: ((horasDecorridas / prazoPreparacaoHoras) * 100).toFixed(0),
          horas_restantes: horasRestantes
        }
      );
    }

  } catch (error) {
    console.error('❌ Erro ao verificar prazo de preparação:', error.message);
  }
}

// ⭐ NOVA FUNÇÃO: Analisar tempos de produção da JET
async function analisarTemposProducao(pedido_id, marketplace) {
  try {
    const jetEvent = await pool.query(`
      SELECT dados_completos
      FROM tracking_events
      WHERE pedido_id = $1 AND origem = 'JET'
      ORDER BY timestamp ASC
      LIMIT 1
    `, [pedido_id]);

    if (!jetEvent.rows.length) return;

    const dados = jetEvent.rows[0].dados_completos;
    if (!dados || !dados.historyListOrderStatus) return;

    const history = dados.historyListOrderStatus;
    
    const dataIntegracao = history.find(h => h.statusCode === '01')?.dateRegisterStatus;
    const dataProducao = history.find(h => h.statusCode === '07')?.dateRegisterStatus;
    const dataPronto = history.find(h => h.statusCode === '05')?.dateRegisterStatus;

    const agora = new Date();

    if (dataIntegracao) {
      console.log(`   📅 Integração JET: ${new Date(dataIntegracao).toLocaleString()}`);
    }
    if (dataProducao) {
      console.log(`   🏭 Início produção: ${new Date(dataProducao).toLocaleString()}`);
    }
    if (dataPronto) {
      console.log(`   ✅ Pronto para envio: ${new Date(dataPronto).toLocaleString()}`);
    }

    // Verificar se demorou para começar a produzir
    if (dataIntegracao && !dataProducao) {
      const horasEsperando = (agora - new Date(dataIntegracao)) / (1000 * 60 * 60);
      if (horasEsperando > 2) {
        await createAnomaly(
          pedido_id,
          'DEMOROU_PARA_PRODUZIR',
          'JET',
          marketplace,
          {
            detalhes: `Pedido integrado há ${horasEsperando.toFixed(1)}h e ainda não entrou em produção`,
            tempo_decorrido: horasEsperando.toFixed(1)
          }
        );
      }
    }

    // Verificar se a produção está demorada
    if (dataProducao && !dataPronto) {
      const horasEmProducao = (agora - new Date(dataProducao)) / (1000 * 60 * 60);
      if (horasEmProducao > 48) {
        await createAnomaly(
          pedido_id,
          'PRODUCAO_DEMORADA',
          'JET',
          marketplace,
          {
            detalhes: `Pedido em produção há ${horasEmProducao.toFixed(1)}h`,
            tempo_producao: horasEmProducao.toFixed(1)
          }
        );
      }
    }

    // Verificar tempo total do pedido na JET
    if (dataIntegracao && !dataPronto) {
      const tempoTotal = (agora - new Date(dataIntegracao)) / (1000 * 60 * 60);
      if (tempoTotal > 72) {
        await createAnomaly(
          pedido_id,
          'PEDIDO_TRAVADO_JET',
          'JET',
          marketplace,
          {
            detalhes: `Pedido na JET há ${tempoTotal.toFixed(1)}h sem conclusão`,
            tempo_total: tempoTotal.toFixed(1)
          }
        );
      }
    }

  } catch (error) {
    console.error('❌ Erro ao analisar tempos de produção:', error.message);
  }
}

async function checkPipelineStatus(pedido_id) {
  try {
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

    const prazoInfo = calcularPrazoDespacho(dadosCompletos, marketplace);
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 ANALISANDO PEDIDO ${pedido_id}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`🏪 Marketplace: ${marketplace}`);
    console.log(`📅 Prazo de despacho (marketplace): ${prazoInfo.prazoHoras.toFixed(1)} horas`);

    const statusFinais = ['ENTREGUE', 'CANCELADO', 'CONCLUDED', 'CANCELED'];
    const anymarketEvent = events.rows.find(r => r.origem === 'ANYMARKET');
    const statusAtual = anymarketEvent?.status || '';
    
    if (statusFinais.includes(statusAtual)) {
      console.log(`ℹ️ Pedido finalizado (${statusAtual}) — pipeline encerrado`);
      return;
    }

    const stages = ['ANYMARKET', 'JET', 'ONCLICK', 'RETORNO_JET', 'RETORNO_ANYMARKET'];
    console.log(`\n📊 Pipeline:`);
    stages.forEach(stage => {
      const evento = events.rows.find(r => r.origem === stage);
      const icone = evento ? '✅' : '⏳';
      console.log(`   ${icone} ${stage}`);
    });

    // 1. VERIFICAÇÃO: AnyMarket → JET (30 minutos)
    const temAnymarket = origens.includes('ANYMARKET');
    const temJet = origens.includes('JET');

    if (temAnymarket && !temJet) {
      const eventoAnymarket = events.rows.find(r => r.origem === 'ANYMARKET');
      const horasEsperando = (agora - new Date(eventoAnymarket.ultimo_evento)) / (1000 * 60 * 60);
      const sla = SLA_ENTRE_ESTAGIOS.ANYMARKET_para_JET.horas;

      if (horasEsperando > sla) {
        await createAnomaly(pedido_id, 'NAO_INTEGROU_JET', 'ANYMARKET', marketplace, {
          detalhes: `Pedido não integrou na JET após ${horasEsperando.toFixed(1)}h (SLA: ${sla}h = 30min)`,
          tempo_decorrido: horasEsperando.toFixed(1)
        });
      }
    }

    // 2. VERIFICAÇÃO: JET → ONCLICK (1 hora)
    const temOnclick = origens.includes('ONCLICK');
    
    if (temJet && !temOnclick) {
      const eventoJet = events.rows.find(r => r.origem === 'JET');
      const horasEsperando = (agora - new Date(eventoJet.ultimo_evento)) / (1000 * 60 * 60);
      const sla = SLA_ENTRE_ESTAGIOS.JET_para_ONCLICK.horas;

      if (horasEsperando > sla) {
        await createAnomaly(pedido_id, 'NAO_ENTROU_ONCLICK', 'JET', marketplace, {
          detalhes: `JET integrou mas ONCLICK não processou após ${horasEsperando.toFixed(1)}h`,
          tempo_decorrido: horasEsperando.toFixed(1)
        });
      }
    }

    // 3. VERIFICAÇÃO: Pedido TRAVADO (sem atualização > 2h)
    const ultimoEventoGeral = events.rows.reduce((latest, current) => {
      return new Date(current.ultimo_evento) > new Date(latest.ultimo_evento) ? current : latest;
    }, events.rows[0]);

    if (ultimoEventoGeral) {
      const horasSemUpdate = (agora - new Date(ultimoEventoGeral.ultimo_evento)) / (1000 * 60 * 60);
      const limiteTravado = 2;

      if (horasSemUpdate > limiteTravado && !statusFinais.includes(statusAtual)) {
        await createAnomaly(pedido_id, 'TRAVADO_SEM_ATUALIZACAO', ultimoEventoGeral.origem, marketplace, {
          detalhes: `Pedido sem atualização há ${horasSemUpdate.toFixed(1)} horas`,
          ultimo_status: ultimoEventoGeral.status,
          ultima_origem: ultimoEventoGeral.origem,
          horas_parado: horasSemUpdate.toFixed(1)
        });
      }
    }

    // 4. VERIFICAÇÃO: RETORNO_JET → RETORNO_ANYMARKET
    const temRetornoJet = origens.includes('RETORNO_JET');
    const temRetornoAnymarket = origens.includes('RETORNO_ANYMARKET');

    if (temRetornoJet && !temRetornoAnymarket) {
      const eventoRetornoJet = events.rows.find(r => r.origem === 'RETORNO_JET');
      const horasEsperando = (agora - new Date(eventoRetornoJet.ultimo_evento)) / (1000 * 60 * 60);
      const sla = 2;

      if (horasEsperando > sla) {
        await createAnomaly(pedido_id, 'RETORNO_JET_SEM_CONFIRMACAO_ANYMARKET', 'RETORNO_JET', marketplace, {
          detalhes: `JET confirmou envio mas AnyMarket não confirmou recebimento há ${horasEsperando.toFixed(1)}h`,
          tempo_decorrido: horasEsperando.toFixed(1)
        });
      }
    }

    // 5. VERIFICAÇÃO: ONCLICK faturou sem RETORNO_JET
    const temOnclickFaturado = events.rows.some(r => r.origem === 'ONCLICK' && r.status === 'FATURADO');
    const temRetornoJetConfirmado = events.rows.some(r => r.origem === 'RETORNO_JET');

    if (temOnclickFaturado && !temRetornoJetConfirmado) {
      const eventoOnclick = events.rows.find(r => r.origem === 'ONCLICK');
      const horasEsperando = (agora - new Date(eventoOnclick.ultimo_evento)) / (1000 * 60 * 60);
      const sla = 1;

      if (horasEsperando > sla) {
        await createAnomaly(pedido_id, 'ONCLICK_FATUROU_SEM_RETORNO_JET', 'ONCLICK', marketplace, {
          detalhes: `ONCLICK faturou mas JET não confirmou envio há ${horasEsperando.toFixed(1)}h`,
          tempo_decorrido: horasEsperando.toFixed(1)
        });
      }
    }

    // 6. VERIFICAÇÃO: ONCLICK → ENVIO (prazo do marketplace)
    if (temOnclick) {
      const eventoOnclick = events.rows.find(r => r.origem === 'ONCLICK');
      const tempoDecorrido = (agora - new Date(eventoOnclick.ultimo_evento)) / (1000 * 60 * 60);
      const temEnvio = origens.includes('RETORNO_JET') || origens.includes('ENVIADO');
      
      if (temEnvio) {
        console.log(`✅ Pedido já foi enviado!`);
      } else {
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
            detalhes: `Pedido próximo do prazo do marketplace. Faltam ${formatarHoras(parseFloat(horasRestantes))}`,
            tempo_decorrido: tempoDecorrido.toFixed(1),
            prazo_total: limiteEnvioHoras.toFixed(1),
            horas_restantes: horasRestantes
          });
        }
      }
    }

    // ⭐ 7. NOVA VERIFICAÇÃO: Prazo de preparação baseado no deliveryTime da JET
    await verificarPrazoPreparacao(pedido_id, marketplace);

    // ⭐ 8. NOVA VERIFICAÇÃO: Tempos de produção da JET
    await analisarTemposProducao(pedido_id, marketplace);

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
  verificarPrazoPreparacao,
  analisarTemposProducao,
  SLA_ENTRE_ESTAGIOS,
  PRAZO_DESPACHO_MARKETPLACE,
  TIPOS_ANOMALIA
};