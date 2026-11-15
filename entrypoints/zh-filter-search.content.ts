import { tradeHosts } from "~/lib/config/trade-hosts"

/**
 * Chinese display + search for the trade site's "knownItem" filter dropdowns
 * (完成地圖獎勵 / Ultimatum 需求·傳奇獎勵, Maven unique reward, the Ultimatum legacy
 * reward list, …). MAIN world.
 *
 * WHY THESE DROPDOWNS STAY ENGLISH
 *   They build their vue-multiselect option list from the item data's ENGLISH
 *   `name`: each option is `{ id, text }` with BOTH set to the English name
 *   (verified live: `{ id:"Mageblood", text:"Mageblood" }`). They never use the
 *   Chinese `text` the rest of the site renders, so no amount of /data/items
 *   translation (or winning its fetch race) makes them Chinese.
 *
 * THE FIX
 *   Wrap the multiselect's `getOptionLabel` so the DISPLAYED label becomes
 *   bilingual "中文 (English)". The option `id` — the value sent to the trade API
 *   — is left untouched, so search results and shared URLs stay valid.
 *   vue-multiselect filters by this same label, so Chinese typing now matches,
 *   and the collapsed selected value uses it too. The no-selection placeholder
 *   ("Any") is a separate input attribute, fixed alongside.
 *
 * REACHING THE INSTANCE (Vue 2 → Vue 3 compat migration, 2026-10)
 *   • Vue 2 build: `el.__vue__`.
 *   • Vue 3 compat build: `el.__vue__` is gone, but `window.app` still exposes
 *     `$children` (compat), so we walk it to the component whose `$el` is the
 *     multiselect element and patch `getOptionLabel` on its Vue 3 ctx (`vm.$.ctx`).
 *     (This is the same access path a competing tool uses, confirmed working.)
 *
 * SELF-GATING
 *   The English→Chinese map is built from the injected bilingual
 *   `lscache-tradeitems`. With no translated data (native pathofexile.tw, POE2,
 *   or translation off) the map is empty and nothing is wrapped.
 */
export default defineContentScript({
  matches: tradeHosts,
  world: "MAIN",
  runAt: "document_idle",

  main() {
    const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "")
    const hasZh = (s: string) => /[一-鿿]/.test(s)
    const LOCALIZED_ANY = "任何" // zh-tw and zh-cn both render the null option this way

    // normalized English unique name -> Chinese unique name (base type stripped)
    let nameZh: Record<string, string> = {}

    const buildNameMap = () => {
      let ti: unknown
      try {
        ti = JSON.parse(localStorage.getItem("lscache-tradeitems") || "[]")
      } catch {
        return
      }
      if (!Array.isArray(ti)) return

      const baseZh: Record<string, string> = {}
      const next: Record<string, string> = {}

      // Pass 1 — base-type Chinese from non-unique "中文 (English)" entries.
      for (const cat of ti) {
        for (const e of (cat as { entries?: unknown[] })?.entries || []) {
          const it = e as {
            flags?: { unique?: boolean }
            type?: string
            text?: string
            name?: string
          }
          if (!it?.flags?.unique && it?.type && it?.text) {
            const m = String(it.text).match(/^(.+?)\s*\((.+)\)\s*$/)
            if (m && hasZh(m[1])) baseZh[it.type] = m[1].trim()
          }
        }
      }

      // Pass 2 — unique names; strip the trailing Chinese base so the label is
      // just "艾貝拉斯之角" keyed by the English name "Abberath's Horn".
      for (const cat of ti) {
        for (const e of (cat as { entries?: unknown[] })?.entries || []) {
          const it = e as {
            flags?: { unique?: boolean }
            type?: string
            text?: string
            name?: string
          }
          if (it?.flags?.unique && it?.name && it?.text) {
            let zhPortion = String(it.text).split(" (")[0]
            const zhBase = it.type ? baseZh[it.type] : undefined
            if (zhBase && zhPortion.endsWith(zhBase)) {
              zhPortion = zhPortion.slice(0, zhPortion.length - zhBase.length).trim()
            }
            if (hasZh(zhPortion)) next[norm(it.name)] = zhPortion
          }
        }
      }

      if (Object.keys(next).length) nameZh = next
    }

    // English label -> "中文 (English)". Leaves Chinese / unknown / empty as-is;
    // maps the no-selection "Any". Never touches the option id (the API value).
    const translateLabel = (s: unknown): unknown => {
      if (typeof s !== "string" || !s || hasZh(s)) return s
      if (s === "Any") return LOCALIZED_ANY
      const zh = nameZh[norm(s)]
      return zh ? `${zh} (${s})` : s
    }

    const WRAPPED = "__pzttLabelWrapped"
    type Host = {
      getOptionLabel?: (this: unknown, o: unknown) => unknown
      [WRAPPED]?: boolean
    }

    const wrapHost = (host: Host | undefined): boolean => {
      if (!host || host[WRAPPED]) return false
      const orig = host.getOptionLabel
      if (typeof orig !== "function") return false
      host.getOptionLabel = function (this: unknown, o: unknown) {
        return translateLabel(orig.call(this, o))
      }
      host[WRAPPED] = true
      return true
    }

    // Does this vm look like a vue-multiselect (Vue 2 or Vue 3 compat)?
    const isMs = (v: {
      $options?: { name?: string }
      _computedWatchers?: { filteredOptions?: unknown }
      $?: { ctx?: object }
    }): boolean =>
      !!v &&
      (v.$options?.name === "vue-multiselect" ||
        !!v._computedWatchers?.filteredOptions ||
        !!(v.$?.ctx &&
          Object.getOwnPropertyDescriptor(v.$.ctx, "filteredOptions")))

    const vmCache = new WeakMap<Element, any>()

    // .multiselect element -> the object carrying getOptionLabel (the vm for
    // Vue 2, vm.$.ctx for Vue 3 compat). Cached per element.
    const resolveHost = (el: Element): Host | undefined => {
      let vm = vmCache.get(el)
      if (!vm) {
        const direct = (el as unknown as { __vue__?: any }).__vue__
        if (direct && isMs(direct)) vm = direct
        if (!vm) {
          const app = (window as unknown as { app?: any }).app
          const seen = new Set<unknown>()
          const walk = (v: any, d: number): any => {
            if (!v || seen.has(v) || d > 40) return null
            seen.add(v)
            if (v.$el === el && isMs(v)) return v
            for (const c of v.$children || []) {
              const hit = walk(c, d + 1)
              if (hit) return hit
            }
            return null
          }
          try {
            vm = walk(app, 0)
          } catch {
            vm = null
          }
        }
        if (vm) vmCache.set(el, vm)
      }
      if (!vm) return undefined
      return (vm.$?.ctx as Host) || (vm as Host)
    }

    // No-selection placeholder ("Any") is the input's placeholder attribute.
    const fixPlaceholder = (el: Element) => {
      const input = el.querySelector<HTMLInputElement>("input.multiselect__input")
      if (input && input.placeholder === "Any") input.placeholder = LOCALIZED_ANY
    }

    // ----- Chinese typing search --------------------------------------------
    // vue-multiselect filters by the RAW English option, so wrapping the display
    // label alone doesn't let the user type Chinese to find an item. We augment
    // the component's `filteredOptions` to also include options whose translated
    // "中文 (English)" label contains the query. Gated to ≥2 CJK characters: the
    // extension's own "~" auto-fuzzy prefix is stripped first, and a single CJK
    // char matches thousands of items (so, like the reference tool, we skip it).
    const FILTER_PATCHED = "__pzttFilterPatched"

    const augment = (
      vm: any,
      getLabel: (o: unknown) => unknown,
      native: unknown
    ): unknown => {
      if (!Array.isArray(native)) return native
      // Only the flat knownItem lists. GROUPED multiselects (the stat filter:
      // options are groups with `entries`, rendered via group-values) must never
      // get raw options appended — a group object in the flat list breaks the
      // render and the whole filter box disappears. Their options are already
      // bilingual, so Chinese typing works natively there.
      const p = vm?.$props || vm?.$?.props || vm || {}
      if (p.groupValues || p.groupLabel) return native
      const q = String(vm?.search || "")
        .replace(/^~+/, "")
        .trim()
      if (q.length < 2 || !hasZh(q)) return native
      try {
        const seen = new Set(native)
        const add: unknown[] = []
        const opts = Array.isArray(vm.options) ? vm.options : []
        for (const o of opts) {
          if (seen.has(o) || !o || typeof o !== "object" || "entries" in o) continue
          const lab = translateLabel(getLabel(o))
          if (typeof lab === "string" && lab.includes(q)) {
            add.push(o)
            if (add.length >= 50) break
          }
        }
        return add.length ? [...native, ...add] : native
      } catch {
        return native // never let our augmentation break the site's render
      }
    }

    const patchFiltered = (vm: any): boolean => {
      if (!vm) return false
      // Vue 3 compat: configurable filteredOptions getter on the internal ctx.
      const ctx = vm.$?.ctx
      if (ctx && !ctx[FILTER_PATCHED]) {
        const d = Object.getOwnPropertyDescriptor(ctx, "filteredOptions")
        if (d && typeof d.get === "function" && d.configurable) {
          const origGet = d.get
          const getLabel = (o: unknown) =>
            typeof ctx.getOptionLabel === "function"
              ? ctx.getOptionLabel(o)
              : o
          let memo: { native: unknown; q: string; out: unknown } | null = null
          Object.defineProperty(ctx, "filteredOptions", {
            configurable: true,
            enumerable: d.enumerable,
            set: d.set,
            get() {
              const native = origGet.call(ctx)
              const q = String(vm.search || "")
                .replace(/^~+/, "")
                .trim()
              // computed is read ~16x per render; memoize by native + query.
              if (memo && memo.native === native && memo.q === q)
                return memo.out
              const out = augment(vm, getLabel, native)
              memo = { native, q, out }
              return out
            }
          })
          ctx[FILTER_PATCHED] = true
          return true
        }
      }
      // Vue 2: computed watcher getter.
      const w = vm._computedWatchers?.filteredOptions
      if (w && typeof w.getter === "function" && !vm[FILTER_PATCHED]) {
        const orig = w.getter
        const getLabel = (o: unknown) =>
          typeof vm.getOptionLabel === "function" ? vm.getOptionLabel(o) : o
        w.getter = function (this: unknown, self: any) {
          const s = self ?? this ?? vm
          return augment(vm, getLabel, orig.call(s, s))
        }
        vm[FILTER_PATCHED] = true
        return true
      }
      return false
    }

    const wrapEl = (el: Element) => {
      fixPlaceholder(el)
      const host = resolveHost(el)
      if (!host) return
      const vm = vmCache.get(el)
      const didLabel = wrapHost(host)
      const didFilter = patchFiltered(vm)
      // Newly patched → re-render so shown labels/results pick up the change.
      if ((didLabel || didFilter) && vm && typeof vm.$forceUpdate === "function")
        vm.$forceUpdate()
    }

    const pass = () => {
      if (!Object.keys(nameZh).length) return
      for (const el of document.querySelectorAll(".multiselect")) wrapEl(el)
    }

    const tick = () => {
      if (!Object.keys(nameZh).length) buildNameMap()
      pass()
    }

    // Initial + retries (panel and item data load async), then a light periodic
    // pass to catch dropdowns mounted on demand. Idempotent: already-wrapped
    // hosts are skipped.
    tick()
    ;[400, 1200, 2500, 5000].forEach((d) => setTimeout(tick, d))
    setInterval(tick, 1500)

    // Immediate wrap the moment a dropdown is focused (before the next tick).
    document.addEventListener(
      "focusin",
      (e) => {
        const t = e.target as HTMLElement | null
        if (!t || !t.classList?.contains("multiselect__input")) return
        if (!Object.keys(nameZh).length) buildNameMap()
        const el = t.closest(".multiselect")
        if (el && Object.keys(nameZh).length) wrapEl(el)
      },
      true
    )
  }
})
