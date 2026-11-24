import { useState } from "react";
import type { ScreenPreview } from "../../preview/screens/types";
import { BrowseView } from "./Screen";
import { cards, categories, noop } from "./fixture";
function BrowsePreview({ empty = false }: { empty?: boolean }) {
  const [category, setCategory] = useState<string>();
  return <BrowseView sessions={empty ? [] : cards.filter(item => !category || item.category === category)} categories={categories}
    locality="Xàbia" category={category} status="ready" onCategory={setCategory} onPlace={noop} onCard={noop} onBack={noop} />;
}
export const previews: ScreenPreview[] = [
  { id: "L-01", state: "results", render: () => <BrowsePreview /> },
  { id: "L-01", state: "none-nearby", render: () => <BrowsePreview empty /> },
];
