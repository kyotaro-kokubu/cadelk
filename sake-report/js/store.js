// データ保存（サンプル段階は端末内の localStorage）
import { nameKey } from './normalize.js';

const KEY = 'cadelk.sakeReport.v1';

function empty() {
  return { products: [], lines: [], invoices: {} };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    return { ...empty(), ...JSON.parse(raw) };
  } catch {
    return empty();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

export function getState() {
  return state;
}

// ---- 商品マスタ ----
export function findProduct(line) {
  const { products } = state;
  if (line.code) {
    const byCode = products.find((p) => p.code && p.code === line.code);
    if (byCode) return byCode;
  }
  const k = line.key;
  return products.find((p) => p.keys.includes(k)) || null;
}

export function upsertProduct(p) {
  const i = state.products.findIndex((x) => x.id === p.id);
  if (i >= 0) state.products[i] = p;
  else state.products.push({ ...p, id: p.id || crypto.randomUUID() });
  save();
}

export function deleteProduct(id) {
  state.products = state.products.filter((p) => p.id !== id);
  save();
}

// 別表記を既存商品に紐付ける
export function addAlias(productId, rawName) {
  const p = state.products.find((x) => x.id === productId);
  if (!p) return;
  const k = nameKey(rawName);
  if (!p.keys.includes(k)) p.keys.push(k);
  save();
}

// ---- 請求書・明細 ----
export function hasInvoice(no) {
  return !!state.invoices[no];
}

export function saveInvoice(inv) {
  state.invoices[inv.invoiceNo] = {
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate,
    customer: inv.customer,
    total: inv.total,
    importedAt: new Date().toISOString(),
  };
  state.lines = state.lines.filter((l) => l.invoiceNo !== inv.invoiceNo);
  state.lines.push(...inv.lines);
  save();
}

export function deleteInvoice(no) {
  delete state.invoices[no];
  state.lines = state.lines.filter((l) => l.invoiceNo !== no);
  save();
}

// ---- バックアップ ----
export function exportJson() {
  return JSON.stringify(state, null, 2);
}

export function importJson(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.products) || !Array.isArray(data.lines)) {
    throw new Error('バックアップ形式ではありません');
  }
  state = { ...empty(), ...data };
  save();
}
