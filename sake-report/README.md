# 販売数量集計（Ca' del K）サンプル

タノムの請求書PDFを読み込み、酒類販売数量報告書用の月別集計（本数・リットル・売上）を出すPWA。

## 起動（開発）

```bash
cd /Users/kokubunkyoutarou/Development/ca.del.k && python3 -m http.server 8765
```

http://localhost:8765/sake-report/ を開く。サンプルPDFは `../samples/`。

## 構成

| ファイル | 役割 |
|---|---|
| `js/invoice-parser.js` | 請求書PDF → 明細（pdf.js の文字座標から表の列を判定） |
| `js/normalize.js` | 商品名の正規化（化けた国旗絵文字・【キャンペーン】表記を除去） |
| `js/master.js` | 酒類品目・報告表区分、容量の推測、ケース→本数換算 |
| `js/aggregate.js` | 年度（4月〜翌3月）の月別集計 |
| `js/store.js` | 端末内保存（localStorage）・バックアップ |
| `js/app.js` | 画面 |

## 入力元を増やすとき（タノムCSVなど）

CSVを `store.saveInvoice()` が受け取る明細形式（`date, code, rawName, name, key, qty, unit, amount…`）に変換する読み込み部分を1つ追加すれば、商品マスタと集計はそのまま使える。

## 未対応・今後

- 在庫数・在庫金額（仕入データの取込が必要）
- 端末間のデータ共有（現状は端末内保存＋バックアップファイル）
- iPhoneでは「共有」から直接取り込めないため、PDFを「ファイル」に保存してから選ぶ
