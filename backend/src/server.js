require("dotenv").config();
require("express-async-errors");

const express    = require("express");
const cors       = require("cors");
const cron       = require("node-cron");
const path       = require("path");
const syncRoutes = require('./routes/sync.routes');
const meliAuthRoutes = require('./routes/meliAuth.routes');
const meliOrdersService = require('./services/meliOrders.service');

const app = express();

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/meli', meliAuthRoutes);

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
app.use("/api/upload", require("./routes/upload.routes"));
app.use('/api/sync', syncRoutes);

// Health check (necessário no Render)
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Rota para testar DB
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

// Rota para sincronizar pedidos
app.post('/api/meli/sync-orders', async (req, res) => {
    try {
        const result = await meliOrdersService.syncOrders();
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
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

// ════════════════════════════════════════════════════════════════════════════
// 🚨 PARTE CRUCIAL PARA O REACT - ADICIONE ISSO!
// ════════════════════════════════════════════════════════════════════════════

// Servir os arquivos estáticos do React (build do Vite)
// O caminho './dist' é onde o Vite gera os arquivos
app.use(express.static(path.join(__dirname, 'dist')));

// ROTA CORINGA - deve ser a ÚLTIMA rota do arquivo
// Isso faz com que qualquer rota não encontrada sirva o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
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
  console.log(`   📱 Frontend React disponível em: http://localhost:${PORT}`);
});

module.exports = app;