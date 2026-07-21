# 繁體中文化維護指南（自建核心版）

本文件說明中文化的架構與維護方式。**已不再依賴第三方 POE Trade zh（Baconrad）的程式或 GitHub**；
翻譯核心改為由本專案自己的程式 + 官方公開資料驅動。（不含書籤/資料夾等交易工具功能。）

---

## 一、翻譯來源總覽

| 內容 | 負責檔案 | 來源 | 改版時 |
| --- | --- | --- | --- |
| **詞綴/屬性/篩選/通貨**（表單） | `lib/poe-zh-core/trade-data.ts` → 注入 `entrypoints/zh-core.content.ts` | 官方 `pathofexile.tw`（+`pathofexile.com` 供詞綴中英雙搜），用 id 對應 | ✅ 自動（見下） |
| **結果頁詞綴** | `entrypoints/zh-results.content.ts`（用 `zhCore_modmap`） | 官方 stats（id→中文模板），數值佔位還原 | ✅ 自動 |
| **傳奇物品名** | `lib/poe-zh-supplement/dict.ts` | poedb.tw 快照 | ❌ 手動重建 |
| **星團珠寶/天賦** | `lib/poe-zh-core/notables.ts` | 官方天賦翻譯（已編譯成內建字典） | ❌ 手動（少變動） |
| **交易站 UI 字**（按鈕/分頁/Item Level 等） | `lib/poe-zh-core/ui-strings.ts` | 手動整理（對照官方站） | ❌ 手動 |
| **交易面板 UI 值 + 物品名 DOM 補強** | `entrypoints/zh-supplement.content.ts` | 內建字典 | 依上表 |
| **擴充自身介面** | `lib/services/i18n/zh-tw.ts` | 本專案 | 與遊戲無關 |

---

## 二、關鍵機制：發佈新版本 = API 類翻譯自動刷新

官方交易資料抓一次後會快取。擴充會偵測 `package.json` 的 `version`：
**版本號一變（你發佈新版時），使用者更新後會自動清除舊快取、重新抓官方最新資料**（詞綴/屬性/篩選/通貨/結果頁詞綴全部跟著更新）。
機制在 `lib/poe-zh/…` 已移除；改由 `lib/poe-zh-core/trade-data.ts`（24h + 安裝/更新時強制）與背景 `onInstalled` 觸發。

👉 **每個新聯盟/大改版：重建傳奇字典 → 版本號 +1 → 重新 build → 上架，就完成大部分維護。**

---

## 三、手動維護項目

### 1) 傳奇物品名（每次新增/改名傳奇）
1. 瀏覽器開 <https://poedb.tw/tw/Unique_item> → `Ctrl+S`（網頁，僅 HTML）→ 存成專案根目錄 `unique.html`。
2.（選用）存 <https://www.pathofexile.com/api/trade/data/items> → `items-us.json`、<https://pathofexile.tw/api/trade/data/items> → `items-tw.json`。
3. `node scripts/build-unique-dict.mjs` → 重建 `lib/poe-zh-supplement/dict.ts`。
4. 台服沒有官方譯名者，在腳本 `OVERRIDES` 手動補。

### 2) 星團珠寶/天賦（少變動）
`lib/poe-zh-core/notables.ts` 目前是編譯好的內建字典。若要新增/更新天賦翻譯，直接編輯該檔（`{ 英文名: { name, desc[] } }`）。
（若要完全自建這份資料，可日後改由 poedb 天賦頁重建。）

### 3) UI 字串
直接編輯 `lib/poe-zh-core/ui-strings.ts`（`{ 英文: 中文 }`），對照官方站用字增減。

---

## 四、發佈流程

```bash
node scripts/build-unique-dict.mjs   # 重建傳奇字典（改版時）
# 編輯 package.json "version" +1
npm run build       # build/chrome-mv3
npm run package     # 產生上架用 zip
# 上傳 Chrome 線上應用程式商店
```

---

## 五、授權（上架前）

- 翻譯核心已改為**官方公開 API + 本專案程式 + poedb（傳奇名，建議註明來源）**，不再散布 Baconrad 的程式。
- `lib/poe-zh-core/notables.ts` 內含官方天賦中文（passive 資料）；若要最保險，之後可改為自 poedb 重建。
- 基底擴充（Poe Zh Trade Tools Pro / KroxiLabs）本身為 MIT，見 `LICENSE`。

---

## 六、可刪除的舊檔（Baconrad 殘留，已不使用）

以下是整合初期引入、現已無用、可安全刪除（讓專案乾淨、build 變小）：

```
public/js/        （app.js, result.js, popup.js, translate.zh_TW.js）
public/json/      （translate.json, translate.zh_TW.json, clusterJewel.json, passivesNotable.json）
public/font/      、public/images/ 、public/lib/  （materialize 等）
public/update.html 、public/options.html
lib/poe-zh/       （background.js）
```

保留 `public/icon-*.png`（擴充圖示）。刪除後 `npm run build` 產出會更小、更乾淨。

---

## 七、檔案位置速查

- 官方資料抓取/注入：`lib/poe-zh-core/trade-data.ts`、`entrypoints/zh-core.content.ts`
- 結果頁詞綴/天賦：`entrypoints/zh-results.content.ts`（模板 `zhCore_modmap`、天賦 `lib/poe-zh-core/notables.ts`）
- 傳奇字典：`lib/poe-zh-supplement/dict.ts`（腳本 `scripts/build-unique-dict.mjs` 重建）
- 非傳奇物品名 DOM 補強：`lib/poe-zh-supplement/build-item-map.ts` + `entrypoints/zh-supplement.content.ts`
- UI 字串：`lib/poe-zh-core/ui-strings.ts`
- 擴充介面翻譯：`lib/services/i18n/zh-tw.ts`
