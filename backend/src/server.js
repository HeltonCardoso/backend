require("dotenv").config();
require("express-async-errors");

const express    = require("express");
const cors       = require("cors");
const cron       = require("node-cron");
const path       = require("path");

const app = express();

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Loga todas as requisições em dev
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ─── ROTAS ────────────────────────────────────────────────────────────────────
app.use("/api/orders",   require("./routes/orders.routes"));
app.use("/api/backfill", require("./routes/backfill.routes"));
app.use("/api/webhooks", require("./routes/webhook.routes"));
app.use("/api/dashboard", require("./routes/dashboard.routes"));
app.use("/api/auth", require("./routes/auth.routes"));
// Health check (necessário no Render)
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
// Adicione isso antes do app.listen
app.get('/api/test-db', async (req, res) => {
  try {
    const pool = require('../config/database');
    const result = await pool.query('SELECT NOW() as time, COUNT(*) as total FROM pedidos_mapeamento');
    res.json({ 
      success: true, 
      time: result.rows[0].time,
      total_pedidos: result.rows[0].total,
      message: 'Conexão com banco está OK!'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ─── CRON — recalcula SLA a cada hora ─────────────────────────────────────────
cron.schedule("0 * * * *", () => {
  console.log("[Cron] Recalculando SLA...");
  try {
    require("./services/backfill.service").recalcAllSla();
  } catch (e) {
    console.error("[Cron] Erro:", e.message);
  }
});

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: err.message });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Marketplace Monitor rodando na porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Orders: http://localhost:${PORT}/api/orders`);
  console.log(`   Webhook Anymarket: http://localhost:${PORT}/api/webhooks/anymarket`);
  console.log(`   Webhook JET:       http://localhost:${PORT}/api/webhooks/jet`);
  console.log(`   Backfill:          POST http://localhost:${PORT}/api/backfill/all\n`);
});

module.exports = app;
