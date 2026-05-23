// backend/src/routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const DashboardController = require('../controllers/dashboardController');

// Rotas do dashboard
router.get('/metricas', DashboardController.getMetricasGerais);
router.get('/anomalias', DashboardController.getAnomalias);
router.get('/pedidos', DashboardController.getPedidosPipeline);
router.get('/pedidos/:numeroMarketplace', DashboardController.getPedidoDetalhes);
router.get('/graficos', DashboardController.getGraficoStatusPorPlataforma);
router.put('/anomalias/:id/resolver', DashboardController.resolverAnomalia);

module.exports = router;