import { resolve } from "node:path"

import { defineConfig } from "wxt"
import { tradeHostPermissions } from "./lib/config/trade-hosts"

const iconMap = {
  16: "/icon-16.png",
  32: "/icon-32.png",
  48: "/icon-48.png",
  128: "/icon-128.png"
}

const firefoxBinary = process.env.FIREFOX_BINARY
const useManualFirefoxRunner = process.env.WXT_FIREFOX_MANUAL === "1"

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
  manifest: () => ({
    name: "Poe Zh Trade Tools Pro",
    version: "3.28.1",
    version_name: "3.28.01",
    description:
      "Poe Zh Trade Tools Pro enhances the Path of Exile trade site with bookmarks, history and result tools.",
    permissions: ["storage", "tabs", "unlimitedStorage"],
    host_permissions: [
      ...tradeHostPermissions,
      "https://poe.ninja/*",
      // Official trade-data APIs used by the self-built translation core.
      "https://pathofexile.com/*",
      "https://pathofexile.tw/*",
      // Remote unique-name dictionary (maintainer's own GitHub) so new unique
      // names can update without a store release.
      "https://raw.githubusercontent.com/*"
    ],
    icons: iconMap,
    action: {
      default_title: "Poe Zh Trade Tools Pro",
      default_icon: iconMap
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
