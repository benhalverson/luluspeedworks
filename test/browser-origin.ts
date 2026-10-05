/** Set jsdom's actual browser origin while preserving the current route and history behavior. */
export function setBrowserOrigin(origin: string) {
  const environment = globalThis as typeof globalThis & {
    jsdom: { reconfigure(options: { url: string }): void };
  };
  environment.jsdom.reconfigure({
    url: `${origin}${window.location.pathname}${window.location.search}${window.location.hash}`,
  });
}
