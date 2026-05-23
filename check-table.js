// check-tables.js
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

client.connect();

client.query(`
  SELECT column_name, data_type, is_nullable 
  FROM information_schema.columns 
  WHERE table_name = 'tracking_events' 
  ORDER BY ordinal_position
`, (err, res) => {
  if (err) {
    console.error('Erro:', err.message);
  } else {
    console.log('📋 Estrutura da tabela tracking_events:');
    res.rows.forEach(row => {
      console.log(`   ${row.column_name}: ${row.data_type} ${row.is_nullable === 'YES' ? '(nullable)' : '(NOT NULL)'}`);
    });
  }
  client.end();
});