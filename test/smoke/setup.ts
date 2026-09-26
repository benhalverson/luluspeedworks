import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build, createLogger, preview } from "vite";

export default async function setup() {
  mkdirSync("artifacts/smoke", { recursive: true });
  const log = "artifacts/smoke/server.log";
  writeFileSync(
    log,
    "Building production assets for controlled API smoke tests.\n",
  );
  const logger = createLogger("warn");
  for (const level of ["info", "warn", "warnOnce", "error"] as const) {
    const original = logger[level];
    logger[level] = (message, options) => {
      appendFileSync(log, `${level}: ${message}\n`);
      original(message, options);
    };
  }
  try {
    await build({
      customLogger: logger,
      define: {
        "import.meta.env.VITE_API_ORIGIN": JSON.stringify(
          "https://api.lulu.test",
        ),
      },
      build: { outDir: "dist-smoke" },
    });
    const server = await preview({
      customLogger: logger,
      build: { outDir: "dist-smoke" },
      preview: { host: "127.0.0.1", port: 4173, strictPort: true },
    });
    server.printUrls();
    return async () => {
      await server.close();
      logger.info("Smoke preview stopped normally.");
    };
  } catch (error) {
    logger.error(String(error));
    throw error;
  }
}
