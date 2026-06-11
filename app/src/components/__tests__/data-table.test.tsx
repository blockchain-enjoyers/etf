import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type ColumnDef } from "../DataTable";

type Row = { id: string; name: string; weight: string };

const columns: ColumnDef<Row>[] = [
  { key: "name", header: "Name", sortable: true, render: (r) => r.name },
  { key: "weight", header: "Weight", sortable: false, render: (r) => r.weight },
];

const rows: Row[] = [
  { id: "1", name: "MSFT", weight: "0.30" },
  { id: "2", name: "AAPL", weight: "0.70" },
];

describe("DataTable", () => {
  it("renders column headers", () => {
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Weight")).toBeTruthy();
  });

  it("renders all rows", () => {
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("MSFT")).toBeTruthy();
  });

  it("sorts ascending on first header click", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    await user.click(screen.getByText("Name"));
    const cells = screen.getAllByRole("cell");
    const names = cells.filter((c) => c.textContent === "AAPL" || c.textContent === "MSFT");
    expect(names[0]!.textContent).toBe("AAPL");
    expect(names[1]!.textContent).toBe("MSFT");
  });

  it("sorts descending on second header click", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    const nameHeader = screen.getByText("Name");
    await user.click(nameHeader);
    await user.click(nameHeader);
    const cells = screen.getAllByRole("cell");
    const names = cells.filter((c) => c.textContent === "AAPL" || c.textContent === "MSFT");
    expect(names[0]!.textContent).toBe("MSFT");
    expect(names[1]!.textContent).toBe("AAPL");
  });

  it("clears sort on third header click", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    const nameHeader = screen.getByText("Name");
    await user.click(nameHeader);
    await user.click(nameHeader);
    await user.click(nameHeader);
    const nameCol = screen.queryByRole("columnheader", { name: /name/i });
    expect(nameCol?.getAttribute("aria-sort")).toBeNull();
  });

  it("non-sortable header does not trigger sort", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    const weightHeader = screen.getByText("Weight");
    await user.click(weightHeader);
    expect(weightHeader.getAttribute("aria-sort")).toBeNull();
  });

  it("sets aria-sort ascending after first click", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    await user.click(screen.getByText("Name"));
    const nameHeader = screen.getByRole("columnheader", { name: /name/i });
    expect(nameHeader.getAttribute("aria-sort")).toBe("ascending");
  });

  it("sets aria-sort descending after second click", async () => {
    const user = userEvent.setup();
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    const nameHeader = screen.getByText("Name");
    await user.click(nameHeader);
    await user.click(nameHeader);
    expect(screen.getByRole("columnheader", { name: /name/i }).getAttribute("aria-sort")).toBe("descending");
  });
});
