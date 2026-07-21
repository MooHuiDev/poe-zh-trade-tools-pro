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

  input.focus()
  input.click()
  const localizedCurrency = getLocalizedCurrencyLabel(buyoutFilter, currency)

  setNativeInputValue(input, localizedCurrency)
  input.setSelectionRange(localizedCurrency.length, localizedCurrency.length)
  input.dispatchEvent(new Event("input", { bubbles: true }))

  queueMicrotask(() => {
    // Tolerant matching so it also works when the page is translated: POE Trade
    // zh renders options like "混沌石 (Chaos Orb)", so we accept an exact match,
    // or an option whose text contains the localized label or the English name.
    const options = Array.from(
      multiselect.querySelectorAll<HTMLElement>(".multiselect__option")
    )
    const option =
      options.find(
        (candidate) => normalizeLabel(candidate.textContent) === localizedCurrency
      ) ||
      options.find((candidate) => {
        const text = normalizeLabel(candidate.textContent)
        return text.includes(currency) || text.includes(localizedCurrency)
      })

    option?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      })
    )
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

export const clearBuyoutPrice = () => {
  setBuyoutCurrencyPreset(
    window.location.pathname.startsWith("/trade2")
      ? "Exalted Orb Equivalent"
      : "Chaos Orb Equivalent"
  )
}
