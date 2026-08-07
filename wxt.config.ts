import { resolve } from "node:path"

import { defineConfig } from "wxt"
import { tradeHostPermissions } from "./lib/config/trade-hosts"

const iconMap = {
  16: "/icons/icon-16.png",
  32: "/icons/icon-32.png",
  48: "/icons/icon-48.png",
  128: "/icons/icon-128.png"
}

const firefoxBinary = process.env.FIREFOX_BINARY
const useManualFirefoxRunner = process.env.WXT_FIREFOX_MANUAL === "1"

// Chrome-only, OPT-IN via env `POE_UNPACKED_KEY=1`. Pins the extension ID so a
// "load unpacked" install resolves to the SAME ID on every machine (otherwise the
// ID is derived from the folder path and differs per computer). A stable ID is
// required for chrome.storage.sync to share one bucket across a user's devices.
//   • Local test / GitHub manual-install build: set POE_UNPACKED_KEY=1 to include it.
//   • Chrome Web Store build: leave it UNSET — the store assigns its own key/ID, and
//     shipping a foreign `key` to the store causes problems.
// This is the PUBLIC key only — safe to commit (cannot sign or impersonate).
// Resulting ID when included: ojmpcecpbncgeiaejbfdihhlbpgiamja
const includeChromeKey = process.env.POE_UNPACKED_KEY === "1"
const CHROME_MANIFEST_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArof88TfCWq+ZcmfDa8rrwwuxX27ZTvQVwKVnmIW71C+flZu23MOnbvwnXoFMHxelehbY3+nvEF+5z3IW2c8GoRvGLdl0q3BJ2Jc2aQ5u25W7smDdw7Gi2F2pV1ZPnslC5cXjAlY61K5RoPKjO2EayTBMnNZieLKeAONrDxzdKPIWfxkkuirr2yvvY3mc3Sni1Q8ECu1jl8tBGP9XrJTEQtq1fi3Wz5hQ78aBUhN50YxvuUe8z6FvVWZ4befm5tI+AzjnD/0Cl20NhWdYKyHF+TkM8t/jfC8/ZSPQeNPlhpqlfNtVf1Pm2e6hM88lxeMjiV4KVLyU8zPFFm3iQcOrHwIDAQAB"

export default defineConfig({
  modules: ["@wxt-dev/module-svelte"],
  srcDir: ".",
  outDir: "build",
  manifestVersion: 3,
  webExt: {
    disabled: useManualFirefoxRunner,
    binaries: firefoxBinary
      ? {
          firefox: firefoxBinary
        }
      : undefined
  },
  svelte: {
    vite: {
      compilerOptions: {
        css: "injected",
        fragments: "tree"
      }
    }
  },
  manifest: (env) => ({
    name: "Poe Zh Trade Tools Pro",
    version: "4.1.3",
    version_name: "4.1.3",
    ...(env.browser === "chrome" && includeChromeKey
      ? { key: CHROME_MANIFEST_KEY }
      : {}),
    description:
      "Traditional/Simplified Chinese localization plus bookmarks, history and result tools for the Path of Exile trade site.",
    permissions: ["storage", "tabs", "unlimitedStorage"],
    host_permissions: [
      ...tradeHostPermissions,
      "https://poe.ninja/*",
      // Official trade-data APIs used by the self-built translation core
      // (pathofexile.tw is already covered by tradeHostPermissions).
      "https://pathofexile.com/*",
      // Remote unique-name dictionary (maintainer's own GitHub) so new unique
      // names can update without a store release.
      "https://raw.githubusercontent.com/*"
    ],
    icons: iconMap,
    action: {
      default_title: "Poe Zh Trade Tools Pro",
      default_icon: iconMap
    },
    // Firefox (AMO / about:debugging). strict_min_version 128 because three
    // content scripts use `world: "MAIN"`, which Firefox only supports from 128.
    // Chrome ignores browser_specific_settings, so this is harmless there.
    browser_specific_settings: {
      gecko: {
        id: "poe-zh-trade-tools-pro@moohui.dev",
        strict_min_version: "128.0",
        // AMO now REQUIRES this key for all new extensions. We collect no
        // personal data (everything is stored locally), so declare "none".
        // On Firefox < 140 this key is simply ignored (harmless); addons-linter
        // emits a non-blocking min-version warning that AMO accepts.
        data_collection_permissions: {
          required: ["none"]
        }
      }
    }
  }),
  vite: () => ({
    optimizeDeps: {
      entries: ["entrypoints/popup.html"]
    },
    resolve: {
      alias: {
        "~": resolve(__dirname),
        "~assets": resolve(__dirname, "assets"),
        "~components": resolve(__dirname, "components"),
        "~lib": resolve(__dirname, "lib")
      }
    }
  })
})
