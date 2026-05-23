// backend/migrations/run.js
require('dotenv').config({ path: '../../../.env' }); // Sobe 2 pastas até a raiz

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

console.log('📋 Configuração do Banco:');
console.log('  Host:', process.env.DB_HOST || '❌');
console.log('  Database:', process.env.DB_NAME || '❌');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const runMigrations = async () => {
  try {
    console.log('🔄 Iniciando migrations...');
    
    // Testar conexão
    await pool.query('SELECT NOW()');
    console.log('✅ Conexão com banco estabelecida');
    
    // Garante tabela de controle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations_executadas (
        id SERIAL PRIMARY KEY,
        arquivo VARCHAR(255) UNIQUE NOT NULL,
        executado_em TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Lê arquivos .sql da mesma pasta
    const migrationDir = __dirname;
    const arquivos = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`📋 Encontrados ${arquivos.length} arquivos de migration`);
    
    for (const arquivo of arquivos) {
      // Verifica se já executou
      const { rows } = await pool.query(
        'SELECT id FROM migrations_executadas WHERE arquivo = $1',
        [arquivo]
      );
      
      if (rows.length > 0) {
        console.log(`⏭️  ${arquivo} já executado, pulando...`);
        continue;
      }
      
      console.log(`▶️  Executando ${arquivo}...`);
      const sql = fs.readFileSync(path.join(migrationDir, arquivo), 'utf8');
      
      try {
        await pool.query(sql);
        await pool.query(
          'INSERT INTO migrations_executadas (arquivo) VALUES ($1)',
          [arquivo]
        );
        console.log(`✅ ${arquivo} concluído`);
      } catch (error) {
        console.error(`❌ Erro em ${arquivo}:`, error.message);
      }
    }
    
    console.log('🎉 Todas as migrations concluídas!');
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Erro fatal:', error.message);
    if (error.message.includes('does not exist')) {
      console.error('   Verifique se o banco de dados existe e as credenciais estão corretas');
    }
    process.exit(1);
  }
};

runMigrations();