// frontend/src/components/MercadoLivreConnection.jsx
import React, { useState, useEffect } from 'react';

function MercadoLivreConnection() {
    const [isConnected, setIsConnected] = useState(false);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [connectionInfo, setConnectionInfo] = useState(null);
    const [syncProgress, setSyncProgress] = useState(null);
    
    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
    
    // Verificar status da conexão
    const checkConnection = async () => {
        try {
            const response = await fetch(`${API_URL}/meli/status`);
            const data = await response.json();
            setIsConnected(data.connected);
            if (data.connected) {
                setConnectionInfo(data);
            }
        } catch (error) {
            console.error('Erro ao verificar conexão:', error);
        }
    };
    
    useEffect(() => {
        checkConnection();
        
        // Ouvir mensagem da janela popup
        window.addEventListener('message', (event) => {
            if (event.data?.type === 'meli_connected') {
                checkConnection();
            }
        });
        
        return () => {
            window.removeEventListener('message', () => {});
        };
    }, []);
    
    // Iniciar conexão OAuth
    const connectMercadoLivre = () => {
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        const authWindow = window.open(
            `${API_URL}/meli/auth`,
            'MercadoLivreAuth',
            `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Verificar quando a janela fechar
        const timer = setInterval(() => {
            if (authWindow.closed) {
                clearInterval(timer);
                checkConnection(); // Recarregar status
            }
        }, 500);
    };
    
    // Desconectar
    const disconnect = async () => {
        if (!confirm('Tem certeza que deseja desconectar sua conta do Mercado Livre?')) return;
        
        setLoading(true);
        try {
            const response = await fetch(`${API_URL}/meli/disconnect`, {
                method: 'POST'
            });
            const data = await response.json();
            
            if (data.success) {
                setIsConnected(false);
                setConnectionInfo(null);
                alert('✅ Desconectado com sucesso!');
            }
        } catch (error) {
            console.error('Erro ao desconectar:', error);
            alert('❌ Erro ao desconectar');
        } finally {
            setLoading(false);
        }
    };
    
    // Sincronizar pedidos
    const syncOrders = async () => {
        setSyncing(true);
        setSyncProgress({ status: 'iniciando', percent: 0 });
        
        try {
            const response = await fetch(`${API_URL}/meli/sync-orders`, {
                method: 'POST'
            });
            
            // Se for streaming de progresso
            const reader = response.body?.getReader();
            if (reader) {
                const decoder = new TextDecoder();
                let buffer = '';
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.type === 'progress') {
                                    setSyncProgress({
                                        status: 'processando',
                                        percent: data.percent,
                                        processed: data.processed,
                                        total: data.total
                                    });
                                }
                                if (data.type === 'done') {
                                    setSyncProgress(null);
                                    alert(`✅ Sincronização concluída! ${data.total} pedidos importados.`);
                                }
                            } catch (e) {}
                        }
                    }
                }
            } else {
                const data = await response.json();
                if (data.success) {
                    alert(`✅ ${data.total} pedidos sincronizados com sucesso!`);
                } else {
                    alert(`❌ Erro na sincronização: ${data.error}`);
                }
            }
        } catch (error) {
            console.error('Erro ao sincronizar:', error);
            alert('❌ Erro ao sincronizar pedidos');
        } finally {
            setSyncing(false);
            setSyncProgress(null);
        }
    };
    
    return (
        <div className="meli-connection">
            <div className="connection-header">
                <div className="meli-logo">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="#FFE600"/>
                    </svg>
                </div>
                <h2>Integração com Mercado Livre</h2>
                <p>Conecte sua conta para importar pedidos automaticamente</p>
            </div>
            
            {!isConnected ? (
                <div className="connection-card not-connected">
                    <div className="benefits">
                        <h3>Benefícios da integração:</h3>
                        <ul>
                            <li>📦 Importe pedidos automaticamente</li>
                            <li>🔄 Sincronize status de entrega</li>
                            <li>📊 Analise vendas por canal</li>
                            <li>🏷️ Gerencie estoque em tempo real</li>
                        </ul>
                    </div>
                    
                    <button 
                        className="connect-btn"
                        onClick={connectMercadoLivre}
                        disabled={loading}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 2L15 8M3 12h15M12 21l6-6M3 3l4 4"/>
                        </svg>
                        Conectar minha conta do Mercado Livre
                    </button>
                    
                    <p className="help-text">
                        Você será redirecionado para o site do Mercado Livre para autorizar o acesso.
                    </p>
                </div>
            ) : (
                <div className="connection-card connected">
                    <div className="connection-status">
                        <span className="status-badge success">✅ Conectado</span>
                        <span className="status-text">Sua conta está conectada</span>
                    </div>
                    
                    {connectionInfo && (
                        <div className="connection-info">
                            <div className="info-row">
                                <span className="info-label">Status do token:</span>
                                <span className="info-value">Válido</span>
                            </div>
                            {connectionInfo.expires_at && (
                                <div className="info-row">
                                    <span className="info-label">Expira em:</span>
                                    <span className="info-value">
                                        {new Date(connectionInfo.expires_at).toLocaleString()}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}
                    
                    <div className="connection-actions">
                        <button 
                            className="sync-btn"
                            onClick={syncOrders}
                            disabled={syncing}
                        >
                            {syncing ? (
                                <>
                                    <span className="spinner" />
                                    {syncProgress?.percent ? `${syncProgress.percent}%` : 'Sincronizando...'}
                                </>
                            ) : (
                                '🔄 Sincronizar Pedidos Agora'
                            )}
                        </button>
                        
                        <button 
                            className="disconnect-btn"
                            onClick={disconnect}
                            disabled={loading}
                        >
                            Desconectar conta
                        </button>
                    </div>
                    
                    {syncProgress && syncProgress.processed && (
                        <div className="sync-progress">
                            <div className="progress-bar">
                                <div 
                                    className="progress-fill" 
                                    style={{ width: `${syncProgress.percent}%` }}
                                />
                            </div>
                            <span>{syncProgress.processed} de {syncProgress.total} pedidos processados</span>
                        </div>
                    )}
                </div>
            )}
            
            <style>{`
                .meli-connection {
                    background: var(--surface);
                    border-radius: 16px;
                    padding: 32px;
                    margin: 20px;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                }
                
                .connection-header {
                    text-align: center;
                    margin-bottom: 32px;
                }
                
                .meli-logo {
                    display: inline-block;
                    margin-bottom: 16px;
                }
                
                .connection-header h2 {
                    margin: 0 0 8px 0;
                    color: var(--text);
                }
                
                .connection-header p {
                    margin: 0;
                    color: var(--text-muted);
                }
                
                .connection-card {
                    border-radius: 12px;
                    padding: 32px;
                }
                
                .connection-card.not-connected {
                    background: linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%);
                    text-align: center;
                }
                
                .connection-card.connected {
                    background: #ecfdf5;
                    border: 1px solid #10b981;
                }
                
                .benefits {
                    text-align: left;
                    max-width: 400px;
                    margin: 0 auto 32px auto;
                }
                
                .benefits h3 {
                    margin-bottom: 16px;
                    color: #333;
                }
                
                .benefits ul {
                    list-style: none;
                    padding: 0;
                }
                
                .benefits li {
                    padding: 8px 0;
                    font-size: 16px;
                }
                
                .connect-btn {
                    background: linear-gradient(135deg, #ffe600 0%, #ffc107 100%);
                    color: #333;
                    border: none;
                    padding: 14px 32px;
                    border-radius: 40px;
                    font-weight: bold;
                    font-size: 16px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    transition: transform 0.2s;
                }
                
                .connect-btn:hover {
                    transform: scale(1.02);
                }
                
                .help-text {
                    margin-top: 24px;
                    font-size: 12px;
                    color: #666;
                }
                
                .connection-status {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    margin-bottom: 24px;
                }
                
                .status-badge {
                    display: inline-block;
                    padding: 6px 16px;
                    border-radius: 20px;
                    font-size: 14px;
                    font-weight: 500;
                }
                
                .status-badge.success {
                    background: #d1fae5;
                    color: #065f46;
                }
                
                .connection-info {
                    background: white;
                    border-radius: 8px;
                    padding: 16px;
                    margin-bottom: 24px;
                }
                
                .info-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 8px 0;
                }
                
                .info-label {
                    font-weight: 500;
                    color: #666;
                }
                
                .info-value {
                    color: #333;
                    font-family: monospace;
                }
                
                .connection-actions {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                
                .sync-btn {
                    background: #3b82f6;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    flex: 1;
                    justify-content: center;
                }
                
                .sync-btn:hover:not(:disabled) {
                    background: #2563eb;
                }
                
                .disconnect-btn {
                    background: #ef4444;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    cursor: pointer;
                    font-weight: 500;
                }
                
                .disconnect-btn:hover:not(:disabled) {
                    background: #dc2626;
                }
                
                button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                
                .spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid white;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    display: inline-block;
                }
                
                .sync-progress {
                    margin-top: 20px;
                }
                
                .progress-bar {
                    height: 6px;
                    background: #e5e7eb;
                    border-radius: 3px;
                    overflow: hidden;
                    margin-bottom: 8px;
                }
                
                .progress-fill {
                    height: 100%;
                    background: #3b82f6;
                    border-radius: 3px;
                    transition: width 0.3s;
                }
                
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

export default MercadoLivreConnection;