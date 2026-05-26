// backend/src/services/anymarketSyncService.js
const pool = require('../../config/database');

const ANYMARKET_API_KEY = process.env.ANYMARKET_API_KEY;
const ANYMARKET_BASE = 'https://api.anymarket.com.br/v2';

async function sincronizarPrazosPendentes({ onProgress } = {}) {
  // ⭐ SEM NENHUM FILTRO - atualiza TODOS os pedidos sem prazo
  const { rows: pedidos } = await pool.query(`
    SELECT numero_marketplace, id_anymarket
    FROM pedidos_mapeamento
    WHERE prazo_despacho IS NULL
      AND id_anymarket IS NOT NULL
      AND id_anymarket != ''
  `);

  const total = pedidos.length;
  console.log(`📦 Total de pedidos sem prazo (incluindo travados/anomalias): ${total}`);

  if (total === 0) {
    if (onProgress) onProgress({ type: 'done', total: 0, sucesso: 0, erro: 0, semPrazo: 0 });
    return { total: 0, sucesso: 0, erro: 0, semPrazo: 0 };
  }

  let sucesso = 0;
  let erro = 0;
  let semPrazo = 0;

  for (let i = 0; i < pedidos.length; i++) {
    const { numero_marketplace, id_anymarket } = pedidos[i];
    const idNumero = parseInt(id_anymarket, 10);

    try {
      const response = await fetch(`${ANYMARKET_BASE}/orders/${idNumero}`, {
        headers: {
          'gumgaToken': ANYMARKET_API_KEY,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      
      // Campo correto: shipping.promisedShippingTime
      const tempoPromisso = json?.shipping?.promisedShippingTime || null;
      
      if (tempoPromisso) {
        const prazoDespacho = new Date(tempoPromisso);
        
        await pool.query(`
          UPDATE pedidos_mapeamento 
          SET prazo_despacho = $1, 
              atualizado_em = NOW()
          WHERE numero_marketplace = $2
        `, [prazoDespacho, numero_marketplace]);
        
        sucesso++;
        
        // Log a cada 100 sucessos
        if (sucesso % 100 === 0) {
          console.log(`  ✅ ${sucesso} pedidos atualizados...`);
        }
      } else {
        semPrazo++;
      }

      // Progresso via SSE
      if ((i + 1) % 10 === 0 || i === pedidos.length - 1) {
        if (onProgress) {
          onProgress({
            type: 'progress',
            processados: i + 1,
            total,
            sucesso,
            erro,
            semPrazo,
            percent: Math.round(((i + 1) / total) * 100)
          });
        }
      }

      // Pausa de 100ms
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      erro++;
      console.error(`  ❌ Erro ${numero_marketplace}: ${error.message}`);
      
      if (onProgress) {
        onProgress({ 
          type: 'error_item', 
          pedido: numero_marketplace, 
          message: error.message 
        });
      }
    }
  }

  const resultado = { total, sucesso, erro, semPrazo };
  
  console.log(`\n📊 RESULTADO FINAL:`);
  console.log(`   ✅ Atualizados: ${sucesso}`);
  console.log(`   ⚠️ Sem prazo na API: ${semPrazo}`);
  console.log(`   ❌ Erros: ${erro}`);

  if (onProgress) {
    onProgress({ type: 'done', ...resultado });
  }

  return resultado;
}

module.exports = { sincronizarPrazosPendentes };