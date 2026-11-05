# 🎫 Golden Ticket

A tiny luck game. Everyone gets **one roll every 10 seconds**, and each roll has a **1 in 10,000** chance of landing on 10,000 and winning the golden ticket. A winner gets a unique ticket code (like `GT-7KQ2-M9XA-P4TR`) to show the owner when they claim their prize.

Play it at **https://busyworkcitizen.github.io/golden-ticket/** once GitHub Pages is on (see below).

## How to play

- **Roll.** Press the button (or Space). Five slot reels spin and stop one by one on a number from 1 to 10,000. Only 10,000 wins.
- **Suspense.** If the reels are on track for a close call (9…, 99…, 999…), the next reel holds back and the ticket starts to glow. A win builds all the way up.
- **Wait.** Then you wait 10 seconds before you can roll again. The countdown ring shows how long.
- **Auto-roll.** Turn it on and the page rolls for you every 10 seconds while it's open.
- **Win.** You get a golden ticket with a code. Screenshot it and show the code to the owner.
- **Sound.** Clicks, thunks and a win chime, made in the browser. Turn them off with the Sound switch.

At one roll every 10 seconds, the average player needs about 28 hours of non-stop rolling to win.

## Running it

The game is one file, `index.html`, with no build step and no dependencies. Open it in a browser to play.

To host it, turn on GitHub Pages for the repository and serve the `main` branch from the root:
**Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save.**
A minute later it's live at `https://busyworkcitizen.github.io/golden-ticket/`.

### Two ways it runs

- **Public site, on its own.** Rolls and the 10-second wait happen in each player's browser, and stats are saved there. It works right away, but anyone who knows how to use their browser's developer tools could fake a win, and you have no list of winners to check codes against.
- **Public site with the table server** (below, free). The server does every roll, so wins can't be faked. It enforces the 10-second limit per player *and* per IP address, counts rolls from everyone, shows the winners leaderboard, and saves every winner. You check them on the owner page.

### Table server (free)

The table server is a Cloudflare Worker (`worker/index.ts`) with a built-in SQLite database (a Durable Object). Both run on Cloudflare's free plan, and the database is created automatically when the Worker deploys.

1. **Deploy the Worker.** Sign up free at [dash.cloudflare.com](https://dash.cloudflare.com), open Workers & Pages, create an application and import this GitHub repository. Cloudflare reads `wrangler.toml` and deploys it. From a terminal you can run `npm install`, `npx wrangler login` and then `npm run worker:deploy` instead.
2. **Set the owner password.** In the Worker, open Settings → Variables and Secrets and add a secret named `ADMIN_PASSWORD`. Use something long. (Or run `npx wrangler secret put ADMIN_PASSWORD`.)
3. **Check it.** Opening the Worker's URL (something like `https://golden-ticket.<your-subdomain>.workers.dev`) should show `"table": true` and `"ownerPage": true`.
4. **Point the site at it.** Set `serverUrl` in `config.json` to that URL. GitHub's web editor is fine. GitHub Pages redeploys and the site uses the server.

If the server can't be reached when the page loads, the page falls back to rolling in the browser.

How the server keeps it fair:
- It picks every roll with a secure random number generator. The page only displays the result.
- It allows one roll per 10 seconds per player and per IP address, so clearing the browser or opening more tabs doesn't help.
- It only accepts calls from the sites listed in `ALLOWED_ORIGINS` in `wrangler.toml`.
- The owner page locks an IP address out for 15 minutes after 5 wrong passwords.

Cloudflare's free plan allows about 100,000 requests a day. Each roll is one request, so that's roughly 10 people auto-rolling around the clock, or many more casual players.

If you host the site somewhere other than `https://busyworkcitizen.github.io`, add that origin to `ALLOWED_ORIGINS`.

## Winners leaderboard

With the table server connected, the game page shows a leaderboard of everyone who has found a golden ticket:

- Players are ranked by how many tickets they've won. Ties go to whoever found their first ticket earliest.
- It shows the top 10, with medals for the top 3. If you've won but aren't in the top 10, your own row is added underneath.
- Your row is highlighted, and it flashes when you win.
- Each player appears under the name they typed on their latest win. Names and dates are public; ticket codes and IP addresses are not.

The leaderboard needs the table server, since it's the only place every player's wins are collected. On its own, the site shows each player only their own tickets.

## Checking winners

Open **`owner.html`** on the site (`https://busyworkcitizen.github.io/golden-ticket/owner.html`) and enter your `ADMIN_PASSWORD`. You'll see every golden ticket, newest first, with the code, name, time, roll number and IP address. When someone says they won, paste their code into the box. It tells you if the code is real and who won it.

The owner page needs the table server. Without it, there is no list to check against.

## Testing the server locally

```bash
npm install
```

```bash
npx wrangler dev --var ALLOWED_ORIGINS:http://localhost:8080 --var ADMIN_PASSWORD:test --var WIN_ODDS:2
```

`WIN_ODDS=2` makes every roll a 1 in 2 chance so you can see wins quickly. Serve the site with `python3 -m http.server 8080`, set `serverUrl` in `config.json` to `http://localhost:8787` (don't commit that), and open http://localhost:8080.

## Project layout

```
index.html         The game page: markup, styles and script.
owner.html         The owner's winners list and ticket checker (needs the table server).
config.json        Tells the public site where the table server lives.
worker/index.ts    The table server: rolls, 10-second limit, roll count, winners, owner login.
wrangler.toml      Server settings: allowed sites, database.
```
