# Running your own Panes share server

A shared space lives on a share server: it keeps the room's log of changes, passes changes, cursors and call set-up
between the people in it, and serves the web board to people who join in a browser. It cannot read any of it.
Everything is encrypted with a key made from the secret in the invite link, and that secret never reaches the
server. Files and live tabs go straight between the computers.

Anyone can run one. People add it in Panes under **Settings, Shared space servers**: new spaces can go there, and
invites to it join without asking.

## What a server can and cannot see

- It cannot read boards, chat, file names or live tabs.
- It does see who connects (IP addresses), when, how many people are in a room, and how much traffic passes.
- It can refuse service or lose a room's log. Every member keeps a copy of the board, so nothing is lost for good.
- People who join in a **web browser** load the board's page from this server. A server that changed that page
  could read the spaces those people open. People in Panes are not affected: Panes uses its own code.

## Run it

It is one file, `relay.ts`, and needs only [Bun](https://bun.sh). SQLite and WebSockets are built in.

```sh
bun install
bun run build:share-web         # the web board, served at /s/<room>
PORT=8787 DATA_DIR=./data WEB_DIR=share/web/public bun share/server/relay.ts
```

Or with Docker, built from the repository root:

```sh
docker build -f share/server/Dockerfile -t panes-share .
docker run -p 10000:10000 -v panes-share:/data panes-share
```

`render.yaml` at the repository root deploys it on Render as-is.

Put it behind HTTPS: Panes only joins `https://` servers (plain `http://` only on `localhost`, for testing).
`GET /health` answers `ok`, and Panes checks that when someone adds the server.

## Settings (environment)

| Variable                            | What it does                                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                              | Port to listen on (8787).                                                                                                                                                                                                                                           |
| `DATA_DIR`                          | Where the rooms' SQLite database goes. Rooms nobody opens for 90 days are deleted.                                                                                                                                                                                  |
| `WEB_DIR`                           | The built web board (`share/web/public`). Without it, browser joining does not work.                                                                                                                                                                                |
| `TURN_URLS`, `TURN_SECRET`          | A TURN server of your own (coturn's `use-auth-secret`), for live tabs between computers that cannot connect directly. Comma-separated addresses, for example `turn:turn.example.com:3478,turns:turn.example.com:5349`. The server hands out logins that last a day. |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | A Cloudflare TURN key instead.                                                                                                                                                                                                                                      |
| `STATS_KEY`                         | Lets `GET /usage/stats` be read with that key; without it, nobody can.                                                                                                                                                                                              |

Without any TURN setting, people get STUN only. Most live tabs still work; some networks block direct connections.
Panes never sends files through TURN, so TURN traffic is only ever live tabs, and Panes sends a smaller picture when a
call has to go through it.

Each person can also set their own TURN server in Panes, under **Settings, Shared space servers**. It is used
instead of the server's for that person's live-tab calls.
