import { defineConfig } from "drizzle-kit";

// SQLite 连接串为 `file:./db.sqlite` 形式，drizzle-kit 需要纯路径，去掉 `file:` 前缀。
const url = (process.env.DATABASE_URL ?? "file:./db.sqlite").replace(/^file:/, "");

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
