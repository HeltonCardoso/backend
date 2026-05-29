// backend/src/routes/webhook.routes.js
const express = require("express");
const router = express.Router();
const anymarketService = require("../services/anymarket.service");
const jetService = require("../services/jet.service");

// ============================================================
// JET WEBHOOK - Principal
// ============================================================
router.post("/jet", async (req, res) => {
  const payload = req.body;
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📥 WEBHOOK JET RECEBIDO!`);
  console.log(`📦 Payload bruto:`, JSON.stringify(payload, null, 2));
  
  // ⭐ RESPOSTA IMEDIATA - CRÍTICO PARA RENDER!
  res.status(200).json({ 
    success: true, 
    message: "Webhook recebido, processando em background",
    timestamp: new Date().toISOString()
  });
  
  // Processamento em background (sem bloquear resposta)
  setImmediate(async () => {
    try {
      const result = await jetService.processWebhook(payload);
      console.log(`✅ Webhook JET processado:`, result);
    } catch (err) {
      console.error(`❌ Erro no processamento JET:`, err.message);
    }
  });
});

// ============================================================
// ANYMARKET WEBHOOK
// ============================================================
router.post("/anymarket", async (req, res) => {
  const payload = req.body;
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📥 WEBHOOK ANYMARKET RECEBIDO!`);
  console.log(`📦 Evento: ${payload.type || payload.situationCode || "desconhecido"}`);
  
  // Resposta imediata
  res.status(200).json({ 
    success: true, 
    message: "Webhook recebido, processando em background",
    timestamp: new Date().toISOString()
  });
  
  // Processamento em background
  setImmediate(async () => {
    try {
      const result = await anymarketService.processWebhook(payload);
      console.log(`✅ Webhook AnyMarket processado:`, result?.ok ? "OK" : "ERRO");
    } catch (err) {
      console.error(`❌ Erro no processamento AnyMarket:`, err.message);
    }
  });
});

// ============================================================
// ONCLICK WEBHOOK (se precisar)
// ============================================================
router.post("/onclick", async (req, res) => {
  const payload = req.body;
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📥 WEBHOOK ONCLICK RECEBIDO!`);
  
  res.status(200).json({ success: true, message: "Webhook recebido" });
  
  setImmediate(async () => {
    try {
      // Processar ONCLICK se tiver lógica
      console.log(`✅ Webhook OnClick registrado`);
    } catch (err) {
      console.error(`❌ Erro:`, err.message);
    }
  });
});

// ============================================================
// ENDPOINTS DE TESTE E DIAGNÓSTICO
// ============================================================

// Teste simples - verifica se o endpoint está vivo
router.get("/jet/test", (req, res) => {
  res.json({ 
    status: "online", 
    message: "Webhook JET endpoint está funcionando",
    url: "/api/webhooks/jet",
    method: "POST",
    expected_payload: {
      Id: "número_interno",
      ModifiedId: "número_do_pedido",
      Event: "Pedido.Pago",
      EventOccurredAt: "2025-01-15T10:00:00Z"
    },
    timestamp: new Date().toISOString()
  });
});

// Status geral do serviço
router.get("/status", async (req, res) => {
  let dbStatus = "unknown";
  try {
    const result = await pool.query("SELECT 1");
    dbStatus = result.rows ? "connected" : "error";
  } catch (e) {
    dbStatus = "disconnected";
  }
  
  res.json({
    service: "webhook-receiver",
    status: "running",
    database: dbStatus,
    jet_api_token: process.env.JET_API_TOKEN ? "configured" : "missing",
    timestamp: new Date().toISOString()
  });
});

module.exports = router;