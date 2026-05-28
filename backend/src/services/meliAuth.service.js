// backend/src/services/meliAuth.service.js
const axios = require('axios');
const db = require('../../config/database');

class MeliAuthService {
    
    // Gerar URL de autorização
    getAuthUrl() {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: process.env.MELI_APP_ID,
            redirect_uri: process.env.MELI_REDIRECT_URI,
            state: this.generateState() // Para segurança
        });
        
        return `${process.env.MELI_AUTH_URL}/authorization?${params.toString()}`;
    }
    
    // Gerar state para proteção CSRF
    generateState() {
        const state = Math.random().toString(36).substring(2, 15);
        // Salvar em sessão/cache para validar depois
        return state;
    }
    
    // Trocar código por token
    async exchangeCodeForToken(code) {
        try {
            const response = await axios.post(`${process.env.MELI_API_URL}/oauth/token`, {
                grant_type: 'authorization_code',
                client_id: process.env.MELI_APP_ID,
                client_secret: process.env.MELI_CLIENT_SECRET,
                code: code,
                redirect_uri: process.env.MELI_REDIRECT_URI
            });
            
            const tokenData = response.data;
            
            // Calcular data de expiração
            const expiresAt = new Date();
            expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);
            
            return {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in,
                token_type: tokenData.token_type,
                scope: tokenData.scope,
                user_id: tokenData.user_id,
                expires_at: expiresAt
            };
            
        } catch (error) {
            console.error('[MeliAuth] Erro ao trocar código por token:', error.response?.data || error.message);
            throw error;
        }
    }
    
    // Renovar token (refresh)
    async refreshAccessToken(refreshToken) {
        try {
            const response = await axios.post(`${process.env.MELI_API_URL}/oauth/token`, {
                grant_type: 'refresh_token',
                client_id: process.env.MELI_APP_ID,
                client_secret: process.env.MELI_CLIENT_SECRET,
                refresh_token: refreshToken
            });
            
            const tokenData = response.data;
            const expiresAt = new Date();
            expiresAt.setSeconds(expiresAt.getSeconds() + tokenData.expires_in);
            
            return {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token || refreshToken,
                expires_in: tokenData.expires_in,
                expires_at: expiresAt
            };
            
        } catch (error) {
            console.error('[MeliAuth] Erro ao renovar token:', error.response?.data || error.message);
            throw error;
        }
    }
    
    // Salvar token no banco
    async saveToken(tokenData) {
        // Verificar se já existe token para este usuário
        const existing = await db.query(
            'SELECT id FROM meli_tokens WHERE user_id = $1',
            [tokenData.user_id]
        );
        
        if (existing.rows.length > 0) {
            // Atualizar token existente
            await db.query(`
                UPDATE meli_tokens 
                SET access_token = $1,
                    refresh_token = $2,
                    expires_in = $3,
                    token_type = $4,
                    scope = $5,
                    expires_at = $6,
                    updated_at = NOW()
                WHERE user_id = $7
            `, [
                tokenData.access_token,
                tokenData.refresh_token,
                tokenData.expires_in,
                tokenData.token_type,
                tokenData.scope,
                tokenData.expires_at,
                tokenData.user_id
            ]);
        } else {
            // Inserir novo token
            await db.query(`
                INSERT INTO meli_tokens (user_id, access_token, refresh_token, expires_in, token_type, scope, expires_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                tokenData.user_id,
                tokenData.access_token,
                tokenData.refresh_token,
                tokenData.expires_in,
                tokenData.token_type,
                tokenData.scope,
                tokenData.expires_at
            ]);
        }
        
        return { success: true, user_id: tokenData.user_id };
    }
    
    // Buscar token ativo
    async getValidToken(userId = null) {
        let query = `
            SELECT * FROM meli_tokens 
            WHERE expires_at > NOW()
        `;
        const params = [];
        
        if (userId) {
            query += ` AND user_id = $1`;
            params.push(userId);
        }
        
        query += ` ORDER BY created_at DESC LIMIT 1`;
        
        const result = await db.query(query, params);
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const token = result.rows[0];
        
        // Verificar se token está prestes a expirar (menos de 1 hora)
        const expiresAt = new Date(token.expires_at);
        const now = new Date();
        const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);
        
        if (hoursUntilExpiry < 1) {
            // Renovar token
            const newToken = await this.refreshAccessToken(token.refresh_token);
            await this.saveToken({
                ...newToken,
                user_id: token.user_id,
                token_type: token.token_type,
                scope: token.scope
            });
            return newToken.access_token;
        }
        
        return token.access_token;
    }
    
    // Buscar informações do usuário
    async getUserInfo(accessToken) {
        try {
            const response = await axios.get(`${process.env.MELI_API_URL}/users/me`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            return response.data;
        } catch (error) {
            console.error('[MeliAuth] Erro ao buscar usuário:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new MeliAuthService();