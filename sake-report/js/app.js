import { parseInvoicePdf } from './invoice-parser.js';
import * as store from './store.js';
import { KINDS, categoryFor, guessProduct, bottlesOf } from './master.js';
import { aggregate, fiscalYears, fiscalYearOf, UNCLASSIFIED } from './aggregate.js';
import { nameKey, cleanName } from './normalize.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, digits = 0) =>
  n ? n.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '';

let pending = []; // 取込前の請求書
const ui = { metric: 'bottles', mode: 'category', fy: null };

// ---------- タブ ----------
document.querySelectorAll('nav.tabs button').forEach((b) =>
  b.addEventListener('click', () => showTab(b.dataset.tab)),
);
function showTab(name) {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  render();
  window.scrollTo(0, 0);
}

// ---------- 取込 ----------
$('#pdf-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      const inv = await parseInvoicePdf(await f.arrayBuffer());
      inv.fileName = f.name;
      pending = pending.filter((p) => p.invoiceNo !== inv.invoiceNo);
      pending.push(inv);
    } catch (err) {
      pending.push({ error: `${f.name}: ${err.message}` });
    }
  }
  render();
});

function lineStatus(l) {
  const p = store.findProduct(l);
  if (!p) return `<button class="chip warn" data-register="${esc(l.id)}">未登録 → 登録</button>`;
  return `<span class="chip ok">${esc(categoryFor(p.kind, p.volumeMl))}</span>`;
}

function renderPending() {
  const box = $('#import-results');
  const valid = pending.filter((p) => !p.error);
  const dupCount = valid.filter((p) => store.hasInvoice(p.invoiceNo)).length;
  const newCount = valid.length - dupCount;
  const summary =
    valid.length > 1 || dupCount
      ? `<div class="card summary ${dupCount ? 'has-dup' : ''}">
          <p><b>${valid.length}件</b>を読み込みました：新規 <b>${newCount}件</b>${
            dupCount ? ` ／ <span class="warn-text">取込済み <b>${dupCount}件</b></span>` : ''
          }</p>
          ${dupCount ? '<p class="muted">取込済みの請求書は、そのままでは保存しません（二重計上の防止）。内容が変わった場合だけ「上書き保存」を押してください。</p>' : ''}
          <div class="row end">
            <button class="btn" data-discard-all>すべて取り消し</button>
            ${newCount ? `<button class="btn primary" data-commit-new>新規${newCount}件をまとめて保存</button>` : ''}
          </div>
        </div>`
      : '';

  box.innerHTML =
    summary +
    pending
      .map((inv, idx) => {
        if (inv.error) return `<div class="card error">${esc(inv.error)}</div>`;
        const dup = store.hasInvoice(inv.invoiceNo);
        const prev = dup ? store.getState().invoices[inv.invoiceNo] : null;
        const unreg = inv.lines.filter((l) => !store.findProduct(l)).length;
        return `
      <details class="card pending ${dup ? 'dup' : ''}" ${pending.length <= 2 ? 'open' : ''}>
        <summary>
          ${dup ? '<span class="dup-label">取込済み</span>' : '<span class="new-label">新規</span>'}
          <b>${esc(inv.invoiceDate)}</b> ${esc(inv.customer)} 様
          <small class="muted">No.${esc(inv.invoiceNo)} ／ ${inv.lines.length}明細 ／ ¥${fmt(inv.total)}${unreg ? ` ／ 未登録${unreg}` : ''}</small>
        </summary>
        <p class="muted">
          ${inv.sumOk === false ? '<b class="warn-text">明細の合計が小計と一致しません。読み取り結果を確認してください。</b><br>' : ''}
          ${dup ? `<b class="warn-text">この請求書は ${esc(new Date(prev.importedAt).toLocaleString('ja-JP'))} に取込済みです。</b>` : ''}
        </p>
        <ul class="lines">
          ${inv.lines
            .map(
              (l) => `<li>
              <div class="ln-name">${esc(l.name)}</div>
              <div class="ln-meta"><span>${esc(l.date)}</span><span>${l.qty}${esc(l.unit)}</span><span>¥${fmt(l.amount)}</span>${lineStatus(l)}</div>
            </li>`,
            )
            .join('')}
        </ul>
        ${unreg ? `<p class="muted">未登録の商品が${unreg}件あります。登録しなくても保存できます（後から登録すれば集計に反映されます）。</p>` : ''}
        <div class="row end">
          <button class="btn" data-discard="${idx}">取り消し</button>
          ${
            dup
              ? `<button class="btn danger" data-commit="${idx}">上書き保存</button>`
              : `<button class="btn primary" data-commit="${idx}">保存する</button>`
          }
        </div>
      </details>`;
      })
      .join('');
}

$('#import-results').addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.commit) {
    const inv = pending[Number(t.dataset.commit)];
    if (store.hasInvoice(inv.invoiceNo) && !confirm(`請求書 ${inv.invoiceNo} は取込済みです。上書きしますか？`)) return;
    store.saveInvoice(inv);
    pending.splice(Number(t.dataset.commit), 1);
    render();
  } else if ('commitNew' in t.dataset) {
    const fresh = pending.filter((p) => !p.error && !store.hasInvoice(p.invoiceNo));
    fresh.forEach((p) => store.saveInvoice(p));
    pending = pending.filter((p) => !fresh.includes(p));
    render();
  } else if ('discardAll' in t.dataset) {
    pending = [];
    render();
  } else if (t.dataset.discard) {
    pending.splice(Number(t.dataset.discard), 1);
    render();
  } else if (t.dataset.register) {
    const line = pending.flatMap((p) => p.lines || []).find((l) => l.id === t.dataset.register);
    if (line) openProductDialog({ fromLine: line });
  }
});

const openMonths = new Set();
function renderInvoiceList() {
  const invs = Object.values(store.getState().invoices).sort(
    (a, b) => (b.invoiceDate || '').localeCompare(a.invoiceDate || '') || b.invoiceNo.localeCompare(a.invoiceNo),
  );
  if (!invs.length) {
    $('#invoice-list').innerHTML = '<p class="muted">まだありません</p>';
    return;
  }
  const byMonth = new Map();
  for (const i of invs) {
    const m = (i.invoiceDate || '不明').slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(i);
  }
  if (!openMonths.size) openMonths.add([...byMonth.keys()][0]); // 最新月だけ開く
  $('#invoice-list').innerHTML = [...byMonth.entries()]
    .map(([m, list]) => {
      const [y, mm] = m.split('/');
      const label = mm ? `${y}年${Number(mm)}月` : m;
      const total = list.reduce((s, i) => s + (i.total || 0), 0);
      return `<details class="month" data-month="${esc(m)}" ${openMonths.has(m) ? 'open' : ''}>
        <summary><span class="m-label">${label}</span><span class="m-meta">${list.length}件 ／ ¥${fmt(total)}</span></summary>
        <ul class="simple">${list
          .map(
            (i) => `<li><div><b>${esc(i.invoiceDate.slice(5))}</b> ${esc(i.customer)} 様<br><small class="muted">No.${esc(i.invoiceNo)} ／ ¥${fmt(i.total)}</small></div>
            <button class="btn small" data-del-invoice="${esc(i.invoiceNo)}">削除</button></li>`,
          )
          .join('')}</ul>
      </details>`;
    })
    .join('');
}
$('#invoice-list').addEventListener(
  'toggle',
  (e) => {
    const m = e.target.dataset?.month;
    if (!m) return;
    if (e.target.open) openMonths.add(m);
    else openMonths.delete(m);
  },
  true,
);
$('#invoice-list').addEventListener('click', (e) => {
  const no = e.target.dataset?.delInvoice;
  if (no && confirm(`請求書 ${no} の取込を取り消しますか？`)) {
    store.deleteInvoice(no);
    render();
  }
});

// ---------- 集計 ----------
$('#metric-seg').addEventListener('click', (e) => setSeg(e, 'metric'));
$('#mode-seg').addEventListener('click', (e) => setSeg(e, 'mode'));
function setSeg(e, key) {
  const b = e.target.closest('button');
  if (!b) return;
  ui[key] = b.dataset.v;
  b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  renderReport();
}
$('#fy-select').addEventListener('change', (e) => {
  ui.fy = Number(e.target.value);
  renderReport();
});

function currentFy() {
  const now = new Date();
  return fiscalYearOf(`${now.getFullYear()}/${now.getMonth() + 1}/1`);
}

function renderReport() {
  const lines = store.getState().lines;
  const years = [...new Set([currentFy(), ...fiscalYears(lines)])].sort((a, b) => b - a);
  if (ui.fy == null) ui.fy = years[0];
  $('#fy-select').innerHTML = years
    .map((y) => `<option value="${y}" ${y === ui.fy ? 'selected' : ''}>${y}年度（${y}/4〜${y + 1}/3）</option>`)
    .join('');

  const agg = aggregate(lines, ui.fy, ui.mode);
  const digits = ui.metric === 'liters' ? 2 : 0;
  const val = (t) => fmt(t[ui.metric], digits);
  const mLabel = (m) => {
    const [y, mm] = m.split('/');
    return `${y.slice(2)}/${Number(mm)}`;
  };

  $('#report').innerHTML = `
    <div class="table-wrap">
      <table class="report">
        <thead><tr><th class="sticky">${ui.mode === 'kind' ? '品目' : '区分'}</th>${agg.months
          .map((m) => `<th>${mLabel(m)}</th>`)
          .join('')}<th>合計</th></tr></thead>
        <tbody>
          ${agg.rows
            .map(
              (r) =>
                `<tr class="${r.name === UNCLASSIFIED ? 'unclassified' : ''}"><th class="sticky">${esc(r.name)}</th>${agg.months
                  .map((m) => `<td>${val(r.months[m])}</td>`)
                  .join('')}<td class="sum">${val(r.total)}</td></tr>`,
            )
            .join('')}
        </tbody>
        <tfoot><tr><th class="sticky">合計</th>${agg.months
          .map((m) => `<td>${val(agg.monthTotals[m])}</td>`)
          .join('')}<td class="sum">${val(agg.total)}</td></tr></tfoot>
      </table>
    </div>
    <p class="muted small-note">売上は税抜の明細金額です。${
      agg.rows.some((r) => r.name === UNCLASSIFIED && r.total.bottles)
        ? '「未登録の商品」は商品タブで登録すると区分に振り分けられます（リットルは登録後に計算されます）。'
        : ''
    }</p>`;

  // スマホでは最新のデータがある月が見えるように横スクロール
  const lastIdx = agg.months.findLastIndex((m) => agg.monthTotals[m].bottles);
  const wrap = $('#report .table-wrap');
  const th = wrap.querySelectorAll('thead th')[lastIdx + 1];
  if (th && lastIdx > 2) wrap.scrollLeft = th.offsetLeft - wrap.clientWidth / 2;
}

$('#csv-btn').addEventListener('click', () => {
  const agg = aggregate(store.getState().lines, ui.fy, ui.mode);
  const label = { bottles: '本数', liters: 'リットル', sales: '売上(税抜)' }[ui.metric];
  const rows = [[`${ui.fy}年度 ${label}`, ...agg.months, '合計']];
  const v = (t) => (ui.metric === 'liters' ? t[ui.metric].toFixed(2) : t[ui.metric]);
  for (const r of agg.rows) rows.push([r.name, ...agg.months.map((m) => v(r.months[m])), v(r.total)]);
  rows.push(['合計', ...agg.months.map((m) => v(agg.monthTotals[m])), v(agg.total)]);
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download(`販売数量_${ui.fy}年度_${label}.csv`, csv, 'text/csv');
});

// ---------- 商品 ----------
function unregisteredGroups() {
  const groups = new Map();
  for (const l of store.getState().lines) {
    if (store.findProduct(l)) continue;
    const g = groups.get(l.key) || { line: l, count: 0, bottles: 0 };
    g.count++;
    g.bottles += Number(l.qty) || 0;
    groups.set(l.key, g);
  }
  return [...groups.values()].sort((a, b) => b.bottles - a.bottles);
}

function renderProducts() {
  const groups = unregisteredGroups();
  const badge = $('#unreg-badge');
  badge.hidden = !groups.length;
  badge.textContent = groups.length;

  $('#unregistered').innerHTML = groups.length
    ? `<div class="card attention">
        <h2>未登録の商品 <small>${groups.length}件</small></h2>
        <p class="muted">容量と品目を登録すると、集計に反映されます。</p>
        <ul class="simple">${groups
          .map(
            (g) => `<li><div>${esc(g.line.name)}<br><small class="muted">${g.count}明細 ／ ${g.bottles}${esc(g.line.unit)}</small></div>
            <button class="btn small primary" data-reg-key="${esc(g.line.key)}">登録</button></li>`,
          )
          .join('')}</ul></div>`
    : '';

  const q = nameKey($('#product-search').value || '');
  const all = store.getState().products;
  const products = all
    .filter((p) => !q || p.keys.some((k) => k.includes(q)) || nameKey(p.name).includes(q) || p.code === $('#product-search').value.trim())
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const LIMIT = 100;
  $('#product-count').textContent = q ? `${products.length}件該当 ／ 全${all.length}件` : `全${all.length}件`;
  $('#product-list').innerHTML = products.length
    ? `<ul class="simple">${products
        .slice(0, LIMIT)
        .map(
          (p) => `<li><div>${esc(p.name)}<br><small class="muted">${p.volumeMl}ml ／ ${esc(p.kind)} ／ ${esc(
            categoryFor(p.kind, p.volumeMl),
          )}${p.caseSize ? ` ／ 入数${p.caseSize}` : ''}${p.code ? ` ／ ${esc(p.code)}` : ''}</small></div>
          <button class="btn small" data-edit="${esc(p.id)}">編集</button></li>`,
        )
        .join('')}</ul>${
        products.length > LIMIT ? `<p class="muted">先頭${LIMIT}件を表示中。商品名やコードで絞り込んでください。</p>` : ''
      }`
    : '<p class="muted">該当する商品はありません</p>';
}
$('#product-search').addEventListener('input', renderProducts);
$('#tab-products').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.regKey) {
    const g = unregisteredGroups().find((x) => x.line.key === b.dataset.regKey);
    if (g) openProductDialog({ fromLine: g.line });
  } else if (b.dataset.edit) {
    openProductDialog({ product: store.getState().products.find((p) => p.id === b.dataset.edit) });
  }
});

// ---------- 商品ダイアログ ----------
const dlg = $('#product-dialog');
const form = $('#product-form');
form.kind.innerHTML = KINDS.map((k) => `<option>${k}</option>`).join('');
const updateCategory = () => ($('#pd-category').textContent = categoryFor(form.kind.value, form.volumeMl.value));
form.kind.addEventListener('change', updateCategory);
form.volumeMl.addEventListener('input', updateCategory);

let dialogCtx = null;
function openProductDialog(ctx) {
  dialogCtx = ctx;
  const p = ctx.product;
  const l = ctx.fromLine;
  const g = l ? guessProduct(l.rawName) : null;
  $('#pd-title').textContent = p ? '商品を編集' : '商品を登録';
  form.name.value = p?.name ?? cleanName(l.rawName);
  form.code.value = p?.code ?? l?.code ?? '';
  form.volumeMl.value = p?.volumeMl ?? g.volumeMl;
  form.caseSize.value = p?.caseSize ?? g.caseSize;
  form.kind.value = p?.kind ?? g.kind;
  updateCategory();

  const others = store.getState().products;
  $('#pd-alias').innerHTML =
    l && others.length
      ? `<label>または既存の商品と同じものとして紐付け
          <select name="alias"><option value="">（紐付けない）</option>${others
            .map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`)
            .join('')}</select></label>`
      : p
        ? `<button type="button" class="btn small danger" id="pd-delete">この商品を削除</button>`
        : '';
  $('#pd-delete')?.addEventListener('click', () => {
    if (confirm('この商品を削除しますか？（取込済みの明細は「未登録」に戻ります）')) {
      store.deleteProduct(p.id);
      dlg.close('cancel');
      render();
    }
  });
  dlg.showModal();
}

dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok' || !dialogCtx) return;
  const { product, fromLine } = dialogCtx;
  const alias = form.alias?.value;
  if (fromLine && alias) {
    store.addAlias(alias, fromLine.rawName);
  } else {
    const keys = new Set(product?.keys || []);
    if (fromLine) keys.add(fromLine.key);
    keys.add(nameKey(form.name.value));
    store.upsertProduct({
      id: product?.id,
      name: form.name.value.trim(),
      code: form.code.value.trim(),
      volumeMl: Number(form.volumeMl.value) || 750,
      caseSize: Number(form.caseSize.value) || null,
      kind: form.kind.value,
      keys: [...keys],
    });
  }
  dialogCtx = null;
  render();
});

// ---------- バックアップ ----------
$('#backup-btn').addEventListener('click', () => {
  const d = new Date().toISOString().slice(0, 10);
  download(`販売数量_バックアップ_${d}.json`, store.exportJson(), 'application/json');
});
$('#restore-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || !confirm('現在のデータを置き換えて復元しますか？')) return;
  try {
    store.importJson(await f.text());
    render();
  } catch (err) {
    alert(err.message);
  }
});

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 描画 ----------
function render() {
  renderPending();
  renderInvoiceList();
  renderReport();
  renderProducts();
}
render();

// タノム商品一覧の初期マスタを取り込む（新しい商品だけ追加）
fetch('data/tanomu-products.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((seed) => {
    if (seed && store.seedProducts(seed)) render();
  })
  .catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 開発確認用
window.__cadelk = { store, bottlesOf };
