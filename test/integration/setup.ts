import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build, createLogger, preview } from "vite";

/** Serves production frontend assets against the separately started local API fixture. */
export default async function setup() {
  if (process.env.LOCAL_ADMIN_USE_DEV === "true") return;
  mkdirSync("artifacts/local-admin", { recursive: true });
  const log = "artifacts/local-admin/server.log";
  writeFileSync(
    log,
    "Building production assets for real local API integration.\n",
  );
  const logger = createLogger("warn");
  for (const level of ["info", "warn", "warnOnce", "error"] as const) {
    const original = logger[level];
    logger[level] = (message, options) => {
      appendFileSync(log, `${level}: ${message}\n`);
      original(message, options);
    };
  }
  await build({
    customLogger: logger,
    define: {
      "import.meta.env.VITE_API_ORIGIN": JSON.stringify(
        "http://localhost:8790",
      ),
    },
    build: { outDir: "artifacts/local-admin/dist" },
  });
  const server = await preview({
    customLogger: logger,
    build: { outDir: "artifacts/local-admin/dist" },
    preview: {
      host: "localhost",
      port: Number(process.env.LOCAL_ADMIN_FRONTEND_PORT ?? 3001),
      strictPort: true,
    },
  });
  return async () => {
    await server.close();
    logger.info("Local API frontend preview stopped normally.");
  };
}
