# 🎫 Golden Ticket

A tiny luck game. Everyone gets **one roll every 5 seconds**, and each roll has a **1 in 10,000** chance of landing on 10,000. But there's only **one golden ticket a day**: the first player to hit 10,000 takes it, rolling closes for everyone, and a new ticket drops at midnight. The winner gets a unique ticket code (like `GT-7KQ2-M9XA-P4TR`) to show the owner when they claim their prize.

Play it at **https://busyworkcitizen.github.io/golden-ticket/** once GitHub Pages is on (see below).

## How to play

- **Roll.** Press the button (or Space). Five slot reels spin and stop one by one on a number from 1 to 10,000. Only 10,000 wins.
- **Suspense.** If the reels are on track for a close call (9…, 99…, 999…), the next reel holds back and the ticket starts to glow. A win builds all the way up.
- **Wait.** Then you wait 5 seconds before you can roll again. The countdown ring shows how long.
- **Auto-roll.** Turn it on and the page rolls for you every 5 seconds while it's open.
- **Win.** You get a golden ticket with a code. Screenshot it and show the code to the owner.
- **One a day.** Once today's ticket is found, the ticket is stamped CLAIMED with who found it and when, and the button counts down to midnight.
- **Sound.** Clicks, thunks and a win chime, made in the browser. Turn them off with the Sound switch.
- **Haptics.** On phones, the reels thunk, near misses pulse and a win buzzes. Android vibrates; iPhones (iOS 18 and later) get light taps. Turn them off with the Haptics switch.
- **Mini widget.** In Chrome or Edge on a computer, press *Mini widget* to pop the ticket into a small always-on-top window you can keep over a game (see below).

At one roll every 5 seconds, the average player needs about 14 hours of non-stop rolling to win.

## Running it

The game is one file, `index.html`, with no build step and no dependencies. Open it in a browser to play.

To host it, turn on GitHub Pages for the repository and serve the `main` branch from the root:
**Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save.**
A minute later it's live at `https://busyworkcitizen.github.io/golden-ticket/`.

### Two ways it runs

- **Public site, on its own.** Rolls and the 5-second wait happen in each player's browser, and stats are saved there. It works right away, but anyone who knows how to use their browser's developer tools could fake a win, and you have no list of winners to check codes against. Players can't see each other, so "one ticket a day" only closes the game for the player who won, until their own midnight.
- **Public site with the table server** (below, free). The server does every roll, so wins can't be faked. It hands out one golden ticket a day for everyone, enforces the 5-second limit per player *and* per IP address, counts rolls from everyone, shows the winners leaderboard, and saves every winner. You check them on the owner page.

### Table server (free)

The table server is a Cloudflare Worker (`worker/index.ts`) with a built-in SQLite database (a Durable Object). Both run on Cloudflare's free plan, and the database is created automatically when the Worker deploys.

1. **Deploy the Worker.** Sign up free at [dash.cloudflare.com](https://dash.cloudflare.com), open Workers & Pages, create an application and import this GitHub repository. Cloudflare reads `wrangler.toml` and deploys it. From a terminal you can run `npm install`, `npx wrangler login` and then `npm run worker:deploy` instead.
2. **Set the owner password.** In the Worker, open Settings → Variables and Secrets and add a secret named `ADMIN_PASSWORD`. Use something long. (Or run `npx wrangler secret put ADMIN_PASSWORD`.)
3. **Set your time zone.** The daily ticket resets at midnight in `TIMEZONE` in `wrangler.toml`, which starts as `UTC`. Change it to yours, such as `America/New_York`, `America/Chicago`, `America/Los_Angeles` or `Europe/London`, and commit.
4. **Check it.** Opening the Worker's URL (something like `https://golden-ticket.<your-subdomain>.workers.dev`) should show `"table": true`, `"ownerPage": true` and your `"timeZone"`.
5. **Point the site at it.** Set `serverUrl` in `config.json` to that URL. GitHub's web editor is fine. GitHub Pages redeploys and the site uses the server.

If the server can't be reached when the page loads, the page falls back to rolling in the browser.

How the server keeps it fair:
- It picks every roll with a secure random number generator. The page only displays the result.
- It allows one roll per 5 seconds per player and per IP address, so clearing the browser or opening more tabs doesn't help.
- It awards one golden ticket per day. Requests are handled one at a time, so two players can't both win the same day.
- It only accepts calls from the sites listed in `ALLOWED_ORIGINS` in `wrangler.toml`.
- The owner page locks an IP address out for 15 minutes after 5 wrong passwords.

Cloudflare's free plan allows about 100,000 requests a day. Each roll is one request, so that's roughly 5 people auto-rolling around the clock, or many more casual players.

If you host the site somewhere other than `https://busyworkcitizen.github.io`, add that origin to `ALLOWED_ORIGINS`.

## One golden ticket a day

With the table server connected, there's one ticket per day for everyone:

- The first roll of 10,000 wins it. From then on, every roll is refused until midnight in `TIMEZONE`.
- Everyone's ticket gets stamped **CLAIMED** with the winner's name, the time and how many rolls it took. Players who are on the page when it happens see the stamp slam down on their next roll, or within a minute if they're idle.
- The roll button turns into a countdown to the next ticket. At midnight the page reopens on its own.
- The winner's ticket is stamped **YOURS** instead.

## Mini widget

In Chrome or Edge on a computer, **⧉ Mini widget** moves the ticket, the roll button and the Auto-roll and Sound switches into a small window that stays on top of other windows. Turn on Auto-roll, start your game, and keep an eye on the reels in the corner.

- It's the same page in a different window, not a copy, so it's always in sync. Close it (or press *Bring it back*) and everything returns to the page.
- It stays on top of games running in a window or borderless window. Games in exclusive fullscreen draw over everything, so switch those to borderless.
- It keeps rolling while the browser tab is hidden. Closing the browser tab closes the widget too.
- It uses Chrome's and Edge's Document Picture-in-Picture feature. Firefox and Safari don't have it yet, so the button doesn't appear there.

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
worker/index.ts    The table server: rolls, 5-second limit, one ticket a day, leaderboard, owner login.
wrangler.toml      Server settings: allowed sites, time zone, database.
```
