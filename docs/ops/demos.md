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

The design pipeline's two tours (`stages-by-subdomain`, `stages-by-path`) have a script of their
own, `scripts/demos/record-stages.mjs` (`npm run demos:stages`), covered at the end of this page.

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

## The stage tours (`npm run demos:stages`)

`demos/stages.webreel.json` walks the design pipeline's stages through the wedding app: every
stage by subdomain, then by path, and the addresses that must 404. It needs the app built with
the stages assembled into it, on port 3000, as CI's stages job 5 runs it:

```bash
npm run stages:assemble && npm run build     # assemble first: next start indexes public/ at boot
npm run start                                # with that job's environment (CI placeholders)
npm run demos:stages                         # both tours → docs/demos/stages-by-*.{mp4,gif}
```

How it differs from the other tours, and why:

- **Every frame shows its address.** webreel records the page, not the address bar, and these tours
  exist to show which host serves what. `demos/recorder-preload.cjs` (loaded with
  `node --require`) patches the DevTools client webreel uses so each new page draws a strip with
  the HTTP status and its own `location`. The browser writes it, so a tour cannot claim an
  address it is not on.
- **The subdomain tour browses `kendrick.localhost`**, the default the stages are assembled for
  (`scripts/stages/assemble.mjs`). Chromium resolves every `*.localhost` to this machine and treats
  it as secure over plain http. Two other names were tried and failed:
  - `dev.localhost` → `localhost` is a cross-site hop, because Chromium treats `localhost` as a
    top-level domain. The renderer is swapped and webreel's screenshots stay on the old one.
  - `kendrick.test` gets its navigations and stylesheets upgraded to https, by Chromium and by the
    site's own CSP (`upgrade-insecure-requests`), and nothing answers there.
- **Its own webreel home.** webreel launches whatever sits at
  `$HOME/.webreel/bin/chrome-headless-shell`. The script runs it with `HOME=demos/.out/home`,
  holding a wrapper around a local Chromium in new headless mode, and links in the ffmpeg from your
  own `~/.webreel`. Your `~/.webreel` is not changed. New headless mode matters: under webreel's
  `--enable-begin-frame-control`, a real chrome-headless-shell (downloaded, or Playwright's)
  stalls on every `Page.captureScreenshot` and the take has no frames.
- **A host change does not break the take.** While a navigation commits, a screenshot can hang for
  good or fail for a moment. webreel waits on a hung call with no timeout, and retries a failed
  one with no pause (ten in a few milliseconds abort the recording). The preload gives each
  attempt 1.5s and retries every 150ms for up to 4s. A tour that still fails is recorded again,
  up to three times.
- **ffmpeg.** webreel 0.1.4 downloads `ffmpeg-n7.1-latest-linux64-gpl-7.1.tar.xz`, which BtbN no
  longer publishes. Unpack a current release build (for example
  `ffmpeg-n8.1-latest-linux64-gpl-8.1.tar.xz`) into `~/.webreel/bin/ffmpeg/`. BtbN's `master`
  nightly also fails, on webreel's MJPEG pipe.
