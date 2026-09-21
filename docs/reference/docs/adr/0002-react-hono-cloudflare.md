# Use React, Vite, and Hono on Cloudflare Workers

The new storefront will use React, TypeScript, Vite, and Hono on Cloudflare Workers, following the Cloudflare React + Vite starter guide selected by the user. React provides the client component foundation for the primary A2UI interface; Hono handles the storefront Worker's routes while the existing printer API retains commerce ownership.

Use pnpm and the latest stable React release at scaffolding time. The linked starter supplies the React SPA, Worker entrypoint, and Cloudflare Vite plugin; integrate Hono into that Worker. This decision establishes the new repository's stack and does not migrate the existing store.

Reference: [Cloudflare React + Vite guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/).
