const tradeKeys = {
  carpentry: "shared.trade.carpentry",
  electrical: "shared.trade.electrical",
  plumbing: "shared.trade.plumbing",
  painting: "shared.trade.painting",
  locksmith: "shared.trade.locksmith",
  general: "shared.trade.general",
  other: "shared.trade.other",
} as const;

const categoryKeys = {
  pilates: "shared.sessionCategory.pilates",
  massage: "shared.sessionCategory.massage",
  "sport-coaching": "shared.sessionCategory.sportCoaching",
  sport_coaching: "shared.sessionCategory.sportCoaching",
  tours: "shared.sessionCategory.tours",
} as const;

/** Wire codes are open strings; never display an unknown code as product copy. */
export function tradeLabelKey(trade: string | null | undefined) {
  return trade && Object.hasOwn(tradeKeys, trade) ? tradeKeys[trade as keyof typeof tradeKeys] : "shared.trade.unspecified";
}

export function sessionCategoryLabelKey(category: string | null | undefined) {
  return category && Object.hasOwn(categoryKeys, category) ? categoryKeys[category as keyof typeof categoryKeys] : "shared.sessionCategory.other";
}
