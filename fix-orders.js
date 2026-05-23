// fix-orders.js
require('dotenv').config();
const { Client } = require('pg');
const axios = require('axios');

const client = new Client({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

const ANYMARKET_TOKEN = process.env.ANYMARKET_TOKEN;
const ANYMARKET_URL = 'https://api.anymarket.com.br/v2/orders';

async function buscarPedidoAnymarket(id) {
  try {
    const response = await axios.get(`${ANYMARKET_URL}/${id}`, {
      headers: { 'gumgaToken': ANYMARKET_TOKEN }
    });
    return response.data;
  } catch (error) {
    console.error(`Erro ao buscar pedido ${id}:`, error.response?.status);
    return null;
  }
}

async function corrigirPedidos() {
  try {
    await client.connect();
    console.log('✅ Conectado ao banco');

    // Buscar TODOS os pedidos que têm id_anymarket
    const result = await client.query(`
      SELECT id, numero_marketplace, id_anymarket, marketplace_origem, loja
      FROM pedidos_mapeamento 
      WHERE id_anymarket IS NOT NULL
    `);

    console.log(`📋 Encontrados ${result.rows.length} pedidos para corrigir\n`);

    let atualizados = 0;
    let erros = 0;

    for (const row of result.rows) {
      console.log(`🔍 Buscando pedido ${row.id_anymarket}...`);
      console.log(`   Valor atual: Marketplace="${row.marketplace_origem}", Loja="${row.loja}"`);
      
      const pedido = await buscarPedidoAnymarket(row.id_anymarket);
      
      if (pedido) {
        const marketplace = pedido.marketPlace || pedido.marketplaceName || null;
        const loja = pedido.accountName || null;
        
        if (marketplace || loja) {
          await client.query(`
            UPDATE pedidos_mapeamento 
            SET marketplace_origem = $1, 
                loja = $2, 
                atualizado_em = NOW()
            WHERE id = $3
          `, [marketplace, loja, row.id]);
          
          atualizados++;
          console.log(`   ✅ Novo: Marketplace="${marketplace}", Loja="${loja}"`);
        } else {
          console.log(`   ⚠️ API não retornou marketplace/loja`);
        }
      } else {
        erros++;
        console.log(`   ❌ Erro na API`);
      }
      
      console.log('');
      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n🎉 Concluído! Atualizados: ${atualizados}, Erros: ${erros}`);
    
    await client.end();
  } catch (error) {
    console.error('❌ Erro:', error.message);
    await client.end();
  }
}

corrigirPedidos();