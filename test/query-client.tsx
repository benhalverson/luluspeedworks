import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { isValidElement, type ReactNode, StrictMode } from "react";
import { BrowserRouter } from "react-router";
import { afterEach } from "vitest";

const clients: QueryClient[] = [];
export function testClient() {
  const client = new QueryClient();
  clients.push(client);
  return client;
}
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
});
export function renderWithClient(ui: ReactNode, client = testClient()) {
  return render(ui, {
    reactStrictMode: isValidElement(ui) && ui.type === StrictMode,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <BrowserRouter>{children}</BrowserRouter>
      </QueryClientProvider>
    ),
  });
}
