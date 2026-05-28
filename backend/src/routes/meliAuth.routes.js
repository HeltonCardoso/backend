// backend/src/routes/meliAuth.routes.js
const express = require('express');
const router = express.Router();
const meliAuthService = require('../services/meliAuth.service');
const meliOrdersService = require('../services/meliOrders.service');
const db = require('../../config/database');

// Iniciar fluxo OAuth - redireciona para Mercado Livre
router.get('/auth', (req, res) => {
    const authUrl = meliAuthService.getAuthUrl();
    res.redirect(authUrl);
});

// Callback após autorização
router.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    
    if (error) {
        return res.send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1 style="color: red;">❌ Erro na autorização</h1>
                    <p>${error}</p>
                    <button onclick="window.close()">Fechar</button>
                </body>
            </html>
        `);
    }
    
    try {
        // Trocar código por token
        const tokenData = await meliAuthService.exchangeCodeForToken(code);
        
        // Buscar informações do usuário
        const userInfo = await meliAuthService.getUserInfo(tokenData.access_token);
        
        // Salvar token com informações do usuário
        await meliAuthService.saveToken({
            ...tokenData,
            user_nickname: userInfo.nickname,
            user_email: userInfo.email
        });
        
        // Retornar página de sucesso
        res.send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1 style="color: green;">✅ Conexão com Mercado Livre bem-sucedida!</h1>
                    <p>Usuário: ${userInfo.nickname}</p>
                    <p>Email: ${userInfo.email}</p>
                    <button onclick="window.close()">Fechar</button>
                    <script>
                        // Notificar a janela principal
                        if (window.opener) {
                            window.opener.postMessage({ type: 'meli_connected', success: true }, '*');
                        }
                        // Tentar fechar automaticamente após 3 segundos
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
            </html>
        `);
        
    } catch (error) {
        console.error('[MeliAuth] Erro no callback:', error);
        res.status(500).send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h1 style="color: red;">❌ Erro ao conectar</h1>
                    <p>${error.message}</p>
                    <button onclick="window.close()">Fechar</button>
                </body>
            </html>
        `);
    }
});

// Verificar status da conexão
router.get('/status', async (req, res) => {
    try {
        const token = await meliAuthService.getValidToken();
        
        if (token) {
            res.json({ 
                connected: true, 
                message: 'Conectado ao Mercado Livre'
            });
        } else {
            res.json({ 
                connected: false, 
                message: 'Não conectado ao Mercado Livre' 
            });
        }
    } catch (error) {
        res.status(500).json({ connected: false, error: error.message });
    }
});

// 🆕 ROTA PARA SINCRONIZAR PEDIDOS
router.post('/sync-orders', async (req, res) => {
    const { dias = 30 } = req.body;
    
    // Configurar SSE (Server-Sent Events) para progresso
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    let cancelled = false;
    
    // Detectar quando o cliente cancelar
    req.on('close', () => {
        cancelled = true;
        console.log('[MeliOrders] Cliente cancelou a requisição');
    });
    
    try {
        // Criar controller para cancelamento
        const controller = new AbortController();
        
        // Enviar evento de início
        res.write(`data: ${JSON.stringify({ type: 'start', message: 'Iniciando sincronização...', dias })}\n\n`);
        
        // Executar sincronização
        const result = await meliOrdersService.syncOrders(dias, controller.signal);
        
        if (!cancelled) {
            res.write(`data: ${JSON.stringify({ type: 'done', ...result })}\n\n`);
            res.end();
        }
    } catch (error) {
        if (!cancelled) {
            if (error.message === 'Sync cancelled') {
                res.write(`data: ${JSON.stringify({ type: 'cancelled', message: 'Sincronização cancelada' })}\n\n`);
            } else {
                console.error('[MeliOrders] Erro na sincronização:', error);
                res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
            }
            res.end();
        }
    }
});

// Desconectar (revogar token)
router.post('/disconnect', async (req, res) => {
    try {
        await db.query('DELETE FROM meli_tokens');
        res.json({ success: true, message: 'Desconectado com sucesso' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;