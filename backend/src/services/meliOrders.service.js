// backend/src/services/meliOrders.service.js
const axios = require('axios');
const db = require('../../config/database');
const meliAuthService = require('./meliAuth.service');

class MeliOrdersService {
    
    // Buscar pedidos do Mercado Livre
    async fetchOrders(accessToken, options = {}) {
        const { sellerId, status, limit = 50, offset = 0 } = options;
        
        try {
            const response = await axios.get(`${process.env.MELI_API_URL}/orders/search`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: {
                    seller: sellerId,
                    order_status: status || 'paid',
                    limit: limit,
                    offset: offset,
                    sort: 'date_desc'
                }
            });
            
            return {
                orders: response.data.results,
                total: response.data.paging.total,
                offset: response.data.paging.offset,
                limit: response.data.paging.limit
            };
            
        } catch (error) {
            console.error('[MeliOrders] Erro ao buscar pedidos:', error.response?.data || error.message);
            throw error;
        }
    }
    
    // Buscar detalhes de um pedido específico
    async fetchOrderDetails(accessToken, orderId) {
        try {
            const response = await axios.get(`${process.env.MELI_API_URL}/orders/${orderId}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            return response.data;
        } catch (error) {
            console.error(`[MeliOrders] Erro ao buscar pedido ${orderId}:`, error.response?.data || error.message);
            throw error;
        }
    }
    
    // Sincronizar todos os pedidos
    async syncOrders(dateFrom = null, dateTo = null) {
        const accessToken = await meliAuthService.getValidToken();
        
        if (!accessToken) {
            throw new Error('Não autenticado com Mercado Livre');
        }
        
        // Buscar informações do vendedor
        const userInfo = await meliAuthService.getUserInfo(accessToken);
        const sellerId = userInfo.id;
        
        let allOrders = [];
        let offset = 0;
        const limit = 50;
        let hasMore = true;
        
        // Registrar início do sync
        await db.query(`
            INSERT INTO meli_sync_log (sync_type, status, started_at)
            VALUES ('orders', 'running', NOW())
        `);
        
        try {
            while (hasMore) {
                const result = await this.fetchOrders(accessToken, {
                    sellerId: sellerId,
                    limit: limit,
                    offset: offset
                });
                
                if (result.orders && result.orders.length > 0) {
                    allOrders.push(...result.orders);
                    offset += limit;
                    hasMore = offset < result.total;
                } else {
                    hasMore = false;
                }
                
                // Aguardar para não exceder rate limit
                await this.sleep(200);
            }
            
            // Processar e salvar pedidos
            let saved = 0;
            for (const order of allOrders) {
                await this.saveOrder(order, accessToken);
                saved++;
            }
            
            // Atualizar log
            await db.query(`
                UPDATE meli_sync_log 
                SET status = 'completed', 
                    total_processed = $1,
                    completed_at = NOW()
                WHERE sync_type = 'orders' AND status = 'running'
            `, [saved]);
            
            return { success: true, total: saved, orders: allOrders };
            
        } catch (error) {
            await db.query(`
                UPDATE meli_sync_log 
                SET status = 'error', 
                    error_message = $1,
                    completed_at = NOW()
                WHERE sync_type = 'orders' AND status = 'running'
            `, [error.message]);
            
            throw error;
        }
    }
    
    // Salvar pedido no banco
    async saveOrder(orderData, accessToken) {
        // Buscar detalhes completos do pedido
        const details = await this.fetchOrderDetails(accessToken, orderData.id);
        
        // Mapear para estrutura do sistema
        const mappedOrder = {
            pedido_id: `ML-${orderData.id}`,
            marketplace: 'MERCADO_LIVRE',
            numero_marketplace: orderData.id.toString(),
            id_anymarket: null,
            status: this.mapStatus(orderData.status),
            created_at: orderData.date_created,
            total_amount: orderData.total_amount,
            buyer_name: details.buyer?.nickname,
            buyer_email: details.buyer?.email,
            shipping_address: details.shipping?.receiver_address?.address_line,
            raw_data: JSON.stringify(orderData)
        };
        
        // Salvar ou atualizar no banco
        await db.query(`
            INSERT INTO pedidos_mapeamento (
                pedido_id, marketplace, numero_marketplace, status_atual, 
                criado_em, valor_total, raw_data, atualizado_em
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (numero_marketplace) 
            DO UPDATE SET 
                status_atual = EXCLUDED.status_atual,
                valor_total = EXCLUDED.valor_total,
                raw_data = EXCLUDED.raw_data,
                atualizado_em = NOW()
        `, [
            mappedOrder.pedido_id,
            mappedOrder.marketplace,
            mappedOrder.numero_marketplace,
            mappedOrder.status,
            mappedOrder.created_at,
            mappedOrder.total_amount,
            mappedOrder.raw_data
        ]);
        
        return mappedOrder;
    }
    
    // Mapear status do Mercado Livre
    mapStatus(mlStatus) {
        const map = {
            'paid': 'PAGO',
            'payment_required': 'AGUARDANDO_PAGAMENTO',
            'confirmed': 'CONFIRMADO',
            'ready_to_ship': 'PRONTO_PARA_ENVIO',
            'shipped': 'ENVIADO',
            'delivered': 'ENTREGUE',
            'cancelled': 'CANCELADO'
        };
        return map[mlStatus] || mlStatus;
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new MeliOrdersService();