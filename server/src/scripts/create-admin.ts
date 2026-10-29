/**
 * Creates (or promotes) an administrator from the command line - the recommended way to
 * bootstrap production deployments without exposing the HTTP setup endpoint.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_NAME="Your Name" npm run create-admin
 *
 * The password is read from ADMIN_PASSWORD or prompted for (input hidden).
 */
import { password as passwordSchema, email as emailSchema } from '@ibutest/shared';
import { eq } from 'drizzle-orm';
import readline from 'node:readline';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { hashPassword } from '../lib/password.js';

async function promptHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  output._writeToOutput = (s: string) => {
    if (s.includes(question)) output.output.write(s);
  };
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const emailResult = emailSchema().safeParse(process.env.ADMIN_EMAIL ?? '');
if (!emailResult.success) {
  console.error('Set ADMIN_EMAIL to a valid email address.');
  process.exit(1);
}
const name = (process.env.ADMIN_NAME ?? 'Administrator').slice(0, 100);
const pw = process.env.ADMIN_PASSWORD ?? (await promptHidden('Password (min 12 chars): '));
const pwResult = passwordSchema().safeParse(pw);
if (!pwResult.success) {
  console.error(pwResult.error.issues.map((i) => i.message).join('\n'));
  process.exit(1);
}

const database = await openDatabase(loadConfig());
await database.migrate();
const passwordHash = await hashPassword(pwResult.data);
const [existing] = await database.db.select({ id: users.id }).from(users).where(eq(users.email, emailResult.data)).limit(1);
if (existing) {
  await database.db.update(users).set({ role: 'admin', isActive: true, passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, existing.id));
  console.info(`Updated ${emailResult.data}: administrator role granted and password reset.`);
} else {
  await database.db.insert(users).values({ email: emailResult.data, name, passwordHash, role: 'admin' });
  console.info(`Created administrator ${emailResult.data}.`);
}
await database.close();
