// frontend/src/components/Login.jsx
import React, { useState } from 'react';
import './Login.css';

function Login({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError]       = useState('');
    const [loading, setLoading]   = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.success) {
                localStorage.setItem('token', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                onLogin(data.user);
            } else {
                setError(data.message || 'Usuário ou senha inválidos');
            }
        } catch {
            setError('Erro ao conectar com o servidor');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-container">

            {/* ── LEFT — branding ── */}
            <div className="login-left">
                <div className="login-left-grid" />

                <div className="login-brand">
                    <div className="login-brand-logo">
                        <div className="brand-icon">M</div>
                        <span className="brand-name">Monitor<span>360</span></span>
                    </div>

                    <h2 className="login-headline">
                        Monitoramento<br />
                        do <em>Fluxo</em><br />
                        de pedidos.
                    </h2>

                    <p className="login-desc">
                        Monitore em tempo real o fluxo de pedidos entre
                        Marketplaces, Anymarket, JET e Onclick. Detecte anomalias antes
                        que virem problemas.
                    </p>

                    {/* Pipeline visual */}
                    <div className="login-pipeline">
                        {[
                            { label: 'Anymarket', color: '#3b82f6' },
                            { label: 'JET',       color: '#06b6d4' },
                            { label: 'Onclick',   color: '#f59e0b' },
                            { label: 'Retorno',   color: '#10b981' },
                        ].map((step, i, arr) => (
                            <React.Fragment key={step.label}>
                                <div className="pipe-step">
                                    <div className="pipe-dot" style={{ background: step.color }} />
                                    <div className="pipe-label">{step.label}</div>
                                </div>
                                {i < arr.length - 1 && <div className="pipe-arrow">→</div>}
                            </React.Fragment>
                        ))}
                    </div>
                </div>

                {/* Stats */}
                <div className="login-stats">
                    <div className="login-stat">
                        <span className="stat-num">24/7</span>
                        <span className="stat-label">Monitoramento</span>
                    </div>
                    <div className="login-stat">
                        <span className="stat-num">60s</span>
                        <span className="stat-label">Auto-refresh</span>
                    </div>
                    <div className="login-stat">
                        <span className="stat-num">5+</span>
                        <span className="stat-label">Marketplaces</span>
                    </div>
                </div>
            </div>

            {/* ── RIGHT — form ── */}
            <div className="login-right">
                <div className="login-form-wrap">
                    <div className="login-form-header">
                        <h1 className="login-form-title">Bem-vindo de volta</h1>
                        <p className="login-form-sub">Entre com suas credenciais para acessar o painel</p>
                    </div>

                    <form onSubmit={handleSubmit} className="login-form">
                        <div className="input-group">
                            <label>Usuário ou E-mail</label>
                            <div className="input-wrap">
                                <span className="input-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                        <circle cx="12" cy="7" r="4"/>
                                    </svg>
                                </span>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="seu usuário ou email"
                                    required
                                    autoFocus
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        <div className="input-group">
                            <label>Senha</label>
                            <div className="input-wrap">
                                <span className="input-icon">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                    </svg>
                                </span>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    autoComplete="current-password"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="login-error">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                {error}
                            </div>
                        )}

                        <button type="submit" disabled={loading} className="login-btn">
                            {loading ? (
                                <>
                                    <span className="btn-spinner" />
                                    Entrando...
                                </>
                            ) : (
                                <>
                                    Acessar painel
                                    <svg className="login-btn-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <line x1="5" y1="12" x2="19" y2="12"/>
                                        <polyline points="12 5 19 12 12 19"/>
                                    </svg>
                                </>
                            )}
                        </button>
                    </form>

                    <div className="login-footer-note">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        Acesso restrito a usuários autorizados
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Login;