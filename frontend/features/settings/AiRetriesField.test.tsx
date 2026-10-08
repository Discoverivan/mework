import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n/I18nProvider";
import { AiRetriesField } from "./AiRetriesField";

it("updates an edited retry field when the saved value changes", () => {
  const onChange = vi.fn();
  const field = (value: number) => <I18nProvider><AiRetriesField id="example-retries" value={value} disabled={false} onChange={onChange} /></I18nProvider>;
  const view = render(field(0));
  const input = screen.getByRole("textbox", { name: "Retries" });

  fireEvent.change(input, { target: { value: "3" } });
  expect(onChange).toHaveBeenCalledWith(3);
  expect(input).toHaveValue("3");

  view.rerender(field(4));
  expect(input).toHaveValue("4");
});
