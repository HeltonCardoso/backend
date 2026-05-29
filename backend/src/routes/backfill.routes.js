/**
 * backfill.routes.js
 * 
 * Endpoints para disparar e monitorar o backfill histórico.
 * Usa Server-Sent Events (SSE) para enviar progresso em tempo real ao frontend.
 */

const express = require("express");
const router  = express.Router();
const backfillService = require("../services/backfill.service");

// ─── POST /api/backfill/anymarket ─────────────────────────────────────────────
// Dispara backfill do Anymarket com progresso via SSE
// Body: { dateFrom?: "2024-01-01", dateTo?: "2024-12-31" }
router.post("/anymarket", async (req, res) => {
  const { dateFrom, dateTo } = req.body;

  // Configura SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: "start", message: "Iniciando backfill do Anymarket..." });

  try {
    const result = await backfillService.backfillAnymarket({
      dateFrom,
      dateTo,
      onProgress: (p) => send({ type: "progress", ...p }),
    });

    send({ type: "done", result });
    res.end();
  } catch (err) {
    send({ type: "error", message: err.message });
    res.end();
  }
});

// ─── POST /api/backfill/jet ───────────────────────────────────────────────────
// Dispara backfill da JET (enriquecimento)
router.post("/jet", async (req, res) => {
  const { dateFrom, dateTo } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: "start", message: "Iniciando backfill da JET..." });

  try {
    const result = await backfillService.backfillJet({
      dateFrom,
      dateTo,
      onProgress: (p) => send({ type: "progress", ...p }),
    });

    send({ type: "done", result });
    res.end();
  } catch (err) {
    send({ type: "error", message: err.message });
    res.end();
  }
});

// ─── POST /api/backfill/corrigir ─────────────────────────────────────────────
// Corrige dados faltantes em pedidos existentes (loja, marketplace_canal, prazo)
router.post("/corrigir", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: "start", message: "Iniciando correção de pedidos existentes..." });

  try {
    const result = await backfillService.corrigirPedidosExistentes({
      onProgress: (p) => send({ type: "progress", ...p }),
    });

    send({ type: "done", result });
    res.end();
  } catch (err) {
    send({ type: "error", message: err.message });
    res.end();
  }
});

// ─── POST /api/backfill/all ───────────────────────────────────────────────────
// Backfill completo: Anymarket → JET → recalc SLA
router.post("/all", async (req, res) => {
  const { dateFrom, dateTo } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  send({ type: "start", message: "Iniciando backfill completo..." });

  try {
    const result = await backfillService.backfillAll({
      dateFrom,
      dateTo,
      onProgress: (p) => send({ type: "progress", ...p }),
    });

    send({ type: "done", result });
    res.end();
  } catch (err) {
    send({ type: "error", message: err.message });
    res.end();
  }
});

// ─── GET /api/backfill/progress ───────────────────────────────────────────────
// Retorna o progresso atual (polling alternativo ao SSE)
router.get("/progress", (req, res) => {
  res.json(backfillService.getProgress() || { status: "idle" });
});

// ─── GET /api/backfill/history ────────────────────────────────────────────────
// Histórico dos últimos runs
router.get("/history", (req, res) => {
  res.json(backfillService.getRunHistory());
});

// ─── POST /api/backfill/recalc-sla ───────────────────────────────────────────
// Força recálculo de SLA em todos os pedidos
router.post("/recalc-sla", (req, res) => {
  backfillService.recalcAllSla();
  res.json({ ok: true, message: "SLA recalculado com sucesso" });
});

module.exports = router;