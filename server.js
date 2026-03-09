require("dotenv").config();

const { loadEnvConfig } = require("./app/config/env");
const { createApp } = require("./app/createApp");

function bootstrap() {
  let config;
  try {
    config = loadEnvConfig(__dirname);
  } catch (e) {
    console.error(`❌ ${e.message}. Dừng server.`);
    process.exit(1);
  }

  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`✅ Server up on port ${config.port}`);
    console.log("[BOOT] ADMIN_USER =", config.adminUser);
    console.log("[BOOT] ADMIN_HASH prefix =", (config.adminHash || "").slice(0, 10));
    console.log("[BOOT] COOKIE_SECURE =", process.env.COOKIE_SECURE);
  });
}

bootstrap();
