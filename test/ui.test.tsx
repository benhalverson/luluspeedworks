import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Button } from "../src/components/ui/button";
import { Input } from "../src/components/ui/input";

it("preserves native button behavior, disabled state, and class overrides", () => {
  const onClick = vi.fn();
  const view = render(
    <Button onClick={onClick} className="h-12">
      Continue
    </Button>,
  );
  const button = screen.getByRole("button", { name: "Continue" });
  expect(button).toHaveAttribute("type", "button");
  expect(button).toHaveClass("h-12");
  expect(button).not.toHaveClass("h-10");
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  view.rerender(
    <Button variant="outline" disabled onClick={onClick}>
      Continue
    </Button>,
  );
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it("preserves input labels, native type, value, and class overrides", () => {
  render(
    <Input
      aria-label="Quantity"
      type="number"
      defaultValue="2"
      className="h-12"
    />,
  );
  const input = screen.getByRole("spinbutton", { name: "Quantity" });
  expect(input).toHaveValue(2);
  expect(input).toHaveClass("h-12");
  fireEvent.change(input, { target: { value: "3" } });
  expect(input).toHaveValue(3);
});
