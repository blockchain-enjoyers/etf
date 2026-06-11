import { useState } from "react";
import { cn } from "../lib/cn";

type SortDir = "asc" | "desc" | null;

export interface ColumnDef<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
}

interface SortState {
  key: string;
  dir: SortDir;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  className?: string;
}

export function DataTable<T>({ columns, rows, getRowKey, className }: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>({ key: "", dir: null });

  function handleHeaderClick(col: ColumnDef<T>) {
    if (!col.sortable) return;
    setSort((prev) => {
      if (prev.key !== col.key || prev.dir === null) return { key: col.key, dir: "asc" };
      if (prev.dir === "asc") return { key: col.key, dir: "desc" };
      return { key: col.key, dir: null };
    });
  }

  const sorted = [...rows].sort((a, b) => {
    if (!sort.dir || !sort.key) return 0;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return 0;
    const av = col.render(a);
    const bv = col.render(b);
    const as = String(av ?? "");
    const bs = String(bv ?? "");
    return sort.dir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
  });

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => handleHeaderClick(col)}
                aria-sort={
                  sort.key === col.key && sort.dir
                    ? sort.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className={cn(
                  "py-2 pr-4 text-left text-[9px] font-semibold uppercase tracking-wider text-txt3",
                  col.sortable && "cursor-pointer select-none hover:text-txt"
                )}
              >
                {col.header}
                {col.sortable && sort.key === col.key && sort.dir === "asc" && " ↑"}
                {col.sortable && sort.key === col.key && sort.dir === "desc" && " ↓"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={getRowKey(row)}
              className="border-b border-line-soft last:border-0 hover:bg-surface2"
            >
              {columns.map((col) => (
                <td key={col.key} className="py-2 pr-4 font-mono tabular-nums text-txt">
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
