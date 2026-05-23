// backend/src/services/tracking.service.js
const pool = require("../../config/database");
const { v4: uuidv4 } = require('uuid');

class TrackingService {
  // Registrar evento de tracking
  async registerEvent(pedidoId, origem, status, payload = null) {
    const eventId = uuidv4();
    const query = `
      INSERT INTO tracking_events (id, pedido_id, origem, status, timestamp, payload, dados_completos)
      VALUES ($1, $2, $3, $4, NOW(), $5, $6)
    `;
    await pool.query(query, [eventId, pedidoId, origem, status, JSON.stringify(payload), JSON.stringify(payload)]);
    return eventId;
  }

  // Mapear pedido entre plataformas
  async mapOrder(anymarketId, jetId, onclickId, marketplaceNumber, marketplaceOrigem) {
    const query = `
      INSERT INTO pedidos_mapeamento (id_anymarket, id_jet, id_onclick, numero_marketplace, marketplace_origem)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (numero_marketplace) 
      DO UPDATE SET 
        id_anymarket = EXCLUDED.id_anymarket,
        id_jet = EXCLUDED.id_jet,
        id_onclick = EXCLUDED.id_onclick,
        atualizado_em = NOW()
      RETURNING *
    `;
    const result = await pool.query(query, [anymarketId, jetId, onclickId, marketplaceNumber, marketplaceOrigem]);
    return result.rows[0];
  }

  // Verificar anomalias
  async checkAnomalies(pedidoId) {
    const query = `
      SELECT * FROM anomalias 
      WHERE pedido_id = $1 AND resolvida = FALSE
      ORDER BY criado_em DESC
    `;
    const result = await pool.query(query, [pedidoId]);
    return result.rows;
  }

  // Resolver anomalia
  async resolveAnomaly(pedidoId, tipo) {
    const query = `
      UPDATE anomalias 
      SET resolvida = TRUE, resolvida_em = NOW()
      WHERE pedido_id = $1 AND tipo = $2
    `;
    await pool.query(query, [pedidoId, tipo]);
  }
}

module.exports = new TrackingService();