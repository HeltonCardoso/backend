/**
 * webhook.routes.js
 * 
 * Recebe webhooks do Anymarket e da JET.
 * 
 * Configure nas plataformas:
 *   Anymarket: POST https://seudominio.com/api/webhooks/anymarket
 *   JET:       POST https://seudominio.com/api/webhooks/jet
 */

const express = require("express");
const router  = express.Router();
const anymarketService = require("../services/anymarket.service");
const jetService       = require("../services/jet.service");

// ─── ANYMARKET WEBHOOK ────────────────────────────────────────────────────────
router.post("/anymarket", async (req, res) => {
  try {
    const payload = req.body;
    console.log(`[Webhook Anymarket] ${payload.type || payload.situationCode || "evento"}`);
    
    const result = anymarketService.processWebhook(payload);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[Webhook Anymarket] Erro:", err.message);
    // Retorna 200 mesmo em erro para não gerar reenvios infinitos
    res.status(200).json({ ok: false, error: err.message });
  }
});

// ─── JET WEBHOOK ─────────────────────────────────────────────────────────────
router.post("/jet", async (req, res) => {
  try {
    const payload = req.body;
    console.log(`[Webhook JET] ${payload.event || payload.type || "evento"}`);

    const result = jetService.processWebhook(payload);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[Webhook JET] Erro:", err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
