// backend/src/services/meliOrders.service.js
const axios = require('axios');
const db = require('../../config/database');
const meliAuthService = require('./meliAuth.service');

class MeliOrdersService {
    
    // Buscar pedidos do Mercado Livre
    async fetchOrders(accessToken, options = {}) {
        const { sellerId, status, limit = 50, offset = 0, dateFrom = null } = options;
        
        try {
            const params = {
                seller: sellerId,
                order_status: status || 'paid',
                limit: limit,
                offset: offset,
                sort: 'date_desc'
            };
            
            // Adicionar filtro de data se fornecido
            if (dateFrom) {
                params.begin_date = dateFrom;
            }
            
            const response = await axios.get(`${process.env.MELI_API_URL}/orders/search`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                },
                params: params
            });
            
            return {
                orders: response.data.results || [],
                total: response.data.paging?.total || 0,
                offset: response.data.paging?.offset || 0,
                limit: response.data.paging?.limit || 50
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
            return null;
        }
    }
    
    // Sincronizar todos os pedidos (com suporte a cancelamento)
    async syncOrders(dias = 30, signal = null) {
        const accessToken = await meliAuthService.getValidToken();
        
        if (!accessToken) {
            throw new Error('Não autenticado com Mercado Livre');
        }
        
        // Verificar cancelamento
        if (signal?.aborted) {
            throw new Error('Sync cancelled');
        }
        
        // Buscar informações do vendedor
        const userInfo = await meliAuthService.getUserInfo(accessToken);
        const sellerId = userInfo.id;
        
        // Calcular data de corte (padrão 30 dias atrás)
        const dataCorte = new Date();
        dataCorte.setDate(dataCorte.getDate() - dias);
        const dateFrom = dataCorte.toISOString();
        
        console.log(`[MeliOrders] Buscando pedidos dos últimos ${dias} dias (desde ${dateFrom})`);
        
        let allOrders = [];
        let offset = 0;
        const limit = 50;
        let hasMore = true;
        let totalProcessed = 0;
        let totalInserted = 0;
        let totalUpdated = 0;
        
        // Registrar início do sync
        await db.query(`
            INSERT INTO meli_sync_log (sync_type, status, started_at)
            VALUES ('orders', 'running', NOW())
        `);
        
        try {
            while (hasMore) {
                // Verificar cancelamento antes de cada página
                if (signal?.aborted) {
                    console.log('[MeliOrders] Sync cancelado pelo usuário');
                    throw new Error('Sync cancelled');
                }
                
                const result = await this.fetchOrders(accessToken, {
                    sellerId: sellerId,
                    limit: limit,
                    offset: offset,
                    dateFrom: dateFrom
                });
                
                if (result.orders && result.orders.length > 0) {
                    allOrders.push(...result.orders);
                    offset += limit;
                    hasMore = offset < result.total;
                    
                    console.log(`[MeliOrders] Página ${offset / limit}: ${result.orders.length} pedidos, Total até agora: ${allOrders.length}`);
                } else {
                    hasMore = false;
                }
                
                // Aguardar para não exceder rate limit
                await this.sleep(200);
            }
            
            console.log(`[MeliOrders] Total de pedidos encontrados: ${allOrders.length}`);
            
            // Processar e salvar pedidos
            for (let i = 0; i < allOrders.length; i++) {
                // Verificar cancelamento durante o processamento
                if (signal?.aborted) {
                    console.log('[MeliOrders] Cancelamento durante processamento');
                    throw new Error('Sync cancelled');
                }
                
                const order = allOrders[i];
                const result = await this.saveOrder(order, accessToken);
                
                if (result.action === 'inserted') {
                    totalInserted++;
                } else if (result.action === 'updated') {
                    totalUpdated++;
                }
                totalProcessed++;
                
                // Log a cada 10 pedidos
                if ((i + 1) % 10 === 0) {
                    console.log(`[MeliOrders] Processados ${i + 1}/${allOrders.length} pedidos (Inseridos: ${totalInserted}, Atualizados: ${totalUpdated})`);
                }
            }
            
            // Atualizar log
            await db.query(`
                UPDATE meli_sync_log 
                SET status = 'completed', 
                    total_processed = $1,
                    completed_at = NOW()
                WHERE sync_type = 'orders' AND status = 'running'
            `, [totalProcessed]);
            
            console.log(`[MeliOrders] Sync concluído! Inseridos: ${totalInserted}, Atualizados: ${totalUpdated}`);
            
            return { 
                success: true, 
                total: totalProcessed,
                inserted: totalInserted,
                updated: totalUpdated
            };
            
        } catch (error) {
            if (error.message === 'Sync cancelled') {
                await db.query(`
                    UPDATE meli_sync_log 
                    SET status = 'cancelled', 
                        completed_at = NOW()
                    WHERE sync_type = 'orders' AND status = 'running'
                `);
                throw error;
            } else {
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
    }
    
    // Salvar pedido no banco (verificando duplicatas)
    async saveOrder(orderData, accessToken) {
        // Buscar detalhes completos do pedido
        const details = await this.fetchOrderDetails(accessToken, orderData.id);
        
        const mlOrderId = String(orderData.id);
        const pedidoId = `ML-${mlOrderId}`;
        const status = this.mapStatus(orderData.status);
        const createdAt = orderData.date_created;
        const totalAmount = parseFloat(orderData.total_amount) || 0;
        
        // 🔍 VERIFICAR SE JÁ EXISTE (evitar duplicação)
        const existing = await db.query(`
            SELECT id, pedido_id, status_atual, id_anymarket 
            FROM pedidos_mapeamento 
            WHERE numero_marketplace = $1 
               OR pedido_id = $2
        `, [mlOrderId, pedidoId]);
        
        if (existing.rows.length > 0) {
            // ✅ PEDIDO JÁ EXISTE - Atualizar apenas dados que podem ter mudado
            console.log(`[MeliOrders] Pedido ${pedidoId} já existe. Atualizando...`);
            
            await db.query(`
                UPDATE pedidos_mapeamento 
                SET status_atual = $1,
                    valor_total = $2,
                    raw_data = $3,
                    atualizado_em = NOW()
                WHERE id = $4
            `, [status, totalAmount, JSON.stringify(orderData), existing.rows[0].id]);
            
            // Registrar atualização no tracking_events
            await db.query(`
                INSERT INTO tracking_events (
                    pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), $6)
            `, [
                pedidoId,
                'MERCADO_LIVRE',
                status,
                createdAt,
                JSON.stringify({ 
                    event: 'sync_update',
                    old_status: existing.rows[0].status_atual,
                    new_status: status
                }),
                JSON.stringify(orderData)
            ]);
            
            return { action: 'updated', id: pedidoId };
        } else {
            // ✨ PEDIDO NOVO - Inserir
            console.log(`[MeliOrders] Pedido ${pedidoId} é NOVO. Inserindo...`);
            
            await db.query(`
                INSERT INTO pedidos_mapeamento (
                    pedido_id, 
                    marketplace, 
                    numero_marketplace,
                    marketplace_origem,
                    status_atual, 
                    criado_em, 
                    valor_total, 
                    raw_data, 
                    atualizado_em
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            `, [
                pedidoId,
                'MERCADO_LIVRE',
                mlOrderId,
                'MERCADO_LIVRE',
                status,
                createdAt,
                totalAmount,
                JSON.stringify(orderData)
            ]);
            
            // Registrar criação no tracking_events
            await db.query(`
                INSERT INTO tracking_events (
                    pedido_id, origem, status, timestamp, payload, criado_em, dados_completos
                )
                VALUES ($1, $2, $3, $4, $5, NOW(), $6)
            `, [
                pedidoId,
                'MERCADO_LIVRE',
                status,
                createdAt,
                JSON.stringify({ 
                    event: 'pedido_criado',
                    source: 'meli_sync'
                }),
                JSON.stringify(orderData)
            ]);
            
            return { action: 'inserted', id: pedidoId };
        }
    }
    
    // Mapear status do Mercado Livre
    mapStatus(mlStatus) {
        const map = {
            'paid': 'PAGO',
            'payment_required': 'AGUARDANDO_PAGAMENTO',
            'payment_in_process': 'PAGAMENTO_PROCESSANDO',
            'confirmed': 'CONFIRMADO',
            'ready_to_ship': 'PRONTO_PARA_ENVIO',
            'shipped': 'ENVIADO',
            'delivered': 'ENTREGUE',
            'cancelled': 'CANCELADO',
            'refunded': 'REEMBOLSADO'
        };
        return map[mlStatus] || mlStatus;
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new MeliOrdersService();