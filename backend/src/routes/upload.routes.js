// backend/src/routes/upload.routes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const pool = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const authService = require('../services/auth.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Remove sufixo de pacote: LU-123-1 → LU-123, 456-01 → 456
function normalizeOrderId(id) {
  if (!id) return id;
  const s = id.toString().trim();
  const hifens = (s.match(/-/g) || []).length;
  return hifens >= 2 ? s.replace(/-\d+$/, '') : s;
}

// Limpa valor monetário: "R$ 1.234,56" → 1234.56
function parseValor(str) {
  if (!str) return 0;
  return parseFloat(str.toString().replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;
}

// Detecção de marketplace
function detectarMarketplace(keys) {
  const joined = keys.join('|').toLowerCase();

  if (joined.includes('número do pedido') || joined.includes('numero do pedido') || joined.includes('data do pacote')) {
    return 'MAGAZINE_LUIZA';
  }
  if (keys.includes('Pedido Site MM') || (keys.includes('Pedido') && joined.includes('id do seller'))) {
    return 'MADEIRAMADEIRA';
  }
  if (joined.includes('pedido parceiro') || joined.includes('parceiro portal') || joined.includes('pedido_parceiro')) {
    return 'WEBCONTINENTAL';
  }
  if (joined.includes('order-id') || joined.includes('order id') || joined.includes('amazon')) {
    return 'AMAZON';
  }
  if (joined.includes('n.º de venda') || joined.includes('numero de venda') || keys[0] === '__EMPTY') {
    return 'MERCADO_LIVRE';
  }
  if (joined.includes('id do pedido') && joined.includes('status do pedido')) {
    return 'SHOPEE';
  }
  return 'DESCONHECIDO';
}

// Extractors para cada marketplace
function extractMagalu(row) {
  const get = (key) => {
    const found = Object.keys(row).find(k =>
      k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() ===
      key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
    );
    return found ? row[found]?.toString().trim() : null;
  };

  const numeroPedido = get('Número do pedido') || get('Numero do pedido');
  const numeroPacote = get('Número do pacote') || get('Numero do pacote');
  const status = get('Status pacote no momento que o relatório foi solicitado') || 'DESCONHECIDO';
  const valorStr = get('Valor total do Pacote') || get('Valor total dos Produtos do pacote');
  const cliente = get('Nome do cliente') || 'N/A';
  const dataStr = get('Data do Pacote');
  const pedidoId = numeroPedido || numeroPacote;

  return {
    pedido_id_original: pedidoId,
    pedido_id_normalizado: pedidoId ? normalizeOrderId(pedidoId) : null,
    marketplace: 'MAGAZINE_LUIZA',
    status,
    valor_total: parseValor(valorStr),
    cliente: (cliente || 'N/A').substring(0, 100),
    data: dataStr || null,
    raw: row
  };
}

function extractWebContinental(row) {
  let pedidoId = null, pedidoSite = null, cliente = 'N/A', valor = 0, status = 'DESCONHECIDO', data = null;
  for (const [key, value] of Object.entries(row)) {
    const k = key.toString().trim();
    const kl = k.toLowerCase();
    if (k === 'Pedido Parceiro' || kl === 'pedido parceiro') pedidoId = value?.toString().trim();
    if (k === 'Pedido Site' || kl === 'pedido site') pedidoSite = value?.toString().trim();
    if (k === 'Cliente' || kl === 'cliente') cliente = value?.toString().trim() || 'N/A';
    if (k === 'Total do Pedido' || kl === 'total do pedido') valor = parseValor(value);
    if (k === 'Status Atual' || kl === 'status atual') status = value?.toString().trim() || 'DESCONHECIDO';
    if (k === 'Data Criação' || kl === 'data criação' || kl === 'data criacao') data = value?.toString().trim() || null;
  }
  const idFinal = pedidoId || pedidoSite;
  return {
    pedido_id_original: idFinal,
    pedido_id_normalizado: idFinal ? normalizeOrderId(idFinal) : null,
    marketplace: 'WEBCONTINENTAL',
    status,
    valor_total: valor,
    cliente: (cliente || 'N/A').substring(0, 100),
    data,
    raw: row
  };
}

function extractMadeiraMadeira(row) {
  let pedidoId = null, cliente = 'N/A', valor = 0, status = 'DESCONHECIDO', data = null;
  for (const [key, value] of Object.entries(row)) {
    const k = key.toString().trim();
    const kl = k.toLowerCase();
    if (k === 'Pedido' || kl === 'pedido') pedidoId = value?.toString().trim();
    if (kl.includes('cliente') && !kl.includes('cpf') && !kl.includes('status')) cliente = value?.toString().trim() || 'N/A';
    if (kl === 'valor pedido' || kl === 'valor_pedido') valor = parseValor(value);
    if (k === 'Status' || kl === 'status') status = value?.toString().trim() || 'DESCONHECIDO';
    if (kl === 'data pedido' || kl === 'data_pedido') data = value?.toString().trim() || null;
  }
  return {
    pedido_id_original: pedidoId,
    pedido_id_normalizado: pedidoId ? normalizeOrderId(pedidoId) : null,
    marketplace: 'MADEIRAMADEIRA',
    status,
    valor_total: valor,
    cliente: (cliente || 'N/A').substring(0, 100),
    data,
    raw: row
  };
}

function extractAmazon(row) {
  let pedidoId = null, cliente = 'N/A', valor = 0, data = null;
  for (const [key, value] of Object.entries(row)) {
    const k = key.toString().trim().toLowerCase();
    if (k === 'order-id') pedidoId = value?.toString().trim();
    if (k === 'buyer-name') cliente = value?.toString().trim() || 'N/A';
    if (k === 'item-price') valor += parseFloat(value?.toString().trim()) || 0;
    if (k === 'purchase-date') data = value?.toString().trim() || null;
  }
  return {
    pedido_id_original: pedidoId,
    pedido_id_normalizado: pedidoId ? normalizeOrderId(pedidoId) : null,
    marketplace: 'AMAZON',
    status: 'ATIVO',
    valor_total: valor,
    cliente: (cliente || 'N/A').substring(0, 100),
    data,
    raw: row
  };
}

function extractShopee(row) {
  let pedidoId = null, status = 'DESCONHECIDO', valor = 0, cliente = 'N/A', data = null, rastreio = null;
  for (const [key, value] of Object.entries(row)) {
    const k = key.toString().trim();
    const kl = k.toLowerCase();
    if (k === 'ID do pedido' || kl === 'id do pedido') pedidoId = value?.toString().trim();
    if (k === 'Status do pedido' || kl === 'status do pedido') status = value?.toString().trim() || 'DESCONHECIDO';
    if (k === 'Valor Total' || kl === 'valor total' || kl.includes('valor')) {
      const valStr = value?.toString().replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
      valor = parseFloat(valStr) || 0;
    }
    if (k === 'Nome de usuário (comprador)' || k === 'Nome do destinatário' || kl.includes('comprador') || kl.includes('cliente')) {
      cliente = value?.toString().trim() || 'N/A';
    }
    if (k === 'Data de criação do pedido' || kl.includes('data de criação')) data = value?.toString().trim() || null;
    if (k === 'Número de rastreamento' || kl.includes('rastreamento')) rastreio = value?.toString().trim() || null;
  }
  if (!pedidoId) {
    const firstVal = Object.values(row)[0]?.toString().trim();
    if (firstVal && firstVal.length >= 5) pedidoId = firstVal;
  }
  return {
    pedido_id_original: pedidoId,
    pedido_id_normalizado: pedidoId ? normalizeOrderId(pedidoId) : null,
    marketplace: 'SHOPEE',
    status,
    valor_total: valor,
    cliente: (cliente || 'N/A').substring(0, 100),
    data,
    rastreio,
    raw: row
  };
}

function extractMercadoLivre(row) {
  let pedidoId = null, status = 'DESCONHECIDO', valor = 0, data = null, cliente = 'N/A';
  for (const [key, value] of Object.entries(row)) {
    const k = key.toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (k === 'n.o de venda' || k === 'no de venda' || (k.includes('n.') && k.includes('venda'))) {
      pedidoId = value?.toString().trim();
    }
    if (k === 'estado') status = value?.toString().trim() || 'DESCONHECIDO';
    if (k.startsWith('receita por produtos')) valor = parseFloat(value?.toString().trim()) || 0;
    if (k === 'data da venda') data = value?.toString().trim() || null;
    if (k.includes('comprador') && !k.includes('acrescimo')) cliente = value?.toString().trim() || 'N/A';
  }
  if (!pedidoId) {
    const firstVal = Object.values(row)[0]?.toString().trim();
    if (firstVal && firstVal.length >= 10 && !isNaN(firstVal)) pedidoId = firstVal;
  }
  return {
    pedido_id_original: pedidoId,
    pedido_id_normalizado: pedidoId ? normalizeOrderId(pedidoId) : null,
    marketplace: 'MERCADO_LIVRE',
    status,
    valor_total: valor,
    cliente: (cliente || 'N/A').substring(0, 100),
    data
  };
}

// ─── ROTA PRINCIPAL ───
router.post('/compare', authService.authenticate, upload.single('planilha'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

    const fileExt = req.file.originalname.toLowerCase().split('.').pop();
    const bufferStr = req.file.buffer.slice(0, 500).toString('latin1');
    const isSemicolonCsv = fileExt === 'csv' && bufferStr.includes(';');
    const isCommaCsv = fileExt === 'csv' && !bufferStr.includes(';');
    const isTsvOrTxt = fileExt === 'txt' || fileExt === 'tsv';

    let rawData = [];

    if (isTsvOrTxt) {
      const text = req.file.buffer.toString('utf8');
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split('\t').map(h => h.trim());
      rawData = lines.slice(1).map(line => {
        const values = line.split('\t');
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i]?.trim() || ''; });
        return obj;
      }).filter(row => Object.values(row).some(v => v));
    } else if (isSemicolonCsv) {
      const text = req.file.buffer.toString('latin1');
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
      rawData = lines.slice(1).map(line => {
        const values = line.split(';').map(v => v.replace(/^"|"$/g, '').trim());
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] || ''; });
        return obj;
      }).filter(row => Object.values(row).some(v => v));
    } else if (isCommaCsv) {
      const parseCSVLine = (line) => {
        const result = [];
        let cur = '', inQuote = false;
        for (const ch of line) {
          if (ch === '"') { inQuote = !inQuote; }
          else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
          else cur += ch;
        }
        result.push(cur.trim());
        return result;
      };
      const text = req.file.buffer.toString('utf8');
      const lines = text.split('\n').filter(l => l.trim());
      const headers = parseCSVLine(lines[0]);
      rawData = lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h] = values[i] || ''; });
        return obj;
      }).filter(row => Object.values(row).some(v => v));
    } else {
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      let tempData = xlsx.utils.sheet_to_json(worksheet, { defval: '' });
      if (tempData.length && Object.keys(tempData[0])[0] === '__EMPTY') {
        tempData = xlsx.utils.sheet_to_json(worksheet, { defval: '', range: 5 });
      }
      rawData = tempData;
    }

    if (!rawData.length) return res.status(400).json({ error: 'Planilha vazia ou formato inválido' });

    const keys = Object.keys(rawData[0]);
    const tipoPlanilha = detectarMarketplace(keys);

    if (tipoPlanilha === 'DESCONHECIDO') {
      return res.status(400).json({
        error: `Marketplace não reconhecido. Formatos suportados: Amazon, MadeiraMadeira, Magazine Luiza, WebContinental, Mercado Livre, Shopee`,
        debug: { fileName: req.file.originalname, colunas: keys.slice(0, 5) }
      });
    }

    const extractors = {
      MAGAZINE_LUIZA: extractMagalu,
      WEBCONTINENTAL: extractWebContinental,
      MADEIRAMADEIRA: extractMadeiraMadeira,
      AMAZON: extractAmazon,
      MERCADO_LIVRE: extractMercadoLivre,
      SHOPEE: extractShopee
    };

    const pedidosPlanilha = rawData.map(extractors[tipoPlanilha]);
    const pedidosValidos = pedidosPlanilha.filter(p =>
      p.pedido_id_original &&
      p.pedido_id_original !== 'N/A' &&
      p.pedido_id_original !== 'undefined' &&
      p.pedido_id_original.toString().length > 3
    );

    if (!pedidosValidos.length) {
      return res.status(400).json({
        error: 'Não foi possível identificar IDs de pedidos na planilha.',
        debug: { tipoPlanilha, amostra: rawData[0] }
      });
    }

    const possiveisIds = [...new Set(pedidosValidos.flatMap(p => [
      p.pedido_id_original,
      p.pedido_id_normalizado,
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `${p.pedido_id_original}-${n}`)
    ].filter(Boolean)))];

    const result = await pool.query(
      `SELECT DISTINCT pedido_id FROM tracking_events WHERE pedido_id = ANY($1::text[])`,
      [possiveisIds]
    );
    const integradosSet = new Set(result.rows.map(r => r.pedido_id));

    const naoIntegrados = pedidosValidos.filter(p => {
      const variantes = [
        p.pedido_id_original,
        p.pedido_id_normalizado,
        ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `${p.pedido_id_original}-${n}`)
      ].filter(Boolean);
      return variantes.every(id => !integradosSet.has(id));
    });

    res.json({
      tipo_planilha: tipoPlanilha,
      total_planilha: pedidosValidos.length,
      total_integrados: pedidosValidos.length - naoIntegrados.length,
      total_nao_integrados: naoIntegrados.length,
      nao_integrados: naoIntegrados.map(p => ({
        pedido_id_original: p.pedido_id_original,
        pedido_id_normalizado: p.pedido_id_normalizado,
        marketplace: p.marketplace,
        status: p.status,
        valor_total: p.valor_total,
        cliente: p.cliente,
        data: p.data
      }))
    });

  } catch (err) {
    console.error('Erro no upload:', err);
    res.status(500).json({ error: 'Erro ao processar: ' + err.message });
  }
});

module.exports = router;