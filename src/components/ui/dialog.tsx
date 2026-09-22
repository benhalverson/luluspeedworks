import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { Button } from "./button";

export function DialogContent({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65" />
      <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-1.75rem)] max-w-[530px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-background p-5.5 text-foreground shadow-2xl tablet:p-7 [--color-background:var(--color-dialog)] [--color-foreground:var(--color-dialog-foreground)] [--color-muted-foreground:var(--color-dialog-muted)] [--color-border:var(--color-dialog-border)] [color-scheme:light] [overflow-wrap:anywhere]">
        <Dialog.Title className="pr-12 font-display text-[32px] font-semibold">
          {title}
        </Dialog.Title>
        <Dialog.Description className="mt-2 mb-6 text-xs leading-relaxed text-muted-foreground">
          {description}
        </Dialog.Description>
        {children}
        <Dialog.Close asChild>
          <Button
            variant="outline"
            className="absolute top-4 right-4 h-8 w-8 p-0"
            aria-label="Close"
          >
            ×
          </Button>
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
