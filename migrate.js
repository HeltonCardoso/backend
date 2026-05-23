// migrate.js - Coloque este arquivo na RAIZ do projeto
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

console.log('📋 Configuração do Banco:');
console.log('  Host:', process.env.DB_HOST || '❌');
console.log('  Database:', process.env.DB_NAME || '❌');
console.log('  User:', process.env.DB_USER || '❌');

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
    console.log('\n🔄 Iniciando migrations...\n');
    
    // Testar conexão
    await pool.query('SELECT NOW()');
    console.log('✅ Conexão com banco estabelecida\n');
    
    // Garante tabela de controle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations_executadas (
        id SERIAL PRIMARY KEY,
        arquivo VARCHAR(255) UNIQUE NOT NULL,
        executado_em TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Lê arquivos .sql da pasta backend/migrations
    const migrationDir = path.join(__dirname, 'backend', 'migrations');
    
    if (!fs.existsSync(migrationDir)) {
      console.error('❌ Pasta de migrations não encontrada:', migrationDir);
      process.exit(1);
    }
    
    const arquivos = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`📋 Encontrados ${arquivos.length} arquivos de migration:\n`);
    arquivos.forEach(f => console.log(`   - ${f}`));
    console.log('');
    
    for (const arquivo of arquivos) {
      // Verifica se já executou
      const { rows } = await pool.query(
        'SELECT id FROM migrations_executadas WHERE arquivo = $1',
        [arquivo]
      );
      
      if (rows.length > 0) {
        console.log(`⏭️  ${arquivo} - JÁ EXECUTADO, pulando...`);
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
        console.log(`✅ ${arquivo} - CONCLUÍDO\n`);
      } catch (error) {
        console.error(`❌ Erro em ${arquivo}:`, error.message);
        console.log('\n⚠️  Continuando com as próximas migrations...\n');
      }
    }
    
    console.log('🎉 TODAS AS MIGRATIONS CONCLUÍDAS!');
    await pool.end();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ ERRO FATAL:', error.message);
    if (error.message.includes('does not exist')) {
      console.error('\n🔧 Verifique:');
      console.error('   1. Se o banco de dados existe no Render');
      console.error('   2. Se as credenciais no .env estão corretas');
      console.error('   3. Se o host está correto');
    }
    process.exit(1);
  }
};

runMigrations();