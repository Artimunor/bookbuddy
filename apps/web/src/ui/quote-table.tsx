import { useId } from "react";
import type { AuthoredPassage } from "./cards";

type LineValue = { quantity: string; amount: string };
type Line = {
  id: string;
  label: string;
  description?: AuthoredPassage;
  current: LineValue | null;
  previous?: LineValue | null;
  changeLabel?: string;
};
type Total = { id: string; label: string; current: string | null; previous?: string | null; emphasis?: boolean };

export type QuoteTableProps = {
  caption: string;
  labels: { item: string; quantity: string; amount: string; missing: string; current?: string; previous?: string };
  lines: readonly Line[];
  totals?: readonly Total[];
} & (
  | { compare?: false }
  | { compare: true; labels: { current: string; previous: string } }
);

export function QuoteTable({ caption, labels, lines, totals, compare = false }: QuoteTableProps) {
  const id = useId();
  const captionId = `${id}-caption`;
  const itemId = `${id}-item`;
  const columns = compare ? ["previous", "current"] as const : ["current"] as const;
  const quantityId = (column: (typeof columns)[number]) => `${id}-${column}-quantity`;
  const amountId = (column: (typeof columns)[number]) => `${id}-${column}-amount`;

  return (
    <div className="bb-quote-scroll" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table className="bb-quote">
        <caption id={captionId} className="text-section-title">{caption}</caption>
        <colgroup span={1} />
        {columns.map((column) => <colgroup key={column} span={2} />)}
        <thead>
          {compare && <tr>
            <th rowSpan={2} id={itemId} scope="col">{labels.item}</th>
            {columns.map((column) => <th colSpan={2} scope="colgroup" key={column}>{labels[column]}</th>)}
          </tr>}
          <tr>
            {!compare && <th id={itemId} scope="col">{labels.item}</th>}
            {columns.flatMap((column) => [
              <th key={quantityId(column)} id={quantityId(column)} scope="col">
                {compare && <span className="sr-only">{labels[column]} </span>}{labels.quantity}
              </th>,
              <th key={amountId(column)} id={amountId(column)} scope="col">
                {compare && <span className="sr-only">{labels[column]} </span>}{labels.amount}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => {
            const rowId = `${id}-line-${index}`;
            return <tr key={line.id}>
              <th id={rowId} scope="row" headers={itemId}>
                <bdi>{line.label}</bdi>
                {line.description && <span className="bb-passage block text-supporting text-muted" dir="auto" lang={line.description.lang}>{line.description.text}</span>}
                {compare && line.changeLabel && <span className="block text-supporting text-info-ink">{line.changeLabel}</span>}
              </th>
              {columns.flatMap((column) => [
                <td key={quantityId(column)} headers={`${rowId} ${quantityId(column)}`}><bdi>{line[column]?.quantity ?? labels.missing}</bdi></td>,
                <td key={amountId(column)} headers={`${rowId} ${amountId(column)}`}><bdi>{line[column]?.amount ?? labels.missing}</bdi></td>,
              ])}
            </tr>;
          })}
        </tbody>
        {totals && totals.length > 0 && <tfoot>
          {totals.map((total, index) => {
            const rowId = `${id}-total-${index}`;
            return <tr key={total.id} data-emphasis={total.emphasis || undefined}>
              <th id={rowId} scope="row">{total.label}</th>
              {columns.map((column) => <td key={column} colSpan={2} headers={`${rowId} ${amountId(column)}`}><bdi>{total[column] ?? labels.missing}</bdi></td>)}
            </tr>;
          })}
        </tfoot>}
      </table>
    </div>
  );
}
