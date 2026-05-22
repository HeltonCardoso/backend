import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta?.env?.VITE_API_URL || "http://localhost:3001/api";

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m atrás`;
  return `${m}m atrás`;
}
function formatBRL(v) {
  return `R$ ${parseFloat(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

const STATUS_FLOW = [
  { key: "anymarket", label: "Anymarket", icon: "🔗" },
  { key: "jet",       label: "JET",       icon: "⚡" },
  { key: "erp",       label: "Onclick ERP", icon: "🖥️" },
  { key: "invoiced",  label: "Faturado",  icon: "🧾" },
  { key: "returned",  label: "Retornou",  icon: "✅" },
  { key: "ok",        label: "Concluído", icon: "🏁" },
];

const STATUS_ORDER = ["new","anymarket","jet","erp","invoiced","returned","ok","cancelled"];

function getStepStatus(orderStatus, stepKey) {
  const oi = STATUS_ORDER.indexOf(orderStatus);
  const si = STATUS_ORDER.indexOf(stepKey);
  if (orderStatus === "cancelled") return si <= oi ? "error" : "pending";
  if (si < oi)  return "ok";
  if (si === oi) return "active";
  return "pending";
}

const SLA_COLOR = { ok: "#22c55e", warning: "#f59e0b", critical: "#ef4444" };
const STEP_COLORS = { ok: "#22c55e", active: "#38bdf8", error: "#ef4444", pending: "#1e293b" };

// ─── ICON ─────────────────────────────────────────────────────────────────────
function Icon({ name, size = 16 }) {
  const p = {
    refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
    search:  "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
    x:       "M18 6L6 18M6 6l12 12",
    clock:   "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2",
    download:"M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
    zap:     "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    check:   "M20 6L9 17l-5-5",
    alert:   "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={p[name] || ""} />
    </svg>
  );
}

// ─── BACKFILL PANEL ───────────────────────────────────────────────────────────
function BackfillPanel({ onClose, onDone }) {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo]   = useState(new Date().toISOString().slice(0, 10));
  const [target, setTarget]   = useState("all");
  const [running, setRunning] = useState(false);
  const [logs, setLogs]       = useState([]);
  const [progress, setProgress] = useState(null);
  const logsRef = useRef(null);

  const addLog = (msg, type = "info") => {
    setLogs(l => [...l, { msg, type, ts: new Date().toLocaleTimeString("pt-BR") }]);
    setTimeout(() => logsRef.current?.scrollTo(0, logsRef.current.scrollHeight), 50);
  };

  async function startBackfill() {
    setRunning(true);
    setLogs([]);
    setProgress(null);

    const endpoint = `/backfill/${target}`;
    addLog(`Iniciando backfill ${target.toUpperCase()} de ${dateFrom} até ${dateTo}...`);

    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());

            if (data.type === "start")    addLog(data.message, "info");
            if (data.type === "error")    addLog(`❌ ${data.message}`, "error");
            if (data.type === "done") {
              const r = data.result;
              if (r?.anymarket) addLog(`✅ Anymarket: ${r.anymarket.inserted} inseridos, ${r.anymarket.updated} atualizados`, "success");
              if (r?.jet)       addLog(`✅ JET: ${r.jet.inserted} inseridos, ${r.jet.updated} atualizados`, "success");
              addLog("🎉 Backfill concluído!", "success");
              onDone && onDone();
            }
            if (data.type === "progress") {
              setProgress(data);
              const phase = data.phase ? `[${data.phase.toUpperCase()}] ` : "";
              addLog(`${phase}Processados: ${data.total_found || 0} | Inseridos: ${data.inserted || 0} | Atualizados: ${data.updated || 0}`, "progress");
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      addLog(`❌ Erro de conexão: ${err.message}`, "error");
    }

    setRunning(false);
  }

  const logColor = { info: "#94a3b8", error: "#ef4444", success: "#22c55e", progress: "#38bdf8" };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "#00000088", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "#080e1c", border: "1px solid #1e293b",
        borderRadius: 16, padding: 28, width: 560, maxHeight: "90vh",
        display: "flex", flexDirection: "column", gap: 18,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#f8fafc" }}>Importar Pedidos Históricos</div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 3 }}>
              Busca pedidos no Anymarket e enriquece com dados da JET
            </div>
          </div>
          <button onClick={onClose} disabled={running}
            style={{ background: "none", border: "none", color: "#475569", cursor: "pointer" }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Opções */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { key: "all",       label: "Completo",  desc: "Anymarket + JET" },
            { key: "anymarket", label: "Anymarket",  desc: "Só Anymarket" },
            { key: "jet",       label: "JET",        desc: "Só enriquecimento" },
          ].map(({ key, label, desc }) => (
            <button key={key} onClick={() => setTarget(key)}
              style={{
                background: target === key ? "#0f2040" : "#0a0f1e",
                border: `1px solid ${target === key ? "#38bdf8" : "#1e293b"}`,
                borderRadius: 8, padding: "10px 8px", cursor: "pointer",
                color: target === key ? "#38bdf8" : "#64748b", textAlign: "center",
              }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 10, marginTop: 2 }}>{desc}</div>
            </button>
          ))}
        </div>

        {/* Datas */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {[["De", dateFrom, setDateFrom], ["Até", dateTo, setDateTo]].map(([label, val, set]) => (
            <div key={label}>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 5 }}>{label}</div>
              <input type="date" value={val} onChange={e => set(e.target.value)}
                style={{
                  width: "100%", background: "#0a0f1e", border: "1px solid #1e293b",
                  borderRadius: 8, padding: "8px 10px", color: "#e2e8f0", fontSize: 13,
                  outline: "none",
                }} />
            </div>
          ))}
        </div>

        {/* Progresso atual */}
        {progress && (
          <div style={{ background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, textAlign: "center" }}>
              {[
                ["Encontrados", progress.total_found || 0, "#94a3b8"],
                ["Inseridos",   progress.inserted    || 0, "#22c55e"],
                ["Atualizados", progress.updated     || 0, "#38bdf8"],
                ["Ignorados",   progress.skipped     || 0, "#475569"],
              ].map(([l, v, c]) => (
                <div key={l}>
                  <div style={{ fontSize: 20, fontFamily: "monospace", color: c, fontWeight: 700 }}>{v}</div>
                  <div style={{ fontSize: 10, color: "#475569" }}>{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Log */}
        <div ref={logsRef} style={{
          background: "#040810", border: "1px solid #0f1f3d", borderRadius: 8,
          padding: 12, height: 160, overflowY: "auto", fontFamily: "monospace",
        }}>
          {logs.length === 0
            ? <span style={{ color: "#1e293b", fontSize: 12 }}>Logs aparecerão aqui...</span>
            : logs.map((l, i) => (
              <div key={i} style={{ fontSize: 11, color: logColor[l.type] || "#94a3b8", marginBottom: 3 }}>
                <span style={{ color: "#334155" }}>[{l.ts}] </span>{l.msg}
              </div>
            ))
          }
        </div>

        {/* Aviso importante */}
        <div style={{ background: "#f59e0b11", border: "1px solid #f59e0b33", borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "#fcd34d", lineHeight: 1.6 }}>
            <strong>Como funciona:</strong> Pedidos já existentes no banco são <em>atualizados</em> (nunca duplicados).
            Novos pedidos são inseridos com a mesma estrutura dos que chegam por webhook.
            O cruzamento com a JET é feito pelo <code>marketplaceOrderId</code>.
          </div>
        </div>

        <button onClick={startBackfill} disabled={running}
          style={{
            background: running ? "#0f2040" : "linear-gradient(135deg, #1d4ed8, #6366f1)",
            border: "none", borderRadius: 10, padding: "12px 0",
            color: running ? "#475569" : "#fff", fontSize: 14, fontWeight: 600,
            cursor: running ? "not-allowed" : "pointer", transition: "all 0.2s",
          }}>
          {running ? "⏳ Importando... não feche esta janela" : `▶ Iniciar Backfill ${target.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}

// ─── ORDER ROW ────────────────────────────────────────────────────────────────
function OrderRow({ order, onClick, selected }) {
  const slaColor = SLA_COLOR[order.sla_status] || "#22c55e";
  return (
    <div onClick={() => onClick(order)}
      style={{
        background: selected ? "#0f172a" : "transparent",
        border: `1px solid ${selected ? "#38bdf8" : (order.sla_status === "critical" ? "#ef444433" : order.sla_status === "warning" ? "#f59e0b33" : "#1e293b")}`,
        borderRadius: 10, padding: "10px 14px", cursor: "pointer",
        marginBottom: 5, transition: "all 0.15s",
      }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: slaColor, boxShadow: `0 0 5px ${slaColor}` }} />
          <span style={{ fontFamily: "monospace", fontSize: 12, color: "#e2e8f0", fontWeight: 700 }}>{order.order_id}</span>
          <span style={{ fontSize: 10, background: "#1e293b", color: "#94a3b8", padding: "1px 7px", borderRadius: 4 }}>{order.marketplace}</span>
          {order.sla_status !== "ok" && (
            <span style={{ fontSize: 10, color: slaColor, background: slaColor + "22", padding: "1px 7px", borderRadius: 4 }}>
              {order.sla_status === "critical" ? "🚨 SLA CRÍTICO" : "⚠ SLA ATENÇÃO"}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ color: "#38bdf8", fontFamily: "monospace", fontSize: 12 }}>{formatBRL(order.value)}</span>
          <span style={{ color: "#475569", fontSize: 10 }}>{timeAgo(order.created_at)}</span>
        </div>
      </div>

      {/* Pipeline */}
      <div style={{ display: "flex", alignItems: "center" }}>
        {STATUS_FLOW.map((step, i) => {
          const st = getStepStatus(order.status, step.key);
          const c = STEP_COLORS[st];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                background: c + "22", border: `2px solid ${c}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, opacity: st === "pending" ? 0.3 : 1,
                boxShadow: st !== "pending" ? `0 0 7px ${c}55` : "none",
                flexShrink: 0,
              }} title={step.label}>
                {step.icon}
              </div>
              {i < STATUS_FLOW.length - 1 && (
                <div style={{
                  width: 20, height: 2, marginBottom: 0,
                  background: st === "ok" ? "#22c55e44" : "#1e293b",
                }} />
              )}
            </div>
          );
        })}
        {order.error_reason && (
          <span style={{ marginLeft: 10, fontSize: 10, color: "#f59e0b", background: "#f59e0b11", padding: "2px 8px", borderRadius: 20 }}>
            ⚠ {order.error_reason}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── DETAIL PANEL ─────────────────────────────────────────────────────────────
function DetailPanel({ order, onClose }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    fetch(`${API}/orders/${order.order_id}`)
      .then(r => r.json())
      .then(d => setEvents(d.events || []))
      .catch(() => {});
  }, [order.order_id]);

  return (
    <div style={{
      background: "#0a0f1e", border: "1px solid #1e293b",
      borderRadius: 12, padding: 20, position: "sticky", top: 80,
      maxHeight: "calc(100vh - 120px)", overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
        <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: "#38bdf8" }}>{order.order_id}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer" }}>
          <Icon name="x" size={15} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}>
        {[
          ["Marketplace", order.marketplace],
          ["Valor", formatBRL(order.value)],
          ["MP Order ID", order.mp_order_id || "—"],
          ["Anymarket ID", order.anymarket_id || "—"],
          ["JET Order ID", order.jet_order_id || "—"],
          ["ERP Order ID", order.erp_order_id || "—"],
          ["Status", order.status],
          ["SLA", order.sla_status],
        ].map(([k, v]) => (
          <div key={k} style={{ background: "#060c1a", borderRadius: 7, padding: "8px 10px" }}>
            <div style={{ fontSize: 9, color: "#475569", marginBottom: 2, textTransform: "uppercase" }}>{k}</div>
            <div style={{ fontSize: 12, color: "#cbd5e1", fontFamily: "monospace" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Pipeline detalhado */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", marginBottom: 10, letterSpacing: 1 }}>Fluxo</div>
        {STATUS_FLOW.map((step, i) => {
          const st = getStepStatus(order.status, step.key);
          const c = STEP_COLORS[st];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, opacity: st === "pending" ? 0.35 : 1 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: c + "22", border: `2px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>
                {step.icon}
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#cbd5e1" }}>{step.label}</div>
                <div style={{ fontSize: 10, color: c }}>
                  {st === "ok" ? "✓ Passou" : st === "active" ? "● Atual" : st === "error" ? "✗ Falhou" : "— Pendente"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Eventos */}
      {events.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", marginBottom: 10, letterSpacing: 1 }}>Histórico de Eventos</div>
          {events.slice(-8).map((e, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 9, color: "#334155", fontFamily: "monospace", flexShrink: 0, paddingTop: 1 }}>
                {new Date(e.occurred_at).toLocaleTimeString("pt-BR")}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                <span style={{ color: "#38bdf8" }}>{e.step}</span> → {e.event_type}
                {e.source && <span style={{ color: "#334155" }}> via {e.source}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(order.sla_status === "critical" || order.sla_status === "warning") && (
        <div style={{
          marginTop: 12, background: SLA_COLOR[order.sla_status] + "11",
          border: `1px solid ${SLA_COLOR[order.sla_status]}44`,
          borderRadius: 8, padding: "10px 12px",
        }}>
          <div style={{ fontSize: 11, color: SLA_COLOR[order.sla_status], fontWeight: 600 }}>
            {order.sla_status === "critical" ? "🚨 SLA VENCIDO — acima de 48h" : "⏰ SLA próximo do limite (36-48h)"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [orders, setOrders]       = useState([]);
  const [summary, setSummary]     = useState(null);
  const [loading, setLoading]     = useState(false);
  const [selected, setSelected]   = useState(null);
  const [showBackfill, setShowBackfill] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Filtros
  const [search, setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMP, setFilterMP]   = useState("all");
  const [filterSla, setFilterSla] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterMP !== "all")     params.set("marketplace", filterMP);
      if (filterSla !== "all")    params.set("sla_status", filterSla);
      if (search)                 params.set("search", search);

      const [ordersRes, summaryRes] = await Promise.all([
        fetch(`${API}/orders?${params}`).then(r => r.json()),
        fetch(`${API}/orders/summary`).then(r => r.json()),
      ]);

      setOrders(ordersRes.orders || []);
      setSummary(summaryRes);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Erro ao buscar dados:", err);
    }
    setLoading(false);
  }, [filterStatus, filterMP, filterSla, search]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const t = setInterval(fetchData, 60000);
    return () => clearInterval(t);
  }, [fetchData]);

  const marketplaces = [...new Set(orders.map(o => o.marketplace))].filter(Boolean);
  const s = summary?.summary || {};

  return (
    <div style={{ minHeight: "100vh", background: "#060c1a", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; background: #0a0f1e; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
        input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
      `}</style>

      {showBackfill && (
        <BackfillPanel
          onClose={() => setShowBackfill(false)}
          onDone={() => { setShowBackfill(false); fetchData(); }}
        />
      )}

      {/* HEADER */}
      <div style={{ background: "#080e1c", borderBottom: "1px solid #0f1f3d", padding: "0 28px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 6, height: 30, background: "linear-gradient(180deg,#38bdf8,#6366f1)", borderRadius: 3 }} />
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, letterSpacing: 0.5 }}>MARKETPLACE MONITOR</span>
          <span style={{ fontSize: 10, background: "#0f2040", color: "#38bdf8", padding: "2px 8px", borderRadius: 20, border: "1px solid #38bdf833" }}>LIVE</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {lastUpdate && <span style={{ fontSize: 11, color: "#334155" }}>atualizado {lastUpdate.toLocaleTimeString("pt-BR")}</span>}
          <button onClick={() => setShowBackfill(true)}
            style={{ background: "#0f2040", border: "1px solid #38bdf844", color: "#38bdf8", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="download" size={13} /> Importar Histórico
          </button>
          <button onClick={fetchData} disabled={loading}
            style={{ background: "transparent", border: "1px solid #1e293b", color: "#64748b", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}><Icon name="refresh" size={13} /></span>
            Atualizar
          </button>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>

        {/* SUMMARY CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 12, marginBottom: 24 }}>
          {[
            ["Total", s.total || 0, "#38bdf8"],
            ["🚨 Críticos", s.critical || 0, "#ef4444"],
            ["⚠ Atenção", s.warning || 0, "#f59e0b"],
            ["🔗 Sem JET", s.stuck_anymarket || 0, "#a78bfa"],
            ["🧾 Não retornou", s.invoiced_not_returned || 0, "#fb923c"],
            ["✅ Concluídos", s.completed || 0, "#22c55e"],
          ].map(([label, value, color]) => (
            <div key={label} style={{ background: "#0a0f1e", border: `1px solid ${color}22`, borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>{label}</div>
              <div style={{ fontSize: 28, fontFamily: "monospace", fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* FILTERS */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#475569" }}>
              <Icon name="search" size={13} />
            </span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar pedido..."
              style={{ width: "100%", background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: 7, padding: "7px 10px 7px 28px", color: "#e2e8f0", fontSize: 12, outline: "none" }} />
          </div>

          {/* SLA filter */}
          {[["all","Todos"], ["critical","🚨 Crítico"], ["warning","⚠ Atenção"], ["ok","✅ OK"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilterSla(k)}
              style={{ background: filterSla === k ? "#0f2040" : "transparent", border: `1px solid ${filterSla === k ? "#38bdf8" : "#1e293b"}`, color: filterSla === k ? "#38bdf8" : "#64748b", borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 11, transition: "all 0.15s" }}>
              {l}
            </button>
          ))}

          <select value={filterMP} onChange={e => setFilterMP(e.target.value)}
            style={{ background: "#0a0f1e", border: "1px solid #1e293b", color: "#94a3b8", borderRadius: 7, padding: "6px 12px", fontSize: 11, outline: "none", cursor: "pointer" }}>
            <option value="all">Todos Marketplaces</option>
            {marketplaces.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* LIST + DETAIL */}
        <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 360px" : "1fr", gap: 18 }}>
          <div>
            <div style={{ fontSize: 11, color: "#334155", marginBottom: 8 }}>{orders.length} pedido(s)</div>
            <div style={{ maxHeight: "calc(100vh - 320px)", overflowY: "auto", paddingRight: 4 }}>
              {orders.length === 0 && !loading && (
                <div style={{ textAlign: "center", padding: 60, color: "#1e293b" }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                  <div>Nenhum pedido encontrado</div>
                  <button onClick={() => setShowBackfill(true)}
                    style={{ marginTop: 16, background: "#0f2040", border: "1px solid #38bdf844", color: "#38bdf8", borderRadius: 8, padding: "8px 18px", cursor: "pointer", fontSize: 12 }}>
                    Importar pedidos históricos
                  </button>
                </div>
              )}
              {orders.map(o => (
                <OrderRow key={o.id} order={o}
                  onClick={o => setSelected(p => p?.order_id === o.order_id ? null : o)}
                  selected={selected?.order_id === o.order_id}
                />
              ))}
            </div>
          </div>

          {selected && (
            <DetailPanel order={selected} onClose={() => setSelected(null)} />
          )}
        </div>
      </div>
    </div>
  );
}
