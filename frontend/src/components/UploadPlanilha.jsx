// frontend/src/components/UploadPlanilha.jsx
import React, { useState, useCallback } from 'react';
import './UploadPlanilha.css';

const formatBytes = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function UploadPlanilha() {
  const [file, setFile]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [resultado, setResultado] = useState(null);
  const [error, setError]         = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { setFile(f); setResultado(null); setError(null); }
  }, []);

  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setResultado(null); setError(null); }
  };

  const limpar = () => { setFile(null); setResultado(null); setError(null); };

  const handleUpload = async () => {
    if (!file) { setError('Selecione ou arraste um arquivo primeiro'); return; }

    const token = localStorage.getItem('token');
    if (!token) {
      setError('Sessão expirada. Faça login novamente.');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    formData.append('planilha', file);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

    try {
      const response = await fetch(`${API_URL}/upload/compare`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await response.json();
      if (response.ok) { setResultado(data); setError(null); }
      else             { setError(data.error || 'Erro ao processar planilha'); setResultado(null); }
    } catch { setError('Erro ao conectar com o servidor'); setResultado(null); }
    finally  { setLoading(false); }
  };

  const exportarCSV = () => {
    if (!resultado?.nao_integrados?.length) return;
    const header = 'ID Pedido,Status,Valor,Cliente,Data';
    const rows   = resultado.nao_integrados.map(p =>
      `${p.pedido_id_original},${p.status || ''},${p.valor_total || 0},"${(p.cliente || '').replace(/"/g, '')}",${p.data || ''}`
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `nao_integrados_${resultado.tipo_planilha || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalIntegrados    = resultado?.total_integrados    ?? 0;
  const totalNaoIntegrados = resultado?.total_nao_integrados ?? 0;
  const totalPlanilha      = resultado?.total_planilha       ?? 0;
  const taxaIntegracao     = totalPlanilha > 0 ? Math.round((totalIntegrados / totalPlanilha) * 100) : 0;

  const getStatusChipClass = (status) => {
    if (!status) return 'default';
    const s = status.toLowerCase();
    if (s === 'cancelado' || s === 'canceled') return 'cancelled';
    if (s === 'pendente'  || s === 'pending')  return 'pending';
    return 'default';
  };

  return (
    <div className="upload-container">

      {/* Header */}
      <div className="upload-header">
        <div>
          <h2>Comparar Planilha de Pedidos</h2>
          <p>Verifique quais pedidos do marketplace já estão integrados no sistema</p>
        </div>
      </div>

      {/* Top row: drop zone + hint */}
      <div className="upload-top-row">

        {/* Drop zone */}
        <div>
          {!file ? (
            <div
              className={`upload-area ${dragActive ? 'drag-active' : ''}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => document.getElementById('fileInput').click()}
            >
              <div className="drop-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <p className="upload-title">Arraste sua planilha aqui</p>
              <p className="upload-subtitle">ou clique para selecionar</p>
              <p className="upload-formats">CSV · XLSX · XLS · TXT</p>
              <input id="fileInput" type="file" onChange={handleFileChange} accept=".csv,.xlsx,.xls,.txt" style={{ display:'none' }} />
            </div>
          ) : (
            <div className="upload-area has-file" onClick={() => document.getElementById('fileInput').click()}>
              <div className="selected-file-info">
                <div className="file-icon-box">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div className="file-meta">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{formatBytes(file.size)}</span>
                </div>
              </div>
              <button className="file-remove-btn" onClick={(e) => { e.stopPropagation(); limpar(); }} title="Remover">✕</button>
              <input id="fileInput" type="file" onChange={handleFileChange} accept=".csv,.xlsx,.xls,.txt" style={{ display:'none' }} />
            </div>
          )}

          {/* Actions */}
          {file && (
            <div className="upload-actions">
              <button onClick={handleUpload} disabled={loading} className="upload-btn">
                {loading ? (
                  <><span className="spinner-sm" /> Processando...</>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    Comparar Planilha
                  </>
                )}
              </button>
              <button onClick={limpar} className="cancel-btn">Cancelar</button>
            </div>
          )}

          {error && (
            <div className="upload-error" style={{ marginTop: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}
        </div>

        {/* Hint panel */}
        <div className="upload-hint-panel">
          <p className="hint-title">Como usar</p>
          <div className="hint-step">
            <div className="hint-num">1</div>
            <span>Exporte a planilha de pedidos direto do marketplace</span>
          </div>
          <div className="hint-step">
            <div className="hint-num">2</div>
            <span>Arraste ou selecione o arquivo no campo ao lado</span>
          </div>
          <div className="hint-step">
            <div className="hint-num">3</div>
            <span>Clique em <strong>Comparar</strong> para ver quais pedidos não chegaram ao sistema</span>
          </div>
          <div style={{ marginTop: 4 }}>
            <p className="hint-title" style={{ marginBottom: 6 }}>Formatos aceitos</p>
            <div className="hint-formats">
              {['.csv','.xlsx','.xls','.txt'].map(f => (
                <span key={f} className="fmt-chip">{f}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Results ── */}
      {resultado && (
        <div className="result-section">

          {/* Metrics */}
          <div className="result-metrics">
            <div className="result-metric total">
              <span className="rm-label">Total na planilha</span>
              <span className="rm-value">{totalPlanilha}</span>
              <span className="rm-percent">{resultado.tipo_planilha}</span>
            </div>
            <div className="result-metric success">
              <span className="rm-label">Integrados</span>
              <span className="rm-value">{totalIntegrados}</span>
              <span className="rm-percent">{taxaIntegracao}%</span>
            </div>
            <div className="result-metric warning">
              <span className="rm-label">Não integrados</span>
              <span className="rm-value">{totalNaoIntegrados}</span>
              <span className="rm-percent">{totalPlanilha > 0 ? 100 - taxaIntegracao : 0}%</span>
            </div>
            <div className="result-metric info">
              <span className="rm-label">Taxa de integração</span>
              <span className="rm-value">{taxaIntegracao}%</span>
              <span className="rm-percent">{taxaIntegracao >= 90 ? '✓ Ótimo' : taxaIntegracao >= 70 ? '~ Regular' : '✕ Baixo'}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="integration-bar-wrap">
            <div className="ib-header">
              <span className="ib-title">Progresso de integração</span>
              <span className={`ib-badge ${taxaIntegracao >= 80 ? 'good' : 'bad'}`}>
                {taxaIntegracao >= 80 ? '✓' : '⚠'} {taxaIntegracao}% integrado
              </span>
            </div>
            <div className="ib-track">
              <div className={`ib-fill ${taxaIntegracao < 70 ? 'low' : ''}`} style={{ width: `${taxaIntegracao}%` }} />
            </div>
            <div className="ib-labels">
              <span>{totalIntegrados} integrados</span>
              <span>{totalNaoIntegrados} pendentes</span>
            </div>
          </div>

          {/* Table or success */}
          {totalNaoIntegrados === 0 ? (
            <div className="all-integrated">
              <div className="ai-icon">✓</div>
              <div className="ai-text">
                <strong>Todos os pedidos estão integrados!</strong>
                <p>Todos os {totalPlanilha} pedidos da planilha foram encontrados no sistema.</p>
              </div>
            </div>
          ) : (
            <div className="result-table-section">
              <div className="rts-header">
                <div className="rts-title">
                  Pedidos não integrados
                  <span className="rts-badge warn">{totalNaoIntegrados}</span>
                  {resultado.tipo_planilha && <span className="rts-badge mp">{resultado.tipo_planilha}</span>}
                </div>
                <div className="rts-actions">
                  <button className="export-btn" onClick={exportarCSV}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Exportar CSV
                  </button>
                </div>
              </div>

              <div className="result-table-wrap">
                <table className="rt">
                  <thead>
                    <tr>
                      <th>ID do Pedido</th>
                      <th>Status</th>
                      <th>Valor</th>
                      <th>Cliente</th>
                      <th>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(resultado.nao_integrados || []).slice(0, 100).map((pedido, idx) => (
                      <tr key={idx}>
                        <td><span className="rt-id">{pedido.pedido_id_original}</span></td>
                        <td>
                          <span className={`status-chip ${getStatusChipClass(pedido.status)}`}>
                            {pedido.status || '—'}
                          </span>
                        </td>
                        <td className="rt-valor">
                          R$ {parseFloat(pedido.valor_total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </td>
                        <td><span className="rt-cliente">{pedido.cliente?.substring(0, 50) || '—'}</span></td>
                        <td className="rt-data">{pedido.data || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(resultado.nao_integrados?.length ?? 0) > 100 && (
                <p className="more-msg">
                  Exibindo 100 de {resultado.nao_integrados.length} pedidos — use Exportar CSV para ver todos
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default UploadPlanilha;