# 🎫 Golden Ticket

A tiny web game. Everyone gets **one roll every 10 seconds** and each roll has a
**1 in 10,000** chance of winning the golden ticket. A winner gets a unique ticket
code (e.g. `GT-7KQ2-M9XA-P4TR`), and you check winners on a password-protected owner page.

- Rolls happen **on the server** with `crypto.randomInt`, so nobody can fake a win from the browser.
- The 10-second limit is enforced **on the server**, per browser *and* per IP address.
- Every win is saved to `data.json` with the ticket code, name, time, roll number and IP address.
- The owner page (`/owner.html`) lists all winners and has a box to check whether a ticket code is real.
- Optional auto-roll, a name field, personal stats, recent winners, confetti.

## Run it locally

You need Node.js 20.12 or newer.

```bash
npm install
cp .env.example .env    # then set ADMIN_PASSWORD
npm start
```

- Game: http://localhost:3000
- Owner page: http://localhost:3000/owner.html

## Checking winners

Open `/owner.html` and enter your `ADMIN_PASSWORD`. You'll see every golden ticket,
newest first. When someone says they won, paste their code into the box. It tells you
if the code is real and who won it.

Wins are also printed in the server log:

```
[win] Sam won the golden ticket GT-7KQ2-M9XA-P4TR on roll #48211
```

The owner page locks an IP out for 15 minutes after 5 wrong passwords. If
`ADMIN_PASSWORD` isn't set, the owner page is off.

## Test the win flow

Don't wait 28 hours for a win. Set the odds to 1 in 2 for a test run:

```bash
WIN_ODDS=2 npm start
```

Delete `data.json` afterwards to clear the test winners and roll count.

## Deploy it

Any host that runs Node works (Render, Railway, Fly.io, a VPS...):

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Environment variables:** `ADMIN_PASSWORD` (set it in the host's dashboard; never commit `.env`).

Notes:
- `TRUST_PROXY` defaults to `1`, which is right for hosts that put a proxy in front of
  your app (most do). If people reach the server directly, set `TRUST_PROXY=false`,
  otherwise players can dodge the IP limit by faking the `X-Forwarded-For` header.
- Many free tiers wipe the disk on every deploy or restart, which would erase `data.json`
  and **your list of winners**. Point `DATA_FILE` at a persistent disk/volume.

## Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `ADMIN_PASSWORD` | none (owner page off) | Password for `/owner.html` |
| `PORT` | `3000` | HTTP port |
| `TRUST_PROXY` | `1` | Express `trust proxy` setting, used for real client IPs |
| `DATA_FILE` | `./data.json` | Where winners and the roll count are saved |
| `WIN_ODDS` | `10000` | 1 in N chance per roll. Lower it only for testing |

## API

- `GET /api/state`: odds, total rolls, recent winners (names only), and how long until you can roll again.
- `POST /api/roll` with `{ "name": "..." }`: rolls once. Returns `429` with `waitMs` if
  you rolled less than 10 seconds ago.
- `POST /api/owner/winners` with `{ "password": "..." }`: every winner with their ticket code.
