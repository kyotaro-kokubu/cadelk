// 月別集計（年度は4月〜翌3月）
import { CATEGORY_ORDER, categoryFor, bottlesOf } from './master.js';
import { findProduct } from './store.js';

export const UNCLASSIFIED = '未登録の商品';

export function fiscalYearOf(dateStr) {
  const [y, m] = dateStr.split('/').map(Number);
  return m >= 4 ? y : y - 1;
}

export function monthsOfFiscalYear(fy) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? fy : fy + 1;
    out.push(`${y}/${String(m).padStart(2, '0')}`);
  }
  return out;
}

export function fiscalYears(lines) {
  const set = new Set(lines.map((l) => fiscalYearOf(l.date)));
  return [...set].sort((a, b) => b - a);
}

// mode: 'category'（報告表の容量区分） | 'kind'（酒類の品目）
export function aggregate(lines, fy, mode = 'category') {
  const months = monthsOfFiscalYear(fy);
  const rows = new Map();
  const ensure = (name) => {
    if (!rows.has(name)) {
      rows.set(name, {
        name,
        months: Object.fromEntries(months.map((m) => [m, { bottles: 0, liters: 0, sales: 0 }])),
        total: { bottles: 0, liters: 0, sales: 0 },
      });
    }
    return rows.get(name);
  };
  if (mode === 'category') CATEGORY_ORDER.forEach(ensure);

  const total = { bottles: 0, liters: 0, sales: 0 };
  const monthTotals = Object.fromEntries(months.map((m) => [m, { bottles: 0, liters: 0, sales: 0 }]));

  for (const l of lines) {
    if (fiscalYearOf(l.date) !== fy) continue;
    const month = l.date.slice(0, 7);
    const p = findProduct(l);
    const rowName = !p ? UNCLASSIFIED : mode === 'kind' ? p.kind : categoryFor(p.kind, p.volumeMl);
    const bottles = bottlesOf(l, p);
    const liters = p ? (bottles * p.volumeMl) / 1000 : 0;
    const add = (t) => {
      t.bottles += bottles;
      t.liters += liters;
      t.sales += l.amount;
    };
    const row = ensure(rowName);
    add(row.months[month]);
    add(row.total);
    add(monthTotals[month]);
    add(total);
  }

  // 未登録は最後に
  const list = [...rows.values()].sort((a, b) => {
    if (a.name === UNCLASSIFIED) return 1;
    if (b.name === UNCLASSIFIED) return -1;
    return 0;
  });
  return { months, rows: list, monthTotals, total };
}
