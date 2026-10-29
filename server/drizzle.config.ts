import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL migrations from src/db/schema.ts (`npm run db:generate`).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
