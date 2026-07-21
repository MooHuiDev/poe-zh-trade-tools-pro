export const escapeCssAttributeValue = (value: string) => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }

  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
