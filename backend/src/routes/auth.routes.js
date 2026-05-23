// backend/src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const authService = require('../services/auth.service');
const rateLimit = require('express-rate-limit');

// Limitar tentativas de login (evitar bruteforce)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // 5 tentativas
    message: { success: false, message: 'Muitas tentativas. Tente novamente em 15 minutos.' }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Usuário e senha são obrigatórios' 
        });
    }

    const result = await authService.login(username, password);
    
    if (result.success) {
        res.json(result);
    } else {
        res.status(401).json(result);
    }
});

// POST /api/auth/register (opcional - criar novo usuário)
router.post('/register', async (req, res) => {
    const { username, email, password, perfil_id } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Usuário, email e senha são obrigatórios' 
        });
    }

    const result = await authService.createUser(username, email, password, perfil_id);
    
    if (result.success) {
        res.status(201).json(result);
    } else {
        res.status(400).json(result);
    }
});

// GET /api/auth/verify - verificar se token é válido
router.get('/verify', authService.authenticate, (req, res) => {
    res.json({ success: true, user: req.user });
});

// POST /api/auth/logout (apenas para remover token no frontend)
router.post('/logout', (req, res) => {
    res.json({ success: true, message: 'Logout realizado com sucesso' });
});

module.exports = router;