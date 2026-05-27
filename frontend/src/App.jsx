// frontend/src/App.jsx
import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import Login from './components/Login';
import UploadPlanilha from './components/UploadPlanilha';

const AUTO_REFRESH_SECONDS = 600;

// ═══════════════════════════════════════
// SKELETON COMPONENTS
// ═══════════════════════════════════════

const SkeletonKpi = () => (
  <div className="kpi-card-skeleton">
    <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 'var(--radius-sm)', flexShrink: 0 }} />
    <div className="kpi-content">
      <div className="skeleton" style={{ height: 28, width: '55%', marginBottom: 7 }} />
      <div className="skeleton" style={{ height: 13, width: '75%' }} />
    </div>
    <div className="skeleton" style={{ height: 22, width: 38, borderRadius: 20 }} />
  </div>
);

const SkeletonPipeline = () => (
  <div className="pipeline-flow">
    {[60, 40, 80, 30, 55].map((h, i) => (
      <React.Fragment key={i}>
        <div className="pipeline-stage-skeleton">
          <div className="skeleton" style={{ width: 22, height: 22, borderRadius: '50%' }} />
          <div className="skeleton" style={{ width: 50, height: 30, margin: '4px 0', borderRadius: 4 }} />
          <div className="skeleton" style={{ width: '70%', height: 11 }} />
          <div className="skeleton" style={{ width: '100%', height: 3, marginTop: 4, borderRadius: 2 }} />
        </div>
        {i < 4 && <div className="pipeline-arrow">→</div>}
      </React.Fragment>
    ))}
  </div>
);

const SkeletonMarketplaceList = () => (
  <div className="panel-skeleton-list">
    {[85, 60, 45, 70, 30].map((w, i) => (
      <div key={i} className="panel-skeleton-row">
        <div className="skeleton" style={{ width: 100, height: 13 }} />
        <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3 }}>
          <div className="skeleton" style={{ width: `${w}%`, height: '100%', borderRadius: 3 }} />
        </div>
        <div className="skeleton" style={{ width: 24, height: 13 }} />
      </div>
    ))}
  </div>
);

const SkeletonStatusPlatforms = () => (
  <div className="panel-skeleton-list">
    {[1, 2, 3].map(p => (
      <div key={p}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 8, marginBottom: 6, borderBottom: '1px solid var(--border)' }}>
          <div className="skeleton" style={{ width: 7, height: 7, borderRadius: '50%' }} />
          <div className="skeleton" style={{ width: 70, height: 11 }} />
        </div>
        {[1, 2, 3].map(s => (
          <div key={s} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <div className="skeleton" style={{ width: 110, height: 12 }} />
            <div className="skeleton" style={{ width: 24, height: 12 }} />
          </div>
        ))}
      </div>
    ))}
  </div>
);

const SkeletonVolumeChart = () => {
  const heights = [20, 45, 30, 60, 80, 55, 70, 40, 65, 50, 35, 75, 55, 45, 60, 80, 70, 55, 40, 65, 50, 35, 25, 45];
  return (
    <div className="volume-chart-skeleton">
      {heights.map((h, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
          <div className="skeleton volume-bar-skeleton" style={{ height: `${h}%` }} />
          <div className="skeleton" style={{ width: '70%', height: 9 }} />
        </div>
      ))}
    </div>
  );
};

const SkeletonTableRow = () => (
  <tr className="skeleton-row">
    {[90, 75, 80, 100, 95, 100, 85, 55, 65].map((w, i) => (
      <td key={i}><div className="skeleton" style={{ height: 14, width: w }} /></td>
    ))}
  </tr>
);

const SkeletonPipelineSummaryBar = () => (
  <div className="psb-skeleton">
    {[50, 80, 90, 65].map((w, i) => (
      <React.Fragment key={i}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '6px 14px' }}>
          <div className="skeleton" style={{ width: 36, height: 22, borderRadius: 4 }} />
          <div className="skeleton" style={{ width: w, height: 11 }} />
        </div>
        {i < 3 && <div style={{ width: 1, height: 14, background: 'var(--border)' }} />}
      </React.Fragment>
    ))}
  </div>
);

const SkeletonAnomaliaCard = () => (
  <div className="anomalia-card-skeleton">
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="skeleton" style={{ width: 110, height: 13 }} />
      <div className="skeleton" style={{ width: 60, height: 18, borderRadius: 20 }} />
    </div>
    <div className="skeleton" style={{ height: 13, width: '85%' }} />
    <div className="skeleton" style={{ height: 13, width: '60%' }} />
    <div style={{ display: 'flex', gap: 6 }}>
      <div className="skeleton" style={{ width: 70, height: 20, borderRadius: 20 }} />
      <div className="skeleton" style={{ width: 90, height: 13, marginTop: 3 }} />
    </div>
  </div>
);

// ═══════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════

function App() {
  // ─── Estados de Autenticação ──────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);

  // ─── Temas e Sidebar ──────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === 'true');

  // ─── Loading states ───────────────────────────────
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading]     = useState(true);
  const [anomaliasLoading, setAnomaliasLoading] = useState(true);
  const [graficosLoading, setGraficosLoading]   = useState(true);

  // ─── Dados ────────────────────────────────────────
  const [dashboardData, setDashboardData] = useState({
    metricas: { ANYMARKET: 0, JET: 0, ONCLICK: 0, RETORNO_JET: 0, RETORNO_ANYMARKET: 0 },
    anomaliasNaoResolvidas: 0,
    pedidosTravados: 0,
    porEstagio: {},
    taxaSincronizacaoJet: 0,
    pedidos24h: 0,
    porMarketplace: []
  });

  const [anomalias, setAnomalias] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [pipelineSummary, setPipelineSummary] = useState({ total: 0, foraPrazo: 0, urgentes: 0, semPrazo: 0 });
  const [graficos, setGraficos] = useState({ porStatus: {}, porMarketplace: [], volumeHoras: [] });
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [filters, setFilters] = useState({ marketplace: '', travados: false, search: '', loja: '', sort: '', quickFilter: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [notification, setNotification] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillDays, setBackfillDays] = useState(30);
  const [backfillProgress, setBackfillProgress] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

  // ─── Verificar token salvo ────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
      setIsAuthenticated(true);
      setUser(JSON.parse(savedUser));
    }
  }, []);

  // ─── Theme & sidebar persist ──────────────────────
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  const toggleTheme   = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  const toggleSidebar = () => setSidebarCollapsed(c => !c);

  // ─── Login/Logout ─────────────────────────────────
  const handleLogin = (userData) => {
    setIsAuthenticated(true);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
  };

  // ─── Notification ─────────────────────────────────
  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  }, []);

  // ─── Backfill ─────────────────────────────────────
  const handleBackfill = async () => {
    setBackfillLoading(true);
    setBackfillProgress({ total_found: 0, inserted: 0, updated: 0, status_changes: 0, skipped: 0, percent: 0 });

    try {
      const endDate   = new Date().toISOString().split('T')[0];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - backfillDays);

      const response = await fetch(`${API_URL}/backfill/all`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ dateFrom: startDate.toISOString().split('T')[0], dateTo: endDate })
      });

      const reader  = response.body.getReader();
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

              if (data.type === 'progress' || (data.total_found !== undefined && !data.type)) {
                setBackfillProgress({
                  total_found:    data.total_found || 0,
                  inserted:       data.inserted    || 0,
                  updated:        data.updated     || 0,
                  status_changes: data.status_changes || 0,
                  skipped:        data.skipped     || 0,
                  percent:        data.percent || Math.min(99, Math.floor((data.total_found / 100) * 2)),
                  situationCode:  data.situationCode
                });
              }

              if (data.type === 'done') {
                showNotification(`Backfill de ${backfillDays} dias concluído! ${data.inserted || 0} novos pedidos`);
                setBackfillProgress(null);
                setTimeout(() => { fetchMetricas(); fetchPedidos(); fetchGraficos(); }, 2000);
              }

              if (data.type === 'error') {
                showNotification(`Erro: ${data.message}`, 'error');
                setBackfillProgress(null);
              }
            } catch {}
          }
        }
      }
    } catch (error) {
      showNotification(`Erro no backfill: ${error.message}`, 'error');
      setBackfillProgress(null);
    } finally {
      setBackfillLoading(false);
    }
  };

  // ─── Fetch helpers ────────────────────────────────
  const fetchMetricas = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/dashboard/metricas`);
      const d = await r.json();
      if (d.success) setDashboardData(d.data);
    } catch {}
    finally { setInitialLoading(false); }
  }, [API_URL]);

  const fetchAnomalias = useCallback(async () => {
    setAnomaliasLoading(true);
    try {
      const r = await fetch(`${API_URL}/dashboard/anomalias?limit=10`);
      const d = await r.json();
      if (d.success) setAnomalias(d.anomalias);
    } catch {}
    finally { setAnomaliasLoading(false); }
  }, [API_URL]);

  const fetchPedidos = useCallback(async () => {
    setLoading(true);
    try {
      let url = `${API_URL}/dashboard/pedidos?page=${currentPage}&limit=20`;
      if (filters.marketplace) url += `&marketplace=${encodeURIComponent(filters.marketplace)}`;
      if (filters.travados)    url += `&travados=true`;
      if (filters.loja)        url += `&loja=${encodeURIComponent(filters.loja)}`;
      if (filters.sort)        url += `&sort=${filters.sort}`;
      if (filters.quickFilter) url += `&quickFilter=${filters.quickFilter}`;
      const r = await fetch(url);
      const d = await r.json();
      if (d.success) {
        setPedidos(d.pedidos);
        setTotalPages(d.totalPages);
        if (d.summary) setPipelineSummary(d.summary);
      }
    } catch {}
    finally { setLoading(false); }
  }, [API_URL, currentPage, filters]);

  const fetchGraficos = useCallback(async () => {
    setGraficosLoading(true);
    try {
      const r = await fetch(`${API_URL}/dashboard/graficos`);
      const d = await r.json();
      if (d.success) setGraficos(d);
    } catch {}
    finally { setGraficosLoading(false); }
  }, [API_URL]);

  const handleSyncPrazos = async () => {
    setSyncLoading(true);
    setSyncProgress({ processados: 0, total: 0, percent: 0 });

    try {
      const token    = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/sync/prazos`, {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'start')    setSyncProgress({ processados: 0, total: evt.total, percent: 0 });
            if (evt.type === 'progress') setSyncProgress(evt);
            if (evt.type === 'done') {
              showNotification(`Sync concluído! ${evt.sucesso} prazos preenchidos.`);
              setSyncProgress(null);
              fetchMetricas();
              fetchPedidos();
            }
            if (evt.type === 'error') showNotification(`Erro: ${evt.message}`, 'error');
          } catch {}
        }
      }
    } catch {
      showNotification('Erro ao conectar com o servidor', 'error');
    } finally {
      setSyncLoading(false);
    }
  };

  const fetchPedidoDetalhes = async (pedidoId) => {
    try {
      const r = await fetch(`${API_URL}/dashboard/pedidos/${pedidoId}`);
      const d = await r.json();
      if (d.success) setSelectedOrder(d);
    } catch { showNotification('Erro ao carregar detalhes do pedido', 'error'); }
  };

  const resolverAnomalia = async (anomaliaId) => {
    try {
      const r = await fetch(`${API_URL}/dashboard/anomalias/${anomaliaId}/resolver`, { method: 'PUT' });
      if (r.ok) { showNotification('Anomalia resolvida!'); fetchAnomalias(); fetchMetricas(); }
    } catch { showNotification('Erro ao resolver anomalia', 'error'); }
  };

  const refreshAll = useCallback(() => {
    fetchMetricas(); fetchAnomalias(); fetchPedidos(); fetchGraficos();
    setLastRefresh(new Date());
  }, [fetchMetricas, fetchAnomalias, fetchPedidos, fetchGraficos]);

  // ─── Initial load ─────────────────────────────────
  useEffect(() => { refreshAll(); }, []);
  useEffect(() => { setCurrentPage(1); fetchPedidos(); }, [filters]);
  useEffect(() => { fetchPedidos(); }, [currentPage]);

  // ─── Auto-refresh ─────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => { refreshAll(); }, AUTO_REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [refreshAll]);

  // ─── Keyboard shortcut R para refresh ────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && e.target.tagName !== 'INPUT') refreshAll();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [refreshAll]);

  // ─── Helpers ──────────────────────────────────────
  const formatDate = (d) => d ? new Date(d).toLocaleString('pt-BR') : '—';

  const formatPrazo = (prazoDespacho, horasAtePrazo) => {
    if (!prazoDespacho) return null;
    const atrasado = horasAtePrazo < 0;
    const horas    = Math.abs(horasAtePrazo ?? 0);
    const dias     = Math.floor(horas / 24);
    const h        = Math.floor(horas % 24);
    const label    = dias > 0 ? `${dias}d ${h}h` : `${Math.floor(horas)}h`;
    return { atrasado, label };
  };

  const isPedidoTravado = (pedido) => {
    if (pedido.prazo_despacho) return pedido.horas_ate_prazo < 0;
    return parseFloat(pedido.horas_sem_update || 0) > 1;
  };

  const traduzirOrigem   = (o) => ({ ANYMARKET: 'Anymarket', JET: 'JET', ONCLICK: 'Onclick/ERP', RETORNO_JET: 'Ret. JET', RETORNO_ANYMARKET: 'Ret. Anymarket' })[o] || o;
  const getOrigemColor   = (o) => ({ ANYMARKET: '#3b82f6', JET: '#06b6d4', ONCLICK: '#f59e0b', RETORNO_JET: '#10b981', RETORNO_ANYMARKET: '#8b5cf6' })[o] || '#6b7280';

  const lojasUnicas        = [...new Set(pedidos.map(p => p.loja).filter(Boolean))];
  const marketplacesUnicos = [...new Set(pedidos.map(p => p.marketplace).filter(Boolean))];

  const filteredPedidos = !filters.search ? pedidos : pedidos.filter(p => {
    const q = filters.search.toLowerCase();
    return (
      p.pedido_id?.toLowerCase().includes(q) ||
      p.marketplace?.toLowerCase().includes(q) ||
      p.loja?.toLowerCase().includes(q)
    );
  });

  const navItems = [
    { id: 'overview',  icon: '◈', label: 'Visão Geral' },
    { id: 'pipeline',  icon: '⇉', label: 'Pipeline' },
    { id: 'anomalias', icon: '⚠', label: 'Anomalias', badge: dashboardData.anomaliasNaoResolvidas },
    { id: 'graficos',  icon: '▦', label: 'Gráficos' },
    { id: 'upload',    icon: '📤', label: 'Upload Planilha' },
  ];

  const maxVolume = Math.max(...(graficos.volumeHoras?.map(h => h.total) || [1]), 1);

  // ─── Se NÃO autenticado ───────────────────────────
  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  // ─── Dashboard ────────────────────────────────────
  return (
    <div className="app" data-theme={theme}>
      {/* Sidebar */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${sidebarOpen ? 'open' : ''}`}>
        <button className="sidebar-toggle" onClick={toggleSidebar} title={sidebarCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}>
          <span className="toggle-arrow">‹</span>
        </button>

        <div className="sidebar-logo">
          <div className="logo-icon">M</div>
          <span className="logo-text">Monitor<span>360</span></span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
              data-label={item.label}
              onClick={() => { setActiveSection(item.id); setSidebarOpen(false); }}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">
              {user?.username?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="user-info">
              <div className="user-info-name">{user?.username || 'Usuário'}</div>
              <div className="user-info-role">Administrador</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Wrapper */}
      <div className={`main-wrapper ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Auto-refresh bar */}
        <div className="autorefresh-bar">
          <div className="autorefresh-fill" style={{ '--refresh-duration': `${AUTO_REFRESH_SECONDS}s` }} key={lastRefresh} />
        </div>

        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-toggle" onClick={() => setSidebarOpen(o => !o)}>
              <span /><span /><span />
            </button>
            <div className="topbar-breadcrumb">
              <span className="bc-home">Monitor360</span>
              <span className="bc-sep">/</span>
              <span className="bc-page">{navItems.find(n => n.id === activeSection)?.label}</span>
            </div>
          </div>

          <div className="topbar-right">
            <div className="live-indicator">
              <span className="pulse-dot" />
              <span>Ao vivo</span>
            </div>

            {/* Seletor de dias + backfill */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'var(--surface)', padding: '4px 12px', borderRadius: '24px', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Período:</span>
              {[30, 60, 90].map(d => (
                <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '12px' }}>
                  <input
                    type="radio"
                    name="backfillDays"
                    value={d}
                    checked={backfillDays === d}
                    onChange={(e) => setBackfillDays(Number(e.target.value))}
                    disabled={backfillLoading}
                    style={{ margin: 0 }}
                  />
                  <span>{d}d</span>
                </label>
              ))}
              <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />
              <button
                className="topbar-btn backfill"
                onClick={handleBackfill}
                disabled={backfillLoading}
                style={{ margin: 0, padding: '4px 12px' }}
              >
                {backfillLoading ? '🔄 Importando...' : '📥 Importar Pedidos Anymarket'}
              </button>
            </div>

            {/* Sync Prazos */}
            <button
              className="topbar-btn"
              onClick={handleSyncPrazos}
              disabled={syncLoading}
              title="Buscar prazo de despacho na API Anymarket para pedidos sem prazo"
            >
              {syncLoading ? (
                <>
                  <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
                  {syncProgress?.percent ?? 0}%
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  Sync Prazos
                </>
              )}
            </button>

            <button className="topbar-btn" onClick={refreshAll}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M1 4v6h6M23 20v-6h-6" />
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
              Atualizar
            </button>

            <button className="topbar-btn icon-only" onClick={handleLogout} title="Sair">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>

            <button className="topbar-btn icon-only" onClick={toggleTheme} title="Alternar tema">
              {theme === 'light'
                ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>}
            </button>
          </div>
        </header>

        {/* Barra de progresso Sync Prazos */}
        {syncLoading && syncProgress && (
          <div style={{
            position: 'fixed', top: 'var(--topbar-h)', left: 0, right: 0,
            background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            padding: '8px 20px', zIndex: 49,
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 13
          }}>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: '#10b981', width: `${syncProgress.percent}%`, transition: 'width 0.3s' }} />
            </div>
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {syncProgress.percent}% · {syncProgress.processados}/{syncProgress.total} pedidos
              · ✓ {syncProgress.sucesso ?? 0} com prazo
              · ✕ {syncProgress.erro ?? 0} erros
            </span>
          </div>
        )}

        {/* Barra de progresso Backfill */}
        {backfillLoading && backfillProgress && (
          <div style={{
            position: 'fixed',
            top: syncLoading ? 'calc(var(--topbar-h) + 45px)' : 'var(--topbar-h)',
            left: 0, right: 0,
            background: 'var(--surface)', borderBottom: '1px solid var(--border)',
            padding: '8px 20px', zIndex: 49,
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, flexWrap: 'wrap'
          }}>
            <div style={{ flex: 1, minWidth: '150px', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 3, background: '#3b82f6', width: `${backfillProgress.percent || 0}%`, transition: 'width 0.3s' }} />
            </div>
            <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {backfillProgress.percent || 0}% ·
              📦 {backfillProgress.total_found || 0} encontrados ·
              ✨ {backfillProgress.inserted || 0} novos ·
              📊 {backfillProgress.status_changes || 0} status
            </span>
          </div>
        )}

        <main className="content">
          {/* Toast */}
          {notification && (
            <div className={`toast toast-${notification.type}`}>
              <span className="toast-icon">{notification.type === 'success' ? '✓' : '✕'}</span>
              {notification.message}
            </div>
          )}

          {/* ══════════════ OVERVIEW ══════════════ */}
          {activeSection === 'overview' && (
            <div className="section-overview">

              {/* KPIs */}
              <div className="kpi-strip">
                {initialLoading ? (
                  [1, 2, 3, 4].map(i => <SkeletonKpi key={i} />)
                ) : (
                  <>
                    <div className="kpi-card kpi-primary">
                      <div className="kpi-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      </div>
                      <div className="kpi-content">
                        <span className="kpi-value">{dashboardData.pedidos24h}</span>
                        <span className="kpi-label">Pedidos (24h)</span>
                      </div>
                      <div className="kpi-trend up">24h</div>
                    </div>

                    <div className="kpi-card kpi-warning">
                      <div className="kpi-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      </div>
                      <div className="kpi-content">
                        <span className="kpi-value">{dashboardData.pedidosTravados}</span>
                        <span className="kpi-label">Travados (+1h)</span>
                      </div>
                      {dashboardData.pedidosTravados > 0 && <div className="kpi-trend down">⚠</div>}
                    </div>

                    <div className="kpi-card kpi-danger">
                      <div className="kpi-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      </div>
                      <div className="kpi-content">
                        <span className="kpi-value">{dashboardData.anomaliasNaoResolvidas}</span>
                        <span className="kpi-label">Anomalias</span>
                      </div>
                      {dashboardData.anomaliasNaoResolvidas > 0 && <div className="kpi-trend down">!</div>}
                    </div>

                    <div className="kpi-card kpi-success">
                      <div className="kpi-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                      </div>
                      <div className="kpi-content">
                        <span className="kpi-value">{dashboardData.taxaSincronizacaoJet}%</span>
                        <span className="kpi-label">Sync JET</span>
                      </div>
                      <div className={`kpi-trend ${dashboardData.taxaSincronizacaoJet >= 80 ? 'up' : 'down'}`}>
                        {dashboardData.taxaSincronizacaoJet >= 80 ? '↑' : '↓'}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Pipeline Flow */}
              <div className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Pipeline em Tempo Real</h2>
                  <span className="panel-badge">Ativos</span>
                </div>
                {initialLoading ? <SkeletonPipeline /> : (
                  <div className="pipeline-flow">
                    {[
                      { key: 'ANYMARKET',         icon: '◉', label: 'Anymarket'     },
                      { key: 'JET',               icon: '⬡', label: 'JET'           },
                      { key: 'ONCLICK',           icon: '▣', label: 'Onclick / ERP' },
                      { key: 'RETORNO_JET',       icon: '↺', label: 'Retorno JET'   },
                      { key: 'RETORNO_ANYMARKET', icon: '✓', label: 'Concluído'     },
                    ].map((stage, i) => (
                      <React.Fragment key={stage.key}>
                        <div className="pipeline-stage" style={{ '--stage-color': getOrigemColor(stage.key) }}>
                          <div className="stage-icon">{stage.icon}</div>
                          <div className="stage-count">{dashboardData.metricas[stage.key] || 0}</div>
                          <div className="stage-label">{stage.label}</div>
                          <div className="stage-bar">
                            <div className="stage-bar-fill" style={{
                              width: `${Math.min(100, ((dashboardData.metricas[stage.key] || 0) / Math.max(...Object.values(dashboardData.metricas), 1)) * 100)}%`,
                              background: getOrigemColor(stage.key)
                            }} />
                          </div>
                        </div>
                        {i < 4 && <div className="pipeline-arrow">→</div>}
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>

              {/* Marketplace + Status */}
              <div className="two-col">
                <div className="panel">
                  <div className="panel-header"><h2 className="panel-title">Por Marketplace</h2></div>
                  {initialLoading ? <SkeletonMarketplaceList /> : (
                    <div className="marketplace-list">
                      {dashboardData.porMarketplace.length === 0
                        ? <p className="empty-state">Sem dados disponíveis</p>
                        : dashboardData.porMarketplace.map(mp => (
                            <div key={mp.marketplace} className="marketplace-row">
                              <span className="mp-name">{mp.marketplace}</span>
                              <div className="mp-bar-wrap">
                                <div className="mp-bar" style={{ width: `${Math.min(100, (mp.total / Math.max(...dashboardData.porMarketplace.map(m => m.total))) * 100)}%` }} />
                              </div>
                              <span className="mp-count">{mp.total}</span>
                            </div>
                          ))
                      }
                    </div>
                  )}
                </div>

                <div className="panel">
                  <div className="panel-header"><h2 className="panel-title">Status por Plataforma</h2></div>
                  {initialLoading || graficosLoading ? <SkeletonStatusPlatforms /> : (
                    <div className="status-platforms">
                      {['ANYMARKET', 'JET', 'ONCLICK'].map(plat => (
                        <div key={plat} className="plat-group">
                          <div className="plat-header" style={{ borderColor: getOrigemColor(plat) }}>
                            <span className="plat-dot" style={{ background: getOrigemColor(plat) }} />
                            <span className="plat-name">{traduzirOrigem(plat)}</span>
                          </div>
                          <div className="plat-statuses">
                            {(graficos.porStatus?.[plat] || []).slice(0, 4).map(s => (
                              <div key={s.status} className="plat-status-row">
                                <span className="plat-status-name">{s.status}</span>
                                <span className="plat-status-count">{s.total}</span>
                              </div>
                            ))}
                            {!(graficos.porStatus?.[plat]?.length) && <p className="empty-state-sm">Sem dados</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Volume chart */}
              <div className="panel">
                <div className="panel-header"><h2 className="panel-title">Volume por Hora — últimas 24h</h2></div>
                {graficosLoading ? <SkeletonVolumeChart /> : (
                  <div className="volume-chart">
                    {!graficos.volumeHoras?.length
                      ? <p className="empty-state">Sem dados de volume</p>
                      : <div className="bar-chart">
                          {graficos.volumeHoras.map((h, i) => (
                            <div key={i} className="bar-col" title={`${h.total} pedidos`}>
                              <span className="bar-value">{h.total > 0 ? h.total : ''}</span>
                              <div className="bar-fill" style={{ height: `${(h.total / maxVolume) * 100}%` }} />
                              <span className="bar-label">{new Date(h.hora).getHours()}h</span>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════ PIPELINE ══════════════ */}
          {activeSection === 'pipeline' && (
            <div className="section-pipeline">
              <div className="filters-row">
                <div className="search-wrap">
                  <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Buscar por pedido ou marketplace..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                  />
                </div>
                <select value={filters.marketplace} onChange={(e) => setFilters({ ...filters, marketplace: e.target.value })} className="filter-select">
                  <option value="">Todos os marketplaces</option>
                  {marketplacesUnicos.map(mp => <option key={mp} value={mp}>{mp}</option>)}
                </select>
                <select value={filters.loja} onChange={(e) => setFilters({ ...filters, loja: e.target.value })} className="filter-select">
                  <option value="">Todas as lojas</option>
                  {lojasUnicas.map(loja => <option key={loja} value={loja}>{loja}</option>)}
                </select>
                <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })} className="filter-select">
                  <option value="">Ordenar por...</option>
                  <option value="prazo_asc">⏰ Prazo mais urgente primeiro</option>
                  <option value="prazo_desc">🔴 Mais atrasados primeiro</option>
                  <option value="parado_desc">🕐 Parado há mais tempo</option>
                </select>
                <button onClick={() => setFilters({ marketplace: '', travados: false, search: '', loja: '', sort: '', quickFilter: '' })} className="clear-btn">Limpar</button>
              </div>

              {/* Contadores clicáveis */}
              {loading && pedidos.length === 0 ? <SkeletonPipelineSummaryBar /> : (
                <div className="pipeline-summary-bar">
                  <button
                    className={`psb-btn ${!filters.quickFilter && !filters.travados ? 'psb-btn-active' : ''}`}
                    onClick={() => setFilters(f => ({ ...f, quickFilter: '', travados: false }))}
                    title="Ver todos os pedidos"
                  >
                    <strong>{pipelineSummary.total}</strong>
                    <span>total</span>
                  </button>
                  <span className="psb-divider" />
                  <button
                    className={`psb-btn psb-danger ${filters.quickFilter === 'foraPrazo' ? 'psb-btn-active' : ''}`}
                    onClick={() => setFilters(f => ({
                      ...f,
                      quickFilter: f.quickFilter === 'foraPrazo' ? '' : 'foraPrazo',
                      travados:    false,
                      sort:        f.quickFilter === 'foraPrazo' ? f.sort : 'prazo_desc',
                    }))}
                    title="Filtrar pedidos fora do prazo"
                  >
                    <strong>{pipelineSummary.foraPrazo}</strong>
                    <span>fora do prazo</span>
                  </button>
                  <span className="psb-divider" />
                  <button
                    className={`psb-btn psb-warning ${filters.quickFilter === 'urgentes' ? 'psb-btn-active' : ''}`}
                    onClick={() => setFilters(f => ({
                      ...f,
                      quickFilter: f.quickFilter === 'urgentes' ? '' : 'urgentes',
                      travados:    false,
                      sort:        f.quickFilter === 'urgentes' ? f.sort : 'prazo_asc',
                    }))}
                    title="Filtrar pedidos que vencem nas próximas 24h"
                  >
                    <strong>{pipelineSummary.urgentes}</strong>
                    <span>vencem em &lt;24h</span>
                  </button>
                  <span className="psb-divider" />
                  <button
                    className={`psb-btn psb-muted ${filters.quickFilter === 'semPrazo' ? 'psb-btn-active' : ''}`}
                    onClick={() => setFilters(f => ({
                      ...f,
                      quickFilter: f.quickFilter === 'semPrazo' ? '' : 'semPrazo',
                      travados:    false,
                    }))}
                    title="Filtrar pedidos sem prazo cadastrado"
                  >
                    <strong>{pipelineSummary.semPrazo}</strong>
                    <span>sem prazo</span>
                  </button>
                </div>
              )}

              <div className="table-panel">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nº Pedido</th>
                      <th>Marketplace</th>
                      <th>Loja</th>
                      <th>IDs do Sistema</th>
                      <th>Estágio Atual</th>
                      <th>Último Evento</th>
                      <th
                        className={`th-sortable ${filters.sort.startsWith('prazo') ? 'th-active' : ''}`}
                        onClick={() => setFilters(f => ({ ...f, sort: f.sort === 'prazo_asc' ? 'prazo_desc' : 'prazo_asc' }))}
                        title="Clique para ordenar por prazo"
                      >
                        Prazo Prometido
                        <span className="th-sort-icon">
                          {filters.sort === 'prazo_asc' ? ' ↑' : filters.sort === 'prazo_desc' ? ' ↓' : ' ⇅'}
                        </span>
                      </th>
                      <th
                        className={`th-sortable ${filters.sort === 'parado_desc' ? 'th-active' : ''}`}
                        onClick={() => setFilters(f => ({ ...f, sort: f.sort === 'parado_desc' ? '' : 'parado_desc' }))}
                        title="Clique para ordenar por tempo parado"
                      >
                        Parado há
                        <span className="th-sort-icon">
                          {filters.sort === 'parado_desc' ? ' ↓' : ' ⇅'}
                        </span>
                      </th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      [1, 2, 3, 4, 5, 6, 7, 8].map(i => <SkeletonTableRow key={i} />)
                    ) : filteredPedidos.length === 0 ? (
                      <tr>
                        <td colSpan="9">
                          <div className="empty-table">
                            <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2"/></svg>
                            <p>Nenhum pedido encontrado</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredPedidos.map((pedido) => {
                        const travado   = isPedidoTravado(pedido);
                        const prazoInfo = formatPrazo(pedido.prazo_despacho, pedido.horas_ate_prazo);
                        return (
                          <tr key={pedido.pedido_id} className={`data-row ${travado ? 'row-warning' : ''}`}>
                            <td><span className="mono-id">{pedido.pedido_id}</span></td>
                            <td><span className="mp-chip">{pedido.marketplace || '—'}</span></td>
                            <td className="loja-cell">{pedido.loja || '—'}</td>
                            <td>
                              <div className="ids-stack">
                                {pedido.id_anymarket && <span><span className="id-prefix am">AM</span>{pedido.id_anymarket}</span>}
                                {pedido.id_jet       && <span><span className="id-prefix jet">JET</span>{pedido.id_jet}</span>}
                                {pedido.id_onclick   && <span><span className="id-prefix oc">OC</span>{pedido.id_onclick}</span>}
                              </div>
                            </td>
                            <td>
                              <div className="stage-chips">
                                {pedido.origens?.map(orig => (
                                  <span key={orig} className="stage-chip" style={{ background: getOrigemColor(orig) + '22', color: getOrigemColor(orig), borderColor: getOrigemColor(orig) + '44' }}>
                                    {traduzirOrigem(orig)}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="date-cell">{formatDate(pedido.ultimo_evento)}</td>
                            <td>
                              {prazoInfo ? (
                                <div className="prazo-cell">
                                  <span className={`prazo-badge ${prazoInfo.atrasado ? 'prazo-atrasado' : (parseFloat(pedido.horas_ate_prazo) < 24 ? 'prazo-urgente' : 'prazo-ok')}`}>
                                    {prazoInfo.atrasado
                                      ? `⚠ Atrasado ${prazoInfo.label}`
                                      : parseFloat(pedido.horas_ate_prazo) < 24
                                        ? `⚡ ${prazoInfo.label} restantes`
                                        : `✓ ${prazoInfo.label} restantes`
                                    }
                                  </span>
                                  {pedido.prazo_despacho && (
                                    <span className="prazo-data">{new Date(pedido.prazo_despacho).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="prazo-badge prazo-sem">Sem prazo</span>
                              )}
                            </td>
                            <td>
                              <span className={`hours-badge ${travado ? 'hours-danger' : 'hours-ok'}`}>
                                {parseFloat(pedido.horas_sem_update || 0).toFixed(1)}h
                              </span>
                            </td>
                            <td>
                              <button className="detail-btn" onClick={() => fetchPedidoDetalhes(pedido.pedido_id)}>Ver detalhes</button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>

                {totalPages > 1 && (
                  <div className="pagination">
                    <button className="page-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>«</button>
                    <button className="page-btn" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>‹</button>
                    <span className="page-info">Página <strong>{currentPage}</strong> de <strong>{totalPages}</strong></span>
                    <button className="page-btn" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>›</button>
                    <button className="page-btn" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>»</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════ ANOMALIAS ══════════════ */}
          {activeSection === 'anomalias' && (
            <div className="section-anomalias">
              <div className="anomalias-summary">
                <div className="anomalia-kpi danger">
                  <div className="ak-icon">⚠️</div>
                  <div>
                    {anomaliasLoading
                      ? <div className="skeleton" style={{ width: 40, height: 30, marginBottom: 4 }} />
                      : <span className="ak-value">{anomalias.filter(a => !a.resolvida).length}</span>
                    }
                    <div className="ak-label">Não resolvidas</div>
                  </div>
                </div>
                <div className="anomalia-kpi success">
                  <div className="ak-icon">✅</div>
                  <div>
                    {anomaliasLoading
                      ? <div className="skeleton" style={{ width: 40, height: 30, marginBottom: 4 }} />
                      : <span className="ak-value">{anomalias.filter(a => a.resolvida).length}</span>
                    }
                    <div className="ak-label">Resolvidas</div>
                  </div>
                </div>
              </div>

              <div className="anomalias-cards">
                {anomaliasLoading ? (
                  [1, 2, 3, 4].map(i => <SkeletonAnomaliaCard key={i} />)
                ) : anomalias.length === 0 ? (
                  <div className="empty-section">
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <p>Nenhuma anomalia encontrada</p>
                  </div>
                ) : (
                  anomalias.map(anomalia => (
                    <div key={anomalia.id} className={`anomalia-card ${anomalia.resolvida ? 'resolved' : 'pending'}`}>
                      <div className="anomalia-status-indicator" />
                      <div className="anomalia-card-body">
                        <div className="anomalia-top">
                          <span className="anomalia-pedido-id">{anomalia.pedido_id}</span>
                          <span className={`anomalia-badge ${anomalia.resolvida ? 'badge-resolved' : 'badge-pending'}`}>
                            {anomalia.resolvida ? 'Resolvida' : 'Pendente'}
                          </span>
                        </div>
                        <p className="anomalia-desc">{anomalia.descricao}</p>
                        <div className="anomalia-meta">
                          {anomalia.marketplace && <span className="meta-chip">{anomalia.marketplace}</span>}
                          <span className="meta-time">{formatDate(anomalia.criado_em)}</span>
                        </div>
                      </div>
                      {!anomalia.resolvida && (
                        <button className="resolve-btn" onClick={() => resolverAnomalia(anomalia.id)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                          Resolver
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ══════════════ GRÁFICOS ══════════════ */}
          {activeSection === 'graficos' && (
            <div className="section-graficos">
              <div className="two-col">
                <div className="panel">
                  <div className="panel-header"><h2 className="panel-title">Status por Plataforma</h2></div>
                  {graficosLoading ? <SkeletonStatusPlatforms /> : (
                    ['ANYMARKET', 'JET', 'ONCLICK'].map(plat => (
                      <div key={plat} className="graf-plat-section">
                        <div className="graf-plat-title" style={{ color: getOrigemColor(plat) }}>{traduzirOrigem(plat)}</div>
                        {(graficos.porStatus?.[plat] || []).map(s => {
                          const max = Math.max(...(graficos.porStatus?.[plat] || []).map(x => x.total), 1);
                          return (
                            <div key={s.status} className="graf-status-row">
                              <span className="gsn">{s.status}</span>
                              <div className="gs-bar-wrap"><div className="gs-bar" style={{ width: `${(s.total / max) * 100}%`, background: getOrigemColor(plat) }} /></div>
                              <span className="gsc">{s.total}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>

                <div className="panel">
                  <div className="panel-header"><h2 className="panel-title">Pedidos por Marketplace</h2></div>
                  {graficosLoading ? <SkeletonMarketplaceList /> : (
                    <div className="mp-graf-list">
                      {(graficos.porMarketplace || []).map((mp, i) => {
                        const max = Math.max(...(graficos.porMarketplace || []).map(x => x.total), 1);
                        const hue = (i * 47) % 360;
                        return (
                          <div key={mp.marketplace} className="mp-graf-row">
                            <span className="mpg-name">{mp.marketplace}</span>
                            <div className="mpg-bar-wrap"><div className="mpg-bar" style={{ width: `${(mp.total / max) * 100}%`, background: `hsl(${hue},60%,52%)` }} /></div>
                            <span className="mpg-count">{mp.total}</span>
                          </div>
                        );
                      })}
                      {!(graficos.porMarketplace?.length) && <p className="empty-state">Sem dados disponíveis</p>}
                    </div>
                  )}
                </div>
              </div>

              <div className="panel">
                <div className="panel-header"><h2 className="panel-title">Volume de Pedidos — Últimas 24 horas</h2></div>
                {graficosLoading ? <SkeletonVolumeChart /> : (
                  <div className="volume-chart large">
                    {!graficos.volumeHoras?.length
                      ? <p className="empty-state">Sem dados de volume</p>
                      : <div className="bar-chart large">
                          {graficos.volumeHoras.map((h, i) => (
                            <div key={i} className="bar-col large" title={`${h.total} pedidos`}>
                              <span className="bar-value">{h.total > 0 ? h.total : ''}</span>
                              <div className="bar-fill" style={{ height: `${(h.total / maxVolume) * 100}%` }} />
                              <span className="bar-label">{new Date(h.hora).getHours()}h</span>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════════════ UPLOAD ══════════════ */}
          {activeSection === 'upload' && (
            <UploadPlanilha />
          )}
        </main>
      </div>

      {/* ═══════════════════ MODAL ═══════════════════ */}
      {selectedOrder && (
        <div className="modal-backdrop" onClick={() => setSelectedOrder(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 className="modal-title">Detalhes do Pedido</h2>
                <p className="modal-subtitle">{selectedOrder.mapeamento?.numero_marketplace}</p>
              </div>
              <button className="modal-close" onClick={() => setSelectedOrder(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-info-grid">
                <div className="info-block">
                  <span className="info-label">Marketplace</span>
                  <span className="info-value">{selectedOrder.mapeamento?.marketplace_origem || '—'}</span>
                </div>
                <div className="info-block">
                  <span className="info-label">Loja</span>
                  <span className="info-value">{selectedOrder.mapeamento?.loja || '—'}</span>
                </div>
                <div className="info-block">
                  <span className="info-label">Prazo Prometido</span>
                  <span className={`info-value ${selectedOrder.mapeamento?.prazo_despacho && new Date(selectedOrder.mapeamento.prazo_despacho) < new Date() ? 'info-value-danger' : ''}`}>
                    {selectedOrder.mapeamento?.prazo_despacho ? formatDate(selectedOrder.mapeamento.prazo_despacho) : '—'}
                    {selectedOrder.mapeamento?.prazo_despacho && new Date(selectedOrder.mapeamento.prazo_despacho) < new Date() &&
                      <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: 'var(--danger)' }}>VENCIDO</span>
                    }
                  </span>
                </div>
                <div className="info-block">
                  <span className="info-label">ID Anymarket</span>
                  <span className="info-value mono">{selectedOrder.mapeamento?.id_anymarket || '—'}</span>
                </div>
                <div className="info-block">
                  <span className="info-label">ID JET</span>
                  <span className="info-value mono">{selectedOrder.mapeamento?.id_jet || '—'}</span>
                </div>
                <div className="info-block">
                  <span className="info-label">ID Onclick</span>
                  <span className="info-value mono">{selectedOrder.mapeamento?.id_onclick || '—'}</span>
                </div>
              </div>

              {selectedOrder.events?.length > 0 && (
                <div className="modal-section">
                  <h3 className="modal-section-title">Histórico de Eventos</h3>
                  <div className="events-timeline">
                    {selectedOrder.events.map((event, idx) => (
                      <div key={idx} className="timeline-item">
                        <div className="timeline-dot" style={{ background: getOrigemColor(event.origem) }} />
                        <div className="timeline-content">
                          <div className="timeline-top">
                            <span className="timeline-origem" style={{ color: getOrigemColor(event.origem) }}>{event.origem}</span>
                            <span className="timeline-status">{event.status}</span>
                          </div>
                          <span className="timeline-time">{formatDate(event.timestamp)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedOrder.anomalias?.length > 0 && (
                <div className="modal-section">
                  <h3 className="modal-section-title">Anomalias do Pedido</h3>
                  {selectedOrder.anomalias.map((anom, idx) => (
                    <div key={idx} className={`modal-anomalia ${anom.resolvida ? 'resolved' : 'pending'}`}>
                      <strong>{anom.tipo}</strong>
                      <p>{anom.descricao}</p>
                      <small>{formatDate(anom.criado_em)}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;