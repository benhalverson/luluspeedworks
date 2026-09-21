import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { shoppingMessage } from "./agent-contract";

export function ShoppingRequestForm({
  busy,
  status,
  send,
  cancel,
}: {
  busy: boolean;
  status: string;
  send: (message: string) => void;
  cancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<{ message: string }>({
    resolver: zodResolver(shoppingMessage),
    defaultValues: { message: "" },
  });
  return (
    <section
      className="col-span-full pt-0.5 bench:col-span-2 bench:col-start-2"
      aria-labelledby="composer-title"
    >
      <form onSubmit={handleSubmit(({ message }) => send(message))}>
        <label
          className="text-[10px] tracking-[0.12em] text-muted-foreground"
          id="composer-title"
          htmlFor="shopping-request"
        >
          YOUR SHOPPING REQUEST
        </label>
        <div className="mt-2.5 flex items-center gap-2 rounded-[7px] border border-input bg-muted py-2.25 pr-2.5 pl-3 tablet:gap-3 tablet:pl-4.5">
          <span className="font-mono text-primary" aria-hidden="true">
            &gt;_
          </span>
          <Input
            className="border-0 p-0 text-[12px] tablet:text-base"
            id="shopping-request"
            placeholder="What are you looking for?"
            aria-describedby="composer-help composer-error"
            aria-invalid={Boolean(errors.message)}
            maxLength={8192}
            {...register("message")}
          />
          <Button
            type="submit"
            aria-label="Send shopping request"
            disabled={busy}
          >
            ↑
          </Button>
        </div>
        <p role="alert" id="composer-error">
          {errors.message?.message}
        </p>
      </form>
      {busy ? (
        <Button variant="outline" onClick={cancel}>
          Cancel shopping request
        </Button>
      ) : null}
      <p
        role="status"
        className="pt-2.5 text-[11px] text-muted-foreground"
        id="composer-help"
      >
        {status}
      </p>
    </section>
  );
}
