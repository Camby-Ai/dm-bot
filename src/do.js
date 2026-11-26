import { DurableObject } from 'cloudflare:workers';
import { Bot } from './bot.js';
import { route } from './routes.js';

// One Durable Object holds everything. Single instance means events are handled one at a time,
// so a duplicate webhook can never double-send a guide.
export class BotDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    this.bot = new Bot({ sql: (q, ...p) => sql.exec(q, ...p).toArray(), env });
    ctx.blockConcurrencyWhile(async () => this.bot.migrate());
  }

  fetch(request) {
    return route(this.bot, request, this.env);
  }

  tick() {
    return this.bot.tick();
  }
}
