export type BuyoutCurrency =
  | "Chaos Orb"
  | "Exalted Orb"
  | "Divine Orb"
  | "Chaos Orb Equivalent"
  | "Exalted Orb Equivalent"

export type BuyoutCurrencyPreset = {
  label: string
  currency: BuyoutCurrency
}

export const BUYOUT_CURRENCY_PRESETS: BuyoutCurrencyPreset[] = [
  { label: "Chaos", currency: "Chaos Orb" },
  { label: "Exalted", currency: "Exalted Orb" },
  { label: "Divine", currency: "Divine Orb" }
]

const setNativeInputValue = (input: HTMLInputElement, value: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )
  descriptor?.set?.call(input, value)
}

const buyoutFilterTitles = [
  "Buyout Price",
  "Preço de Compra",
  "Цена выкупа",
  "ราคาขายทันที",
  "Preis",
  "Directe",
  "Precio de compra",
  "バイアウト価格",
  "즉시 구매 가격",
  "直購價",
  "直购价"
]

const buyoutCurrencyLabels: Record<BuyoutCurrency, string[]> = {
  "Chaos Orb Equivalent": [
    "Chaos Orb Equivalent",
    "Equivalente a Orbe do Caos",
    "Эквивалент сферы хаоса",
    "เทียบเป็น Chaos Orb",
    "Wert in Chaossphären",
    "Équivalent en orbes du chaos",
    "Equivalente a Orbe de caos",
    "カオスオーブ同等物",
    "카오스 오브 등가물",
    "與混沌石等值",
    "与混沌石等值"
  ],
  "Exalted Orb Equivalent": [
    "Exalted Orb Equivalent",
    "Equivalente a Orbe Exaltado",
    "Эквивалент сфер возвышения",
    "เทียบเป็น Exalted Orb",
    "Erhabene Sphäre Äquivalent",
    "Équivalent en orbes exaltés",
    "Equivalente a Orbe Exaltado",
    "高貴なオーブ同等物",
    "엑잘티드 오브 등가물",
    "與崇高石等值",
    "与崇高石等值"
  ],
  "Chaos Orb": [
    "Chaos Orb",
    "Orbe do Caos",
    "Сфера хаоса",
    "Chaos Orb",
    "Chaossphäre",
    "Orbe du chaos",
    "Orbe de caos",
    "カオスオーブ",
    "카오스 오브",
    "混沌石",
    "混沌石"
  ],
  "Exalted Orb": [
    "Exalted Orb",
    "Orbe Exaltado",
    "Сфера возвышения",
    "Exalted Orb",
    "Erhabene Sphäre",
    "Orbe exalté",
    "Orbe exaltado",
    "高貴なオーブ",
    "엑잘티드 오브",
    "崇高石",
    "崇高石"
  ],
  "Divine Orb": [
    "Divine Orb",
    "Orbe Divino",
    "Божественная сфера",
    "Divine Orb",
    "Göttliche Sphäre",
    "Orbe divin",
    "Orbe divino",
    "神のオーブ",
    "신성한 오브",
    "神聖石",
    "神圣石"
  ]
}

const normalizeLabel = (value: string | null | undefined) =>
  value?.replace(/\s+/g, " ").trim() || ""

// Structural fallback: the Buyout Price row is the filter-property that has a
// currency multiselect AND min/max price inputs. This works regardless of the
// trade site's language or any page translation (e.g. POE Trade zh / browser
// translate), where the "Buyout Price" title text is no longer English.
const findBuyoutFilterStructural = () => {
  const filters = Array.from(
    document.querySelectorAll<HTMLElement>(".filter.filter-property")
  )

  return (
    filters.find((filter) => {
      const hasCurrencyMultiselect = !!filter.querySelector(
        ".multiselect input.multiselect__input"
      )
      const priceInputs = filter.querySelectorAll<HTMLInputElement>(
        "input.minmax, input[placeholder]"
      )
      return hasCurrencyMultiselect && priceInputs.length >= 2
    }) || null
  )
}

const findBuyoutFilter = () => {
  const filters = Array.from(
    document.querySelectorAll<HTMLElement>(".filter.filter-property")
  )

  const byTitle = filters.find((filter) => {
    const title = normalizeLabel(filter.querySelector(".filter-title")?.textContent)
    return buyoutFilterTitles.includes(title)
  })

  return byTitle || findBuyoutFilterStructural()
}

const getLocalizedCurrencyLabel = (
  buyoutFilter: HTMLElement,
  currency: BuyoutCurrency
) => {
  const title = normalizeLabel(
    buyoutFilter.querySelector(".filter-title")?.textContent
  )
  const languageIndex = buyoutFilterTitles.indexOf(title)
  return buyoutCurrencyLabels[currency][languageIndex] || currency
}

export const setBuyoutCurrencyPreset = (currency: BuyoutCurrency) => {
  const buyoutFilter = findBuyoutFilter()
  const multiselect = buyoutFilter?.querySelector<HTMLElement>(".multiselect")
  const input =
    multiselect?.querySelector<HTMLInputElement>("input.multiselect__input")

  if (!buyoutFilter || !multiselect || !input) return

  // Every known localized name for this currency (all trade-site languages).
  // We match the option against ALL of them instead of guessing one language
  // from the filter title — the title-based lookup breaks whenever the page is
  // translated (e.g. our own zh localization), which made this fail on the
  // international realm even though the same code worked on Garena TW.
  const names = buyoutCurrencyLabels[currency]
    .map((label) => normalizeLabel(label))
    .filter(Boolean)

  // Open the dropdown and clear any filter text so every option renders. (The
  // old code typed a single localized name; when that name was in the wrong
  // language the list filtered down to "No elements found" and nothing could be
  // selected.)
  input.focus()
  input.click()
  setNativeInputValue(input, "")
  input.dispatchEvent(new Event("input", { bubbles: true }))

  const selectOption = () => {
    const options = Array.from(
      multiselect.querySelectorAll<HTMLElement>(".multiselect__option")
    )
    if (options.length === 0) return false

    const texts = options.map((o) => normalizeLabel(o.textContent))
    // Prefer an exact name match, then "starts with" (handles bilingual
    // "神聖石 (Divine Orb)" options while still separating "混沌石" from
    // "與混沌石等值"), then a loose contains as a last resort.
    let index = texts.findIndex((t) => names.includes(t))
    if (index === -1)
      index = texts.findIndex((t) => names.some((n) => t.startsWith(n)))
    if (index === -1)
      index = texts.findIndex((t) => names.some((n) => t.includes(n)))
    if (index === -1) return false

    options[index].dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window })
    )
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  // Options render asynchronously after the dropdown opens; retry a few frames.
  let attempts = 0
  const tick = () => {
    if (selectOption() || attempts++ >= 8) return
    setTimeout(tick, 30)
  }
  setTimeout(tick, 0)
}

export const clearBuyoutPrice = () => {
  setBuyoutCurrencyPreset(
    window.location.pathname.startsWith("/trade2")
      ? "Exalted Orb Equivalent"
      : "Chaos Orb Equivalent"
  )
}
