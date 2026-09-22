# Recording the demos

The recordings in [`docs/demos/`](../demos/README.md) are made by one script,
`scripts/demos/record.mjs`, with two of Vercel's tools. Each does the part it is
built for.

| Recording | Tool | Server | Why that pairing |
|---|---|---|---|
| `home`, `our-story`, `explore-caa`, `phone` | [webreel](https://github.com/vercel-labs/webreel) 0.1.4 | production build on 3330 | Scripted tours with a drawn cursor and on-screen keystrokes. Production, because a dev server paints its badge into every frame. |
| `your-weekend` | [agent-browser](https://github.com/vercel-labs/agent-browser) 0.27.0 | `NODE_ENV=test` server on 3331 | The page is personal. Only the test server lets a seeded household sign in by header, and agent-browser can set those headers. |

Neither tool is a dependency of the site. The script fetches each one at its pinned
version with `npm exec`, so `npm ci` in CI and on Vercel never downloads a browser
recorder. Encoding uses ffmpeg: webreel's own copy under `~/.webreel/bin/ffmpeg`
when there is one, otherwise `ffmpeg` on `PATH`.

## The scripts

- `demos/webreel.config.json`: the four tours. The steps scroll by measured
  distances, because webreel clicks at viewport coordinates and does not scroll a
  target into view first. If a layout changes height, check the scroll steps
  before recording.
- `demos/your-weekend.steps.json`: the guest journey, one agent-browser command per
  step. Every click on a control below the fold has a `scrollintoview` before it
  for the same reason.
- `demos/hide-dev-overlay.js`: hides Next's dev badge on the test server.

## Recording

```bash
# 1. A production build served on 3330, with the environment of CI's
#    "Production-build specs" step in .github/workflows/design-quality.yml
#    (its CI-only placeholder secrets, PGLITE_MEMORY, DB_AUTO_SEED, RATE_LIMIT_BACKEND=db),
#    with BETTER_AUTH_URL and NEXT_PUBLIC_SITE_URL set to http://localhost:3330
npm run build
npm run start -- -p 3330

# 2. The test server on 3331, with the environment of that workflow's
#    "NODE_ENV=test server" step (NODE_ENV=test, SEED_TEST_FIXTURES=1, TEST_AUTH_SECRET, …)
#    and both URLs set to http://localhost:3331
npm run dev -- -p 3331

# 3. Record everything, or name the recordings you want
npm run demos:record
npm run demos:record -- our-story explore-caa
npm run demos:record -- your-weekend --dry   # screenshots at each noted step, no video
npm run demos:record -- --encode             # re-encode the takes already in demos/.out
```

A production server refuses to start while `TEST_AUTH_SECRET` is set. If your
`.env` carries the test-server values, move it aside for step 1.

`--dry` is the quick check before a real take. It runs the guest steps and saves
a screenshot after each step that has a `note`, so you can see that every click
landed.

Raw takes land in `demos/.out/`, which git ignores. The script writes the
encoded files to `docs/demos/`:

- `<name>.mp4`: H.264, 1280px wide (390px for the phone), no audio, `faststart`.
- `<name>.gif`: 8 fps, 720px wide (320px for the phone), a 96-colour palette.
  GitHub plays GIFs inline, so the README and PR descriptions embed these and
  link to the MP4.

Each full re-record adds about 16 MB to the repository's history, so re-record
when a page has visibly changed, not on every commit.

## Things that went wrong once

- **agent-browser's `record start` opens a fresh browser context.** Headers set
  with `--headers` on an earlier `open`, and scripts registered with
  `--init-script`, do not follow into it. The script sets the fixture headers
  after recording starts, then evaluates the badge-hiding style once the page has
  loaded. The encoder trims those first seconds of blank tab and loading
  (`demos/.out/your-weekend.trim`).
- **agent-browser writes full-range video.** Decoded as limited range, the cream
  paper clips to white. The encoder reads WebM takes as full range
  (`scale=in_range=pc`).
- **Every agent-browser call must see the same environment.** If one call omits
  `AGENT_BROWSER_EXECUTABLE_PATH` or `AGENT_BROWSER_ARGS`, the daemon relaunches
  the browser and the page is lost. The script passes one environment to every
  call.
- **In a sandbox that runs as root**, Chromium needs `--no-sandbox`: set
  `AGENT_BROWSER_ARGS=--no-sandbox` and point `AGENT_BROWSER_EXECUTABLE_PATH` at a
  local Chromium. webreel launches the `chrome-headless-shell` it downloads into
  `~/.webreel/bin`. Where that download is blocked, a small shell script at that
  path that runs a local Chromium with `--headless=new` works.
