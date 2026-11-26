import { BotDO } from './do.js';

export { BotDO };

const stub = (env) => env.BOT.get(env.BOT.idFromName('main'));

export default {
  fetch(request, env) {
    return stub(env).fetch(request);
  },
  // Every minute: send due one-hour follow-ups. Also refreshes the Instagram token weekly.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(stub(env).tick());
  },
};
