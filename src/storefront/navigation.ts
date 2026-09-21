import { useEffect, useState } from "react";

export function useProductNavigation() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href);
      if (
        url.origin !== window.location.origin ||
        url.hash ||
        url.search ||
        (url.pathname !== "/" && !url.pathname.startsWith("/products/"))
      )
        return;
      event.preventDefault();
      if (url.pathname === window.location.pathname) return;
      window.history.pushState(null, "", url.pathname);
      pop();
      document.getElementById("focus-title")?.focus();
    };
    window.addEventListener("popstate", pop);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("popstate", pop);
      document.removeEventListener("click", click);
    };
  }, []);
  return path;
}
