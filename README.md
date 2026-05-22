# Marketplace Monitor

Sistema de monitoramento de pedidos com backfill histórico.

## Fluxo monitorado

```
Marketplace → Anymarket → JET → Onclick (ERP) → Faturado → Retorno Marketplace
```

## Estrutura do projeto

```
marketplace-monitor/
├── backend/
│   ├── src/
│   │   ├── server.js                    ← Entry point
│   │   ├── models/db.js                 ← SQLite (tabelas)
│   │   ├── services/
│   │   │   ├── anymarket.service.js     ← API + webhook Anymarket
│   │   │   ├── jet.service.js           ← API + webhook JET
│   │   │   └── backfill.service.js      ← Importação histórica
│   │   └── routes/
│   │       ├── orders.routes.js         ← GET /api/orders
│   │       ├── backfill.routes.js       ← POST /api/backfill/*
│   │       └── webhook.routes.js        ← POST /api/webhooks/*
│   ├── .env.example
│   └── package.json
└── frontend/
    └── src/App.jsx                      ← React dashboard
```

---

## Configuração inicial

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edite .env com suas credenciais
npm install
npm run dev
```

### 2. Frontend (Vite + React)

```bash
cd frontend
npm create vite@latest . -- --template react
# Substitua src/App.jsx pelo arquivo fornecido
echo "VITE_API_URL=http://localhost:3001/api" > .env
npm install
npm run dev
```

---

## Importação de histórico (Backfill)

Acesse o botão **"Importar Histórico"** no dashboard ou chame diretamente:

```bash
# Backfill completo (Anymarket + JET) dos últimos 30 dias
curl -X POST http://localhost:3001/api/backfill/all \
  -H "Content-Type: application/json" \
  -d '{"dateFrom":"2024-11-01","dateTo":"2024-12-01"}'

# Só Anymarket
curl -X POST http://localhost:3001/api/backfill/anymarket \
  -d '{"dateFrom":"2024-11-01"}'

# Só JET (enriquecimento)
curl -X POST http://localhost:3001/api/backfill/jet \
  -d '{"dateFrom":"2024-11-01"}'
```

### Como funciona o backfill

1. **Anymarket**: busca todos os pedidos por status (APPROVED, INVOICED, SHIPPED...) com paginação.  
   - Se o pedido **já existe** no banco → atualiza apenas se o status mudou  
   - Se **não existe** → insere com a mesma estrutura dos webhooks  
   - Nunca duplica (chave única: `anymarket_id`)

2. **JET**: busca pedidos e cruza pelo `marketplaceOrderId`  
   - Se achar o pedido no banco → enriquece com `jet_order_id`, `erp_order_id` e avança o status  
   - Se não achar → insere como pedido JET (rastreabilidade total)  
   - Status nunca regride (se já é `invoiced`, não volta para `jet`)

3. **SLA recalculado** ao final com base no `created_at` original do pedido

---

## Webhooks

Configure nas plataformas:

| Plataforma | URL |
|------------|-----|
| Anymarket  | `POST https://seudominio.com/api/webhooks/anymarket` |
| JET        | `POST https://seudominio.com/api/webhooks/jet` |

---

## Deploy no Render

1. Crie um **Web Service** no Render apontando para `/backend`
2. Build command: `npm install`
3. Start command: `npm start`
4. Adicione as variáveis de ambiente do `.env.example`
5. Para o banco SQLite persistir, use um **Render Disk** montado em `/home/render/app/data`
   - Adicione `DB_PATH=/data/monitor.db` nas env vars

### Frontend no Render (Static Site)

1. Build command: `npm run build`
2. Publish directory: `dist`
3. Env var: `VITE_API_URL=https://seu-backend.onrender.com/api`

---

## Status dos pedidos

| Status      | Significado |
|-------------|-------------|
| `new`       | Chegou no Anymarket, aguardando aprovação |
| `anymarket` | Aprovado no Anymarket, aguardando JET |
| `jet`       | Recebido na JET, aguardando ERP |
| `erp`       | No Onclick, aguardando faturamento |
| `invoiced`  | NF-e emitida, aguardando retorno ao marketplace |
| `returned`  | Status enviado ao marketplace |
| `ok`        | Fluxo completo ✅ |
| `cancelled` | Cancelado |

---

## SLA

| SLA       | Condição |
|-----------|----------|
| `ok`      | < 36h desde criação |
| `warning` | entre 36h e 48h |
| `critical`| > 48h |

Ajuste no `.env`: `SLA_WARNING_HOURS` e `SLA_CRITICAL_HOURS`
