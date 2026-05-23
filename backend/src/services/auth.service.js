// backend/src/services/auth.service.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'seu-segredo-super-seguro-aqui-mude-no-producao';
const JWT_EXPIRES_IN = '24h';

function verifyPbkdf2Password(password, hashedPassword) {
    try {
        // Formato: pbkdf2:sha256:1000000$BLPnhW7QDXlivESX$ab48abd8c2c1b09df2b9b43efc7ec24f049bac1bee19bca4c640aa0fa363b85d
        const parts = hashedPassword.split('$');
        
        if (parts.length < 3) {
            console.error('Formato de hash inválido');
            return false;
        }
        
        const firstPart = parts[0].split(':');
        const iterations = parseInt(firstPart[2]);
        const salt = parts[1];
        const expectedHash = parts[2];
        
        const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
        const derivedHash = derivedKey.toString('hex');
        
        return derivedHash === expectedHash;
    } catch (error) {
        console.error('Erro ao verificar senha:', error);
        return false;
    }
}

class AuthService {
    async login(username, password) {
        try {
            const result = await db.query(
                `SELECT id, username, email, password_hash, perfil_id, is_active 
                 FROM usuarios 
                 WHERE (username = $1 OR email = $1) AND is_active = true`,
                [username]
            );

            if (result.rows.length === 0) {
                return { success: false, message: 'Usuário não encontrado ou inativo' };
            }

            const user = result.rows[0];
            
            console.log('Verificando senha para usuário:', user.username);
            const validPassword = verifyPbkdf2Password(password, user.password_hash);
            
            if (!validPassword) {
                console.log('Senha inválida');
                return { success: false, message: 'Senha incorreta' };
            }

            console.log('Senha válida! Gerando token...');

            await db.query(
                `UPDATE usuarios SET last_login = NOW() WHERE id = $1`,
                [user.id]
            );

            const token = jwt.sign(
                { 
                    id: user.id, 
                    username: user.username, 
                    email: user.email,
                    perfil_id: user.perfil_id 
                },
                JWT_SECRET,
                { expiresIn: JWT_EXPIRES_IN }
            );

            return {
                success: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    perfil_id: user.perfil_id
                }
            };
        } catch (error) {
            console.error('Erro no login:', error);
            return { success: false, message: 'Erro interno no servidor' };
        }
    }

    verifyToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            return { valid: true, decoded };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }

    authenticate(req, res, next) {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Token não fornecido' });
        }

        const token = authHeader.split(' ')[1];
        const result = this.verifyToken(token);

        if (!result.valid) {
            return res.status(401).json({ success: false, message: 'Token inválido ou expirado' });
        }

        req.user = result.decoded;
        next();
    }
}

module.exports = new AuthService();