import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import { Button } from "./button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

it("focuses the opened form and shows a control hint when the user focuses that control", async () => {
  render(<Dialog>
    <DialogTrigger asChild><Button>Open example form</Button></DialogTrigger>
    <DialogContent aria-describedby={undefined}>
      <DialogTitle>Example form</DialogTitle>
      <Button title="Example control hint">Example control</Button>
    </DialogContent>
  </Dialog>);

  fireEvent.click(screen.getByRole("button", { name: "Open example form" }));
  const dialog = await screen.findByRole("dialog", { name: "Example form" });
  await waitFor(() => expect(dialog).toHaveFocus());
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  act(() => screen.getByRole("button", { name: "Example control" }).focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Example control hint");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open example form" })).toHaveFocus());
});
