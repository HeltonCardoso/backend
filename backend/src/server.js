require("dotenv").config();
require("express-async-errors");

const express    = require("express");
const cors       = require("cors");
const cron       = require("node-cron");
const path       = require("path");
const fs         = require("fs");
const syncRoutes = require('./routes/sync.routes');
const meliAuthRoutes = require('./routes/meliAuth.routes');
const meliOrdersService = require('./services/meliOrders.service');

const app = express();

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/meli', meliAuthRoutes);
app.set('trust proxy', 1);

// Loga todas as requisições em dev
if (process.env.NODE_ENV !== "production") {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ─── ROTAS DA API (TODAS antes do frontend) ───────────────────────────────────
app.use("/api/orders",   require("./routes/orders.routes"));
app.use("/api/backfill", require("./routes/backfill.routes"));
app.use("/api/webhooks", require("./routes/webhook.routes"));  // ← Webhooks aqui!
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

// Rota para sincronizar pedidos do Mercado Livre
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
// SERVIDOR DE ARQUIVOS ESTÁTICOS (React/Frontend)
// ════════════════════════════════════════════════════════════════════════════

const frontendDistPath = path.join(process.cwd(), 'frontend/dist');

if (fs.existsSync(frontendDistPath)) {
  // Serve arquivos estáticos do frontend
  app.use(express.static(frontendDistPath));
  
  // Fallback para SPA - NÃO captura rotas /api/
  app.get('*', (req, res) => {
    // Se for rota de API, retorna 404 em vez de mandar o frontend
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: `API endpoint not found: ${req.path}` });
    }
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  console.log('⚠️ Frontend não encontrado, servindo apenas API');
  // Fallback para rotas não encontradas
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ error: `API endpoint not found: ${req.path}` });
    } else {
      res.status(404).send('Not found');
    }
  });
}

// ─── ERROR HANDLER (deve ser o ÚLTIMO) ────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: err.message });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Marketplace Monitor rodando na porta ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   API Test: http://localhost:${PORT}/api/test-db`);
  console.log(`   Webhook Anymarket: POST http://localhost:${PORT}/api/webhooks/anymarket`);
  console.log(`   Webhook JET:       POST http://localhost:${PORT}/api/webhooks/jet`);
  console.log(`   Webhook Test:      GET  http://localhost:${PORT}/api/webhooks/jet/test`);
  console.log(`   Backfill:          POST http://localhost:${PORT}/api/backfill/all\n`);
  
  if (fs.existsSync(frontendDistPath)) {
    console.log(`   📱 Frontend React: http://localhost:${PORT}`);
  }
  console.log(`   🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;