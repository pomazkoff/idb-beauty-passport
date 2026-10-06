import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgresql://idb:idb@localhost:5432/beauty_passport" },
  strict: true,
  verbose: true,
});
