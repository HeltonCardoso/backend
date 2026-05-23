// backend/config/database.js
const { Pool } = require('pg');

// Carrega .env da raiz
require('dotenv').config({ path: '../.env' });

console.log('\n📋 Configuração do Banco:');
console.log('  Host:', process.env.DB_HOST || '❌');
console.log('  Database:', process.env.DB_NAME || '❌');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false  // ← ESSA É A LINHA QUE FALTAVA
  },
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  keepAlive: true,
});

// Testar conexão
pool.connect((err, client, release) => {
  if (err) {
    console.error('\n❌ Erro ao conectar no PostgreSQL:');
    console.error('   ', err.message);
  } else {
    console.log('\n✅ Conectado ao PostgreSQL com sucesso!');
    release();
  }
});

pool.on('error', (err) => {
  console.error('Erro no pool:', err.message);
});

module.exports = pool;