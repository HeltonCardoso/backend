// backend/scripts/fill-jet-data.js
require('dotenv').config();
const { Client } = require('pg');
const axios = require('axios');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');

const client = new Client({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

const JET_API_TOKEN = process.env.JET_API_KEY;
const JET_BASE_URL = 'https://openapi.plataformaneo.com.br/order/api/v1/id';
const DELAY_MS = 500; // 500ms entre requisições

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function buscarPedidoJet(idOrder) {
  try {
    const response = await axios({
      method: 'GET',
      url: `${JET_BASE_URL}/${idOrder}`,
      headers: { 'apiKey': JET_API_TOKEN },
      timeout: 30000
    });
    return response.data;
  } catch (error) {
    console.error(`   ❌ Erro API: ${error.response?.status || error.message}`);
    return null;
  }
}

async function lerPlanilha(caminhoArquivo) {
  const workbook = xlsx.readFile(caminhoArquivo);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);
  
  // Busca a coluna "Pedidos" (case insensitive)
  const headers = Object.keys(data[0] || {});
  const colunaPedido = headers.find(h => 
    h.toLowerCase() === 'pedidos' || 
    h.toLowerCase() === 'pedido' ||
    h.toLowerCase() === 'id'
  );
  
  if (!colunaPedido) {
    console.error('❌ Coluna "Pedidos" não encontrada na planilha');
    console.log('   Colunas disponíveis:', headers.join(', '));
    return [];
  }
  
  const ids = data
    .map(row => row[colunaPedido]?.toString().trim())
    .filter(id => id && id.length > 3);
  
  return [...new Set(ids)]; // Remove duplicados
}

async function salvarPedidoJet(id, dados) {
  if (!dados || !dados.result) return null;
  
  const d = dados.result;
  
  // Inserir ou atualizar em pedidos_jet
  await client.query(`
    INSERT INTO pedidos_jet (
      id, customer_name, customer_email, customer_phone, 
      created_at, status, total_amount, dados_completos, criado_em, atualizado_em
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      customer_name = EXCLUDED.customer_name,
      customer_email = EXCLUDED.customer_email,
      status = EXCLUDED.status,
      total_amount = EXCLUDED.total_amount,
      dados_completos = EXCLUDED.dados_completos,
      atualizado_em = NOW()
  `, [
    id,
    d.nameCustomer || d.cliente || null,
    d.email || null,
    d.phone1 || d.telefone || null,
    d.dateOrder || d.data_pedido || null,
    d.historyListOrderStatus?.[0]?.statusCode || d.status || 'DESCONHECIDO',
    d.total || d.valor_total || null,
    JSON.stringify(d)
  ]);
  
  return d;
}

async function atualizarMapeamento(jetId, numeroMarketplace) {
  const result = await client.query(`
    UPDATE pedidos_mapeamento 
    SET id_jet = $1, atualizado_em = NOW()
    WHERE numero_marketplace = $2 AND (id_jet IS NULL OR id_jet != $1)
    RETURNING numero_marketplace
  `, [jetId, numeroMarketplace]);
  
  return result.rowCount > 0;
}

async function registrarTrackingEvent(pedidoId, origem, status, timestamp, dadosCompletos) {
  await client.query(`
    INSERT INTO tracking_events (id, pedido_id, origem, status, timestamp, dados_completos, criado_em)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (pedido_id, origem, status) DO NOTHING
  `, [uuidv4(), pedidoId, origem, status, timestamp || new Date(), JSON.stringify(dadosCompletos)]);
}

async function main() {
  const arquivoPlanilha = process.argv[2];
  
  if (!arquivoPlanilha) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Como usar:                                                          ║
║  node backend/scripts/fill-jet-data.js caminho/planilha.xlsx         ║
║                                                                      ║
║  A planilha deve ter uma coluna chamada "Pedidos" com os IDs da JET  ║
╚══════════════════════════════════════════════════════════════════════╝
    `);
    process.exit(1);
  }

  try {
    await client.connect();
    console.log('✅ Conectado ao banco\n');
    
    console.log(`📁 Lendo planilha: ${arquivoPlanilha}`);
    const ids = await lerPlanilha(arquivoPlanilha);
    console.log(`📋 Encontrados ${ids.length} IDs na planilha\n`);
    
    if (ids.length === 0) {
      console.log('⚠️ Nenhum ID encontrado na coluna "Pedidos"');
      await client.end();
      return;
    }
    
    let resultados = {
      total: ids.length,
      jetInseridos: 0,
      mapeamentoAtualizado: 0,
      trackingInseridos: 0,
      erros: 0
    };
    
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      console.log(`\n[${i+1}/${ids.length}] 🔍 Processando: ${id}`);
      
      const dados = await buscarPedidoJet(id);
      
      if (dados && dados.result) {
        const dadosPedido = dados.result;
        const numeroMarketplace = dadosPedido.marketPlaceNumberOrder || dadosPedido.numero_marketplace;
        const status = dadosPedido.historyListOrderStatus?.[0]?.statusCode || dadosPedido.status || 'DESCONHECIDO';
        const timestamp = dadosPedido.dateOrder || dadosPedido.data_pedido || new Date();
        
        // 1. Salvar em pedidos_jet
        await salvarPedidoJet(id, dados);
        resultados.jetInseridos++;
        console.log(`   ✅ 1. pedidos_jet: salvo/atualizado`);
        
        // 2. Atualizar id_jet em pedidos_mapeamento
        if (numeroMarketplace) {
          const atualizado = await atualizarMapeamento(id, numeroMarketplace);
          if (atualizado) {
            resultados.mapeamentoAtualizado++;
            console.log(`   ✅ 2. pedidos_mapeamento: id_jet atualizado para ${numeroMarketplace}`);
          } else {
            console.log(`   ⚠️ 2. pedidos_mapeamento: ${numeroMarketplace} não encontrado ou já tinha id_jet`);
          }
        } else {
          console.log(`   ⚠️ 2. pedidos_mapeamento: sem numero_marketplace para vincular`);
        }
        
        // 3. Registrar evento em tracking_events
        await registrarTrackingEvent(numeroMarketplace || id, 'JET', status, timestamp, dadosPedido);
        resultados.trackingInseridos++;
        console.log(`   ✅ 3. tracking_events: evento JET registrado (status: ${status})`);
        
      } else {
        resultados.erros++;
        console.log(`   ❌ Falha ao buscar dados do pedido ${id}`);
      }
      
      await delay(DELAY_MS);
    }
    
    // Resumo final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DA EXECUÇÃO:');
    console.log('='.repeat(60));
    console.log(`   Total processados:     ${resultados.total}`);
    console.log(`   ✅ pedidos_jet:        ${resultados.jetInseridos}`);
    console.log(`   ✅ id_jet atualizados: ${resultados.mapeamentoAtualizado}`);
    console.log(`   ✅ tracking_events:    ${resultados.trackingInseridos}`);
    console.log(`   ❌ Erros:              ${resultados.erros}`);
    console.log('='.repeat(60));
    
    await client.end();
    
  } catch (error) {
    console.error('❌ Erro:', error.message);
    await client.end();
  }
}

main();