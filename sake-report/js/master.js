// 酒類の品目と、販売数量報告表の区分

export const KINDS = [
  '果実酒',
  '甘味果実酒',
  'ビール',
  '発泡酒',
  'スピリッツ',
  'リキュール',
  'ウイスキー',
  'ブランデー',
  '清酒',
  '焼酎',
  'その他の醸造酒',
  '酒類以外',
];

// 坂田さんのExcel表の行の並び
export const CATEGORY_ORDER = [
  '750ML',
  '3ℓ',
  'マグナム',
  '375ML',
  'ビール',
  'リキュール700ml',
  '蒸留酒500ml',
  '蒸留酒700ml',
  '蒸留酒1000ml',
  'ミニチュア200ml',
  'ジュース',
];

const SPIRITS = ['スピリッツ', 'ウイスキー', 'ブランデー', '焼酎'];

// 品目と容量から報告表の区分を決める
export function categoryFor(kind, volumeMl) {
  const v = Number(volumeMl) || 0;
  if (kind === '酒類以外') return 'ジュース';
  if (kind === 'ビール' || kind === '発泡酒') return 'ビール';
  if (kind === 'リキュール') return `リキュール${v}ml`;
  if (SPIRITS.includes(kind)) return `蒸留酒${v}ml`;
  if (v === 750) return '750ML';
  if (v === 1500) return 'マグナム';
  if (v === 3000) return '3ℓ';
  if (v === 375) return '375ML';
  if (v > 0 && v <= 200) return 'ミニチュア200ml';
  return `その他${v}ml`;
}

// 商品名から容量・品目を推測（新規登録時の初期値）
export function guessProduct(name) {
  const n = name.normalize('NFKC');
  let volumeMl = 750;
  if (/1\.5\s*[ℓlL]|マグナム|1500\s*ml/i.test(n)) volumeMl = 1500;
  else if (/(^|[^\d.])3\s*[ℓlL]|BIB|バッグ・?イン・?ボックス|3000\s*ml/i.test(n)) volumeMl = 3000;
  else if (/375\s*ml|ハーフ/i.test(n)) volumeMl = 375;
  else if (/200\s*ml|ミニ/i.test(n)) volumeMl = 200;

  let kind = '果実酒';
  if (/ビール|IPA|エール|ラガー|ピルスナー/i.test(n)) kind = 'ビール';
  else if (/グラッパ|ジン|ウォッカ|ラム|テキーラ/.test(n)) kind = 'スピリッツ';
  else if (/リキュール|リモンチェッロ|アマーロ/.test(n)) kind = 'リキュール';
  else if (/ジュース|ノンアル/.test(n)) kind = '酒類以外';

  return { volumeMl, kind, caseSize: 6 };
}

// 明細行の本数（ケース単位は入数を掛ける）
export function bottlesOf(line, product) {
  const q = Number(line.qty) || 0;
  if (/ケース|cs/i.test(line.unit || '')) return q * (Number(product?.caseSize) || 1);
  return q;
}
