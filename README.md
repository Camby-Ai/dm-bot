# DM bot

Your own Instagram comment-to-DM bot. Someone comments a word on your reel, or DMs it to you, and the link lands in their DMs. It runs on Cloudflare Workers in your own account. Nobody bills you per person.

The full walkthrough is at https://chat.mikecamby.com

## What it does

1. Someone comments a keyword on a reel, or DMs the keyword to your account.
2. It replies under the comment and sends one question, with optional tap answers.
3. They answer, typed or tapped. The answer is saved.
4. Optional follow gate: "Follow first", then "I'm following".
5. It sends your link as a button. Clicks are counted.
6. No answer in 60 minutes (you can change it): the link goes out anyway.
7. Then you take over by hand. Nothing else is automated.

One run per person per automation. Your own comments are ignored. Duplicate webhooks cannot double send.

## Setup

You need Node.js, a Cloudflare account, a Meta developer account and an Instagram professional account.

```bash
npm install
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD     # you pick it
npx wrangler secret put VERIFY_TOKEN       # any random string, reused in Meta step 4
npx wrangler deploy                        # prints https://dm-bot.<you>.workers.dev
```

Before you deploy, open `wrangler.jsonc` and set `IG_USERNAME`, `BRAND_NAME` and `CONTACT_EMAIL`.

Open `<that address>/admin`, Setup tab. It shows the three URLs Meta needs: webhook, privacy and data deletion.

### The Meta steps

1. developers.facebook.com, Create app, use case **Manage messaging & content on Instagram**.
2. App roles, Add people, **Instagram Tester**, type your handle. Then on instagram.com: Settings, Apps and websites, Tester invites, Accept.
3. API setup with Instagram login: Add account, **Generate token**. Copy the account ID shown beside your account into `IG_USER_ID` in `wrangler.jsonc`. Then:
   ```bash
   npx wrangler secret put IG_ACCESS_TOKEN
   npx wrangler secret put IG_APP_SECRET   # the INSTAGRAM app secret, on the Instagram login page, not the Meta app secret
   npx wrangler deploy
   ```
4. Webhooks: callback URL `<address>/webhook`, verify token = your VERIFY_TOKEN. Subscribe **comments**, **messages** and **messaging_postbacks**.
5. Publish the app, using the privacy and data deletion URLs from the Setup tab. Instagram sends nothing to an unpublished app.
6. On your phone: Instagram, Settings, Messages and story replies, Message controls, Connected tools, **Allow access to messages**.

### Going live safely

1. Everything starts in **dry run**: `DRY_RUN` is `"true"` in `wrangler.jsonc`, and it also stays dry until a token exists. Dry run logs what it would send and sends nothing.
2. Make an automation, press Go live, use Setup and test, Simulate, and read the Log tab.
3. Set `DRY_RUN` to `"false"` and run `npx wrangler deploy`.
4. Test from a **second Instagram account**. Your own comments are ignored. Test one comment and one DM before you post the reel.

## Two kinds of token

- **Instagram login token** (the steps above): leave `GRAPH_HOST` as `graph.instagram.com`. The bot refreshes it weekly.
- **System-user token** from Meta Business settings (starts with `EAA`): set `GRAPH_HOST` to `graph.facebook.com`. It does not expire and is not refreshed.

Our own bot runs on the second kind. The first kind is the path in the post this was built from. The code handles both, and we have only run the second one live.

## Rules Instagram enforces

Check Meta's documentation before you rely on these.

- One private reply per comment, within 7 days of it.
- After that, a message is only allowed within 24 hours of the person's last message or tap.
- So the follow-up after 60 minutes can fail for someone who commented and never answered. The bot tries, logs the error and marks them expired.
- Tap answers on the first private reply are untested. If Instagram refuses them the bot sends the question again as plain text.

## Files

- `src/bot.js` the flow logic
- `src/routes.js` webhook, signature check, admin API, login
- `src/pages.js` admin page, privacy page, data deletion page
- `src/do.js`, `src/index.js` Cloudflare wiring, cron every minute
- `test/bot.test.js` run with `npm test`

Secrets never live in the code. Use wrangler secrets, or `.dev.vars` locally, which git ignores.

## Credit

The idea and the six Meta steps come from the Soulepreneur post "Build your own ManyChat": https://soulepreneur.com/posts/build-your-own-manychat

The code here is CAMBY Ai's, MIT licensed. It follows our own flow: one question first, then the link.

Not affiliated with or endorsed by Meta, Instagram, Cloudflare or ManyChat.
