// backend/src/controllers/syncController.js
const { sincronizarPrazosPendentes } = require('../services/anymarketSyncService');
const pool = require('../../config/database');

const SyncController = {

  async getStatus(req, res) {
    try {
      // Status real (ignorando tracking_events)
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) AS total_pedidos,
          COUNT(prazo_despacho) AS com_prazo,
          COUNT(*) - COUNT(prazo_despacho) AS sem_prazo,
          COUNT(CASE WHEN id_anymarket IS NULL THEN 1 END) AS sem_id_anymarket
        FROM pedidos_mapeamento
      `);

      res.json({ success: true, status: rows[0] });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  },

  async sincronizarPrazos(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await sincronizarPrazosPendentes({
        onProgress: (evt) => send(evt)
      });
    } catch (error) {
      send({ type: 'error', message: error.message });
    } finally {
      res.end();
    }
  }
};

module.exports = SyncController;