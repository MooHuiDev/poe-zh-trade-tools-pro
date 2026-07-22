# Chrome Web Store listing — copy/paste sheet

Fill each dashboard field with the matching block below.

---

## Item name
```
Poe Zh Trade Tools Pro
```

## Category
```
Tools
```

## Language (primary)
```
Chinese (Traditional)   ← or English, whichever you prefer as primary
```

---

## Short description (English, ≤132 chars)
```
Companion sidebar for the Path of Exile trade site: bookmarks, history, result tools, and Chinese (TW/CN) localization.
```

## Short description (中文)
```
流亡黯道交易站的輔助側邊欄:書籤、歷史、結果工具,並可將市集中文化(繁/簡)。
```

---

## Detailed description (English)
```
Poe Zh Trade Tools Pro is a companion for the official Path of Exile trade
website. It adds a sidebar and quality-of-life tools, and can optionally
translate the trade site into Traditional or Simplified Chinese with search
that works in both Chinese and English.

Features
• Bookmarks and folders for your saved trade searches
• Search history
• Result tools: Chaos/Divine/Exalted equivalent pricing (via poe.ninja),
  quick stat / weapon / price filter presets
• Optional Traditional or Simplified Chinese localization of stat filters,
  item mods, item names and currencies — search still works in both languages
• One-click PoeDB link on unique items (Chinese interface)
• All your data (bookmarks, history, settings) stays on your device

This project is based on the open-source Poe Trade Plus by KroxiLabs
(MIT License).

Not affiliated with, authorized, or endorsed by Grinding Gear Games.
"Path of Exile" is a trademark of Grinding Gear Games.
```

## Detailed description (中文)
```
Poe Zh Trade Tools Pro 是流亡黯道官方交易站的輔助工具。它提供一個側邊欄與多項
便利功能,並可選擇將整個交易站中文化(繁體或簡體),且中文、英文都能搜尋。

功能
• 書籤與資料夾:儲存你的交易搜尋
• 搜尋歷史
• 結果工具:混沌石/神聖石/崇高石等值定價(透過 poe.ninja)、快速屬性/武器/價格
  篩選預設
• 可選的繁體/簡體中文化:篩選器、詞綴、物品名稱、通貨全部中文化,且中英雙向皆可搜尋
• 傳奇物品一鍵開啟 PoeDB(中文介面時)
• 所有資料(書籤、歷史、設定)都留在你的裝置本機

本專案基於 KroxiLabs 的開源專案 Poe Trade Plus(MIT 授權)。

本擴充與 Grinding Gear Games 無關,未獲其授權或背書。
「Path of Exile」為 Grinding Gear Games 之商標。
```

---

## Single purpose (單一用途說明)
```
Enhance the official Path of Exile trade website with a companion sidebar
(bookmarks, search history, and result tools) and optional Traditional/
Simplified Chinese localization of the trade site.
```

---

## Permission justifications (權限用途說明)

**storage**
```
Stores the user's bookmarks, search history, and preferences locally in the
browser.
```

**unlimitedStorage**
```
The Chinese localization caches official trade metadata (stats, items,
currencies) locally; this can exceed the default storage quota.
```

**tabs**
```
Detects which open tab is the active Path of Exile trade page so the sidebar
can stay in sync with the page the user is viewing.
```

**Host permission — https://www.pathofexile.com/* (and regional subdomains: br, ru, th, de, fr, es, jp), https://pathofexile.com/*, https://poe2.kakaogames.com/***
```
These are the official Path of Exile trade pages the extension runs on to
inject its companion sidebar and result tools.
```

**Host permission — https://pathofexile.tw/***
```
Fetches the official Traditional-Chinese trade metadata used to translate the
trade site into Chinese.
```

**Host permission — https://poe.ninja/***
```
Fetches public currency exchange rates for the optional "equivalent pricing"
feature.
```

**Host permission — https://raw.githubusercontent.com/***
```
Fetches the latest Chinese unique-item name dictionary — a public JSON file
hosted on the maintainer's own GitHub — so translation name updates can ship
without a new extension release.
```

---

## Data usage declarations (資料用途宣告 — Privacy practices 分頁)

- Does this item collect user data? → Answer per the questionnaire, but the
  extension does NOT collect or transmit personal data. All user data stays
  local. Tick only categories you actually use (none apply for personal data).
- Not sold to third parties. Not used for unrelated purposes. Not used for
  creditworthiness/lending.
- Privacy policy URL: (paste the public URL where you host PRIVACY-POLICY.md,
  e.g. a public GitHub Gist or GitHub Pages link)

---

## Disclaimer to keep visible (免責聲明)
```
Not affiliated with, authorized, or endorsed by Grinding Gear Games.
Path of Exile is a trademark of Grinding Gear Games.
```

---

## Assets checklist
- [ ] Store icon 128×128 (already in the package)
- [ ] At least 1 screenshot 1280×800 or 640×400 (capture the sidebar + a
      translated trade page)
- [ ] (optional) Small promo tile 440×280
- [ ] Upload: poe-zh-trade-tools-pro-3.28.01-chrome.zip
- [ ] Visibility: start as "Unlisted" to test, then switch to Public
