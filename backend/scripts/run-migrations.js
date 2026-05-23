// backend/scripts/run-migrations.js
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');

async function runMigrations() {
  try {
    console.log('🔄 Iniciando migrações no banco existente...');
    
    // Garante tabela de controle
    await pool.query(`
      CREATE TABLE IF NOT EXISTS migrations_executadas (
        id SERIAL PRIMARY KEY,
        arquivo VARCHAR(255) UNIQUE NOT NULL,
        executado_em TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Pega arquivos de migration na ordem
    const migrationDir = path.join(__dirname, '../migrations');
    const files = fs.readdirSync(migrationDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    for (const file of files) {
      // Verifica se já rodou
      const check = await pool.query(
        'SELECT id FROM migrations_executadas WHERE arquivo = $1',
        [file]
      );
      
      if (check.rows.length > 0) {
        console.log(`⏭️  ${file} já executado`);
        continue;
      }
      
      console.log(`▶️  Executando ${file}...`);
      const sql = fs.readFileSync(path.join(migrationDir, file), 'utf8');
      await pool.query(sql);
      
      await pool.query(
        'INSERT INTO migrations_executadas (arquivo) VALUES ($1)',
        [file]
      );
      
      console.log(`✅ ${file} concluído`);
    }
    
    console.log('🎉 Migrações concluídas!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

runMigrations();