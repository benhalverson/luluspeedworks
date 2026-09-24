import type { ComponentProps } from "react";
import { Link } from "react-router";

export function BrandLink({
  onClick,
}: Pick<ComponentProps<typeof Link>, "onClick">) {
  return (
    <Link
      className="flex shrink-0 items-center gap-3"
      to="/"
      aria-label="Lulu Speedworks home"
      onClick={onClick}
    >
      <span className="relative h-13 w-11 overflow-hidden rounded-full bg-white tablet:h-18.5 tablet:w-16">
        <img
          className="absolute -top-3.25 -left-1.75 h-auto w-14.75 max-w-none tablet:-top-4.25 tablet:w-19.5"
          src="/brand/lulu-logo.svg"
          alt="Lulu the dog with a racing badge"
          width="78"
          height="117"
        />
      </span>
      <span className="-skew-x-7 font-display text-[29px] font-bold leading-[0.8] tablet:text-[36px]">
        LULU
        <span className="mt-1.75 block text-[10px] tracking-[0.12em] tablet:text-[12px]">
          SPEEDWORKS
        </span>
      </span>
    </Link>
  );
}
