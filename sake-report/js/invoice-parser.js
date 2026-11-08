// タノムの請求書PDFから明細を取り出す
// pdf.js で文字の座標を取り、表の見出し（取引日・数量・単価…）の位置から列を判定する。
import { cleanName, nameKey, splitCode } from './normalize.js';

const pdfjsLib = window.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const DATE_RE = /^\d{4}\/\d{1,2}\/\d{1,2}$/;
const yen = (s) => Number(String(s).replace(/[¥,\s]/g, '')) || 0;

async function pageItems(page) {
  const tc = await page.getTextContent();
  return tc.items
    .filter((it) => it.str && it.str.trim() !== '')
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
    }));
}

// 同じ高さの文字をまとめて1行の文字列にする（ヘッダー情報の読み取り用）
function toLines(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) < 3) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map((l) => l.items.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '));
}

// 見出し行の各列の中心x座標を探す
function findColumns(items) {
  const find = (label) => items.find((i) => i.str.replace(/\s/g, '') === label);
  const h = {
    no: find('No'),
    date: find('取引日'),
    qty: find('数量'),
    price: find('単価'),
    unit: find('単位'),
    tax: find('税率'),
    amount: find('金額'),
  };
  if (!h.date || !h.qty || !h.amount) return null;
  const center = (i) => i.x + i.w / 2;
  const cols = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v ? center(v) : null]));
  // 商品名列は「取引日」の右端から「数量」列の手前まで
  cols.nameFrom = h.date.x + h.date.w + 8;
  cols.nameTo = h.qty.x - 4;
  cols.headerY = h.date.y;
  return cols;
}

function nearestCol(x, cols) {
  const keys = ['qty', 'price', 'unit', 'tax', 'amount'];
  let best = null;
  let bestD = Infinity;
  for (const k of keys) {
    if (cols[k] == null) continue;
    const d = Math.abs(cols[k] - x);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

function parseTable(items, cols) {
  // 表の下端（小計・税区分の見出し）より上だけを対象にする
  const footer = items
    .filter((i) => /^(小計|税区分)$/.test(i.str.trim()) && i.y < cols.headerY)
    .reduce((m, i) => Math.max(m, i.y), -Infinity);
  const body = items.filter((i) => i.y < cols.headerY - 3 && i.y > footer + 3);

  // 行の起点 = 取引日の列にある日付
  const anchors = body
    .filter((i) => DATE_RE.test(i.str.trim()) && i.x < cols.nameFrom)
    .sort((a, b) => b.y - a.y);

  const rows = anchors.map((a, idx) => {
    const top = idx === 0 ? cols.headerY - 3 : (anchors[idx - 1].y + a.y) / 2;
    const bottom = idx === anchors.length - 1 ? footer + 3 : (a.y + anchors[idx + 1].y) / 2;
    const band = body.filter((i) => i.y <= top && i.y > bottom);

    const nameParts = band
      .filter((i) => i.x >= cols.nameFrom - 2 && i.x < cols.nameTo)
      .sort((p, q) => q.y - p.y || p.x - q.x);
    // 同じ行で離れている文字の間は空白、折り返した行は詰めて連結
    let nameText = '';
    let prev = null;
    for (const p of nameParts) {
      if (prev && Math.abs(prev.y - p.y) < 3 && p.x > prev.x + prev.w + 2) nameText += ' ';
      nameText += p.str;
      prev = p;
    }

    const vals = {};
    for (const i of band.filter((i) => i.x >= cols.nameTo)) {
      const k = nearestCol(i.x + i.w / 2, cols);
      vals[k] = ((vals[k] || '') + i.str).trim();
    }
    const noItem = band.find((i) => i.x < a.x - 2 && /^\d+$/.test(i.str.trim()));

    return {
      lineNo: noItem ? Number(noItem.str) : idx + 1,
      date: a.str.trim(),
      text: nameText.trim(),
      qty: Number(String(vals.qty || '').replace(/,/g, '')) || 0,
      unitPrice: yen(vals.price),
      unit: (vals.unit || '').trim(),
      taxRate: Number(String(vals.tax || '').replace('%', '')) || null,
      amount: yen(vals.amount),
    };
  });
  return rows;
}

function headerInfo(text) {
  const pick = (re) => (text.match(re) || [])[1] || '';
  return {
    invoiceNo: pick(/請求番号[：:]\s*(\d+)/),
    invoiceDate: pick(/請求日[：:]\s*(\d{4}\/\d{1,2}\/\d{1,2})/),
    customer: pick(/\n\s*([^\n]+?)\s*様/),
    total: yen(pick(/合計金額\s*(¥[\d,]+)/)),
  };
}

export async function parseInvoicePdf(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let allText = '';
  const rows = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const items = await pageItems(await pdf.getPage(p));
    allText += toLines(items).join('\n') + '\n';
    const cols = findColumns(items);
    if (cols) rows.push(...parseTable(items, cols));
  }

  const head = headerInfo(allText);
  if (!/タノム/.test(allText) && !head.invoiceNo) {
    throw new Error('タノムの請求書として読み取れませんでした');
  }

  const lines = rows.map((r, i) => {
    const { code, name } = splitCode(r.text);
    return {
      id: `${head.invoiceNo}-${i + 1}`,
      invoiceNo: head.invoiceNo,
      lineNo: r.lineNo,
      date: r.date.replace(/\/(\d)(?=\/|$)/g, '/0$1'),
      code,
      rawName: name,
      name: cleanName(name),
      key: nameKey(name),
      qty: r.qty,
      unit: r.unit,
      unitPrice: r.unitPrice,
      taxRate: r.taxRate,
      amount: r.amount,
    };
  });

  // 検算：明細金額の合計と小計の一致
  const subtotal = yen((allText.match(/小計\s*(¥[\d,]+)/) || [])[1]);
  const sum = lines.reduce((s, l) => s + l.amount, 0);

  return { ...head, lines, subtotal, sumOk: subtotal ? subtotal === sum : null };
}
