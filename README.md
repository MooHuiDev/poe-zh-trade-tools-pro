<div align="center">
  <img src="assets/logo.webp" alt="Poe Zh Trade Tools Pro" width="120" />
  <h1>Poe Zh Trade Tools Pro</h1>
  <p>A companion for the official Path of Exile trade site — with Traditional / Simplified Chinese localization.</p>
  <p>流亡黯道官方交易站的輔助工具 — 支援繁體 / 簡體中文化。</p>
</div>

> **Not affiliated with, authorized, or endorsed by Grinding Gear Games.**
> "Path of Exile" is a trademark of Grinding Gear Games.
> 本擴充與 Grinding Gear Games 無關,未獲其授權或背書;「Path of Exile」為 GGG 之商標。

> **Scope / 適用範圍:** This fork targets **Path of Exile 1**. As the maintainer
> only plays PoE1, **Path of Exile 2 has not been modified**.
> 本工具的改動以**《流亡黯道》一代(PoE1)**為主;由於作者僅遊玩一代,**二代(PoE2)並未做任何修改**。

---

## English

**Poe Zh Trade Tools Pro** is a Chrome extension that adds a companion sidebar
and quality-of-life tools to the official Path of Exile trade website, and can
optionally translate the trade site into Traditional or Simplified Chinese with
search that works in both Chinese and English.

### Features
- Bookmarks and folders for saved trade searches
- Search history
- Result tools: Chaos / Divine / Exalted equivalent pricing (via poe.ninja),
  quick stat / weapon / price filter presets
- Optional Traditional / Simplified Chinese localization of stat filters, item
  mods, item names and currencies — bilingual (Chinese + English) search
- One-click PoeDB link on unique items (Chinese interface)
- All data (bookmarks, history, settings) stays on your device

### Install
- Chrome Web Store: _(link coming once published)_
- From source: see **Build** below, then load `build/chrome-mv3` via
  `chrome://extensions` → Developer mode → Load unpacked.

### Build
```bash
pnpm install
pnpm run build:chrome   # output in build/chrome-mv3
```

### Privacy
No personal data is collected or transmitted. Everything is stored locally.
See [store/PRIVACY-POLICY.md](store/PRIVACY-POLICY.md).

---

## 中文

**Poe Zh Trade Tools Pro** 是一個 Chrome 擴充,為流亡黯道官方交易站加入輔助側邊欄
與多項便利功能,並可選擇將交易站中文化(繁體或簡體),且中英雙向皆可搜尋。

### 功能
- 書籤與資料夾:儲存交易搜尋
- 搜尋歷史
- 結果工具:混沌石 / 神聖石 / 崇高石等值定價(透過 poe.ninja)、快速屬性 / 武器 /
  價格篩選預設
- 可選的繁體 / 簡體中文化:篩選器、詞綴、物品名稱、通貨全面中文化,中英雙向皆可搜尋
- 傳奇物品一鍵開啟 PoeDB(中文介面時)
- 所有資料(書籤、歷史、設定)都留在本機

### 安裝
- Chrome 線上應用程式商店:_(上架後補上連結)_
- 從原始碼:見上方 **Build**,再到 `chrome://extensions` → 開發者模式 →
  載入未封裝項目,選 `build/chrome-mv3`。

---

## Credits / 致謝
Based on the open-source **[Poe Trade Plus](https://github.com/KroxiLabs/Kroxitrade)**
by KroxiLabs, licensed under the MIT License. The Traditional / Simplified
Chinese localization and integration is by **MooHui Dev**.

本專案基於 KroxiLabs 的開源專案 **Poe Trade Plus**(MIT 授權);繁體 / 簡體中文化
與整合由 **MooHui Dev** 製作。

## License
[MIT](LICENSE) — original © KroxiLabs; localization fork © MooHui Dev.
