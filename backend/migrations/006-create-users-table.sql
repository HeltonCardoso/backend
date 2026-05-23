-- ================================================================
-- 006-create-users-table.sql
-- Cria a tabela de usuários para autenticação
-- ================================================================

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    perfil_id INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_is_active ON usuarios(is_active);

-- Comentários nas colunas
COMMENT ON TABLE usuarios IS 'Tabela de usuários do sistema';
COMMENT ON COLUMN usuarios.id IS 'Identificador único do usuário';
COMMENT ON COLUMN usuarios.username IS 'Nome de usuário para login';
COMMENT ON COLUMN usuarios.email IS 'E-mail do usuário';
COMMENT ON COLUMN usuarios.password_hash IS 'Hash da senha (formato pbkdf2:sha256)';
COMMENT ON COLUMN usuarios.perfil_id IS 'ID do perfil de acesso (reservado para futuro)';
COMMENT ON COLUMN usuarios.is_active IS 'Indica se o usuário está ativo';
COMMENT ON COLUMN usuarios.created_at IS 'Data de criação do registro';
COMMENT ON COLUMN usuarios.last_login IS 'Data do último login';
COMMENT ON COLUMN usuarios.updated_at IS 'Data da última atualização';

-- Inserir usuário padrão (master)
-- Senha: master123
INSERT INTO usuarios (username, email, password_hash, is_active, created_at, updated_at)
SELECT 'master', 'master@sistema.com', 'pbkdf2:sha256:1000000$BLPnhW7QDXlivESX$ab48abd8c2c1b09df2b9b43efc7ec24f049bac1bee19bca4c640aa0fa363b85d', true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE username = 'master');

-- Trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_usuarios_updated_at ON usuarios;
CREATE TRIGGER update_usuarios_updated_at
    BEFORE UPDATE ON usuarios
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();