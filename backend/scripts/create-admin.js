// backend/scripts/create-admin.js
require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const client = new Client({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function createAdmin() {
    try {
        await client.connect();
        
        const username = 'admin';
        const email = 'admin@empresa.com';
        const password = 'admin123'; // Trocar depois
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        
        // Verificar se já existe
        const existing = await client.query(
            'SELECT id FROM usuarios WHERE username = $1 OR email = $2',
            [username, email]
        );
        
        if (existing.rows.length > 0) {
            console.log('Usuário admin já existe');
            await client.end();
            return;
        }
        
        await client.query(`
            INSERT INTO usuarios (username, email, password_hash, perfil_id, is_active, created_at, updated_at)
            VALUES ($1, $2, $3, $4, true, NOW(), NOW())
        `, [username, email, password_hash, 1]);
        
        console.log('✅ Usuário admin criado com sucesso!');
        console.log('   Username: admin');
        console.log('   Senha: admin123');
        console.log('   ⚠️  Troque a senha no primeiro acesso!');
        
        await client.end();
    } catch (error) {
        console.error('Erro:', error.message);
        await client.end();
    }
}

createAdmin();