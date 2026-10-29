import { loadConfig } from '../config/env.js';
import { openDatabase } from './index.js';

const config = loadConfig();
const database = await openDatabase(config);
await database.migrate();
await database.close();
console.info(`Migrations applied (${database.driver}).`);
