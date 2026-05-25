/**
 * recover_ml_orders.js
 *
 * Script de recuperação manual para pedidos do Mercado Livre que não foram
 * capturados automaticamente. Dado uma lista de IDs do Anymarket, busca os
 * dados na API e na JET e insere em tracking_events.
 *
 * USO:
 *   node recover_ml_orders.js 334490900 334490901
 *   node recover_ml_orders.js --file ids.txt       (um ID por linha)
 *   node recover_ml_orders.js --dry-run 334490900  (só consulta, não salva)
 *
 * VARIÁVEIS DE AMBIENTE necessárias (mesmo .env do projeto):
 *   ANYMARKET_BASE_URL, ANYMARKET_TOKEN
 *   JET_BASE_URL, JET_CLIENT_ID, JET_CLIENT_SECRET
 *   DATABASE_URL
 */

require("dotenv").config();
const axios  = require("axios");
const { v4: uuidv4 } = require("uuid");
const fs     = require("fs");
const path   = require("path");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");

// Reutiliza o pool de conexão já configurado no projeto
const db = require("./backend/config/database");

// ─── ANYMARKET ────────────────────────────────────────────────────────────────
const amApi = axios.create({
  baseURL: process.env.ANYMARKET_BASE_URL || "https://api.anymarket.com.br/v2",
  headers: {
    gumgaToken: process.env.ANYMARKET_TOKEN,
    "Content-Type": "application/json",
  },
  timeout: 15000,
});

/**
 * Busca pedido individual no Anymarket pelo ID interno da Anymarket.
 * GET /orders/{anymarketId}
 */
async function fetchAnymarketById(anymarketId) {
  const { data } = await amApi.get(`/orders/${anymarketId}`);
  return data;
}

// ─── JET ──────────────────────────────────────────────────────────────────────
let _jetToken = null;
let _jetTokenExpiry = 0;

async function getJetToken() {
  if (_jetToken && Date.now() < _jetTokenExpiry) return _jetToken;
  const { data } = await axios.post(
    `${process.env.JET_BASE_URL || "https://api.jet.com.br/api"}/token`,
    null,
    {
      params: {
        grant_type:    "client_credentials",
        client_id:     process.env.JET_CLIENT_ID,
        client_secret: process.env.JET_CLIENT_SECRET,
      },
      timeout: 10000,
    }
  );
  _jetToken = data.access_token;
  _jetTokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return _jetToken;
}

async function jetGet(endpoint, params = {}) {
  const token = await getJetToken();
  const { data } = await axios.get(
    `${process.env.JET_BASE_URL || "https://api.jet.com.br/api"}${endpoint}`,
    { headers: { Authorization: `Bearer ${token}` }, params, timeout: 15000 }
  );
  return data;
}

/**
 * Busca na JET pelo ID do pedido JET (que o Anymarket retorna em algum campo).
 * Tenta o endpoint direto primeiro, depois listagem com filtro.
 */
async function fetchJetOrder(jetOrderId) {
  try {
    return await jetGet(`/orders/${jetOrderId}`);
  } catch (_) {
    try {
      const data = await jetGet("/orders", { orderId: jetOrderId, pageSize: 5 });
      const list = data.orders || data.content || data || [];
      return list.find((o) => String(o.orderId || o.id || "") === String(jetOrderId)) || null;
    } catch (_) {
      return null;
    }
  }
}

// ─── BANCO ────────────────────────────────────────────────────────────────────

/**
 * Verifica se já existe registro no banco para este ID do Anymarket.
 */
async function jaExisteNoBanco(anymarketId, pedidoId) {
  const { rows } = await db.query(
    `SELECT pedido_id FROM tracking_events
     WHERE
       pedido_id = $1
       OR pedido_id = $2
       OR dados_completos->>'marketPlaceNumber'  = $2
       OR dados_completos->'metadata'->>'packId' = $2
       OR dados_completos->>'marketPlacePackId'  = $2
     LIMIT 1`,
    [pedidoId, String(anymarketId)]
  );
  return rows.length > 0 ? rows[0].pedido_id : null;
}

/**
 * Insere evento do Anymarket em tracking_events.
 * pedido_id = marketPlaceId do Anymarket (S-... quando existe, senão marketPlaceNumber).
 * dados_completos = JSON completo retornado pela API do Anymarket.
 */
async function inserirEventoAnymarket(pedidoId, dadosAnymarket) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Inseriria ANYMARKET pedido_id=${pedidoId}`);
    return;
  }
  await db.query(
    `INSERT INTO tracking_events
       (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em)
     VALUES ($1, $2, 'ANYMARKET', $3, $4, $5, $6, NOW())
     ON CONFLICT DO NOTHING`,
    [
      uuidv4(),
      pedidoId,
      dadosAnymarket.situationCode || "PAID_WAITING_SHIP",
      dadosAnymarket.createdAt || new Date().toISOString(),
      JSON.stringify({
        type:    "ORDER",
        event:   dadosAnymarket.situationCode || "PAID_WAITING_SHIP",
        content: { id: String(dadosAnymarket.id), oi: "", metadata: "" },
      }),
      JSON.stringify(dadosAnymarket),
    ]
  );
  console.log(`  ✔ ANYMARKET inserido — pedido_id: ${pedidoId}`);
}

/**
 * Insere evento da JET em tracking_events com o mesmo pedido_id do Anymarket.
 */
async function inserirEventoJet(pedidoId, dadosJet) {
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Inseriria JET pedido_id=${pedidoId}`);
    return;
  }
  await db.query(
    `INSERT INTO tracking_events
       (id, pedido_id, origem, status, timestamp, payload, dados_completos, criado_em)
     VALUES ($1, $2, 'JET', $3, $4, $5, $6, NOW())
     ON CONFLICT DO NOTHING`,
    [
      uuidv4(),
      pedidoId,
      dadosJet.status || dadosJet.situationCode || "CONFIRMADO",
      dadosJet.orderDate || dadosJet.createdAt || new Date().toISOString(),
      JSON.stringify({
        Id:                "recuperado_manual",
        Event:             "Pedido.Recuperado",
        ModifiedId:        dadosJet.orderId || dadosJet.id || "",
        ModifiedExternalId: "",
      }),
      JSON.stringify(dadosJet),
    ]
  );
  console.log(`  ✔ JET inserido — pedido_id: ${pedidoId}`);
}

// ─── LÓGICA PRINCIPAL ─────────────────────────────────────────────────────────

async function recuperarPedido(anymarketId) {
  console.log(`\n── Anymarket ID: ${anymarketId} ${"─".repeat(40 - String(anymarketId).length)}`);

  // 1. Busca no Anymarket
  console.log(`  → Buscando no Anymarket...`);
  let dadosAnymarket;
  try {
    dadosAnymarket = await fetchAnymarketById(anymarketId);
  } catch (err) {
    const status = err.response?.status;
    const msg = status === 404
      ? `ID ${anymarketId} não encontrado no Anymarket (404)`
      : `Erro Anymarket: ${err.message}`;
    console.error(`  ✗ ${msg}`);
    return { anymarketId, status: "error", erro: msg };
  }

  if (!dadosAnymarket) {
    console.log(`  ✗ Anymarket retornou vazio`);
    return { anymarketId, status: "not_found" };
  }

  // Determina o pedido_id: usa marketPlaceId (S-...) se existir
  const pedidoId = String(
    dadosAnymarket.marketPlaceId ||
    dadosAnymarket.marketPlaceNumber ||
    anymarketId
  );

  console.log(`  ✔ Encontrado no Anymarket`);
  console.log(`    pedido_id       : ${pedidoId}`);
  console.log(`    marketPlaceNumber: ${dadosAnymarket.marketPlaceNumber || "—"}`);
  console.log(`    situationCode   : ${dadosAnymarket.situationCode || "—"}`);
  console.log(`    accountName     : ${dadosAnymarket.accountName || "—"}`);

  // 2. Verifica se já existe no banco
  const existente = await jaExisteNoBanco(anymarketId, pedidoId);
  if (existente) {
    console.log(`  ⚠ Já existe no banco com pedido_id: ${existente} — pulando`);
    return { anymarketId, status: "skipped", pedidoId: existente };
  }

  // 3. Busca na JET
  // O Anymarket pode retornar o ID do pedido JET em campos diferentes.
  // Imprime todos os campos disponíveis no dry-run para diagnóstico.
  const jetOrderId =
    dadosAnymarket.jetOrderId     ||
    dadosAnymarket.erpOrderId     ||
    dadosAnymarket.externalOrderId||
    dadosAnymarket.idOrder        ||
    null;

  let dadosJet = null;
  if (jetOrderId) {
    console.log(`  → Buscando na JET (id: ${jetOrderId})...`);
    try {
      dadosJet = await fetchJetOrder(jetOrderId);
      if (dadosJet) {
        console.log(`  ✔ JET encontrado — status: ${dadosJet.status || dadosJet.situationCode || "?"}`);
      } else {
        console.log(`  ⚠ JET não retornou dados para id: ${jetOrderId}`);
      }
    } catch (err) {
      console.log(`  ⚠ Erro JET (não crítico, prosseguindo): ${err.message}`);
    }
  } else {
    console.log(`  ⚠ Campo de ID da JET não encontrado no retorno do Anymarket.`);
    console.log(`    Campos retornados: ${Object.keys(dadosAnymarket).join(", ")}`);
  }

  // 4. Insere no banco
  await inserirEventoAnymarket(pedidoId, dadosAnymarket);
  if (dadosJet) {
    await inserirEventoJet(pedidoId, dadosJet);
  }

  return {
    anymarketId,
    pedidoId,
    status: "inserted",
    jet: !!dadosJet,
  };
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

async function main() {
  // Lê IDs da linha de comando
  let ids = process.argv
    .slice(2)
    .filter((a) => !a.startsWith("--"));

  // Lê de arquivo se --file foi passado
  const fileIdx = process.argv.indexOf("--file");
  if (fileIdx !== -1 && process.argv[fileIdx + 1]) {
    const filePath = path.resolve(process.argv[fileIdx + 1]);
    const linhas = fs.readFileSync(filePath, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    ids = [...ids, ...linhas];
  }

  if (ids.length === 0) {
    console.error("Uso: node recover_ml_orders.js <anymarket_id1> <anymarket_id2> ...");
    console.error("     node recover_ml_orders.js --file ids.txt");
    console.error("     node recover_ml_orders.js --dry-run <anymarket_id>");
    process.exit(1);
  }

  if (DRY_RUN) console.log("⚑  MODO DRY-RUN — nenhum dado será salvo\n");

  const resultados = [];
  for (const id of ids) {
    try {
      const r = await recuperarPedido(id);
      resultados.push(r);
    } catch (err) {
      console.error(`  ✗ Erro inesperado em ${id}: ${err.message}`);
      resultados.push({ anymarketId: id, status: "error", erro: err.message });
    }
    // Pausa entre chamadas para não sobrecarregar as APIs
    await new Promise((r) => setTimeout(r, 500));
  }

  // Resumo
  console.log("\n══ RESUMO " + "═".repeat(50));
  for (const r of resultados) {
    const jet = r.jet === undefined ? "" : r.jet ? " + JET" : " (sem JET)";
    const linha = {
      inserted: `✔  ${r.anymarketId} → ${r.pedidoId}${jet}`,
      skipped:  `⚠  ${r.anymarketId} → já existia como ${r.pedidoId}`,
      not_found:`✗  ${r.anymarketId} → não encontrado no Anymarket`,
      error:    `✗  ${r.anymarketId} → ${r.erro}`,
    }[r.status] || `?  ${r.anymarketId} → ${r.status}`;
    console.log(linha);
  }

  const inseridos = resultados.filter((r) => r.status === "inserted").length;
  const pulados   = resultados.filter((r) => r.status === "skipped").length;
  const falhas    = resultados.filter((r) => ["error","not_found"].includes(r.status)).length;
  console.log(`\n   ${inseridos} inseridos  |  ${pulados} já existiam  |  ${falhas} falhas`);

  // Fecha conexão do pool se o db expõe o método end()
  if (db.end) await db.end();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});