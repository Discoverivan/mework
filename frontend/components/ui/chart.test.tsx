import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "./chart";

it("renders tooltip values and legend labels from Recharts content payloads", () => {
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 640, 320));

  try {
    render(
      <ChartContainer config={{ tokens: { label: "Example tokens" } }}>
        <div>
          <ChartTooltipContent
            active
            label="Example day"
            payload={[{
              graphicalItemId: "example-series",
              dataKey: "tokens",
              name: "tokens",
              value: 42,
              payload: { tokens: 42 },
            }]}
          />
          <ChartLegendContent payload={[{ dataKey: "tokens", value: "tokens" }]} />
        </div>
      </ChartContainer>,
    );

    expect(screen.getByText("Example day")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getAllByText("Example tokens")).toHaveLength(2);
  } finally {
    measure.mockRestore();
  }
});
