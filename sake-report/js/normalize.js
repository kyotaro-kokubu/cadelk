// 商品名の正規化。
// タノムの請求書PDFでは国旗などの絵文字が別の文字（例: 🇮🇹 → U+101EE U+101F9）に
// 化けて入っているため、BMP外の文字と記号類はまとめて取り除く。

export function stripSymbols(s) {
  return [...s]
    .filter((c) => {
      const cp = c.codePointAt(0);
      if (cp > 0xffff) return false; // 絵文字・化けた国旗など
      if (cp >= 0x2190 && cp <= 0x2bff) return false; // ☘ ★ 矢印など
      if (cp === 0xfe0f || cp === 0x200d || cp === 0xfffd || cp === 0x25a1) return false;
      return true;
    })
    .join('');
}

// 表示用の商品名（記号・キャンペーン表記を除いて整形）
export function cleanName(raw) {
  return stripSymbols(raw)
    .replace(/【[^】]*】/g, '')
    .replace(/[\s　]+/g, ' ')
    .trim();
}

// 照合用キー（表記ゆれを吸収）
export function nameKey(raw) {
  return stripSymbols(raw.normalize('NFKC'))
    .replace(/【[^】]*】/g, '')
    .replace(/[\s　]/g, '')
    .replace(/[“”"'‘’「」『』]/g, '')
    .toLowerCase();
}

// 「NL1-1 / 商品名」形式の商品コードを分離
export function splitCode(text) {
  const m = text.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*\/\s*(.+)$/s);
  if (m) return { code: m[1], name: m[2] };
  return { code: '', name: text };
}
