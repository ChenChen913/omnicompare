# OmniCompare (灵动对比)

**English** | [简体中文](./README.md)

OmniCompare: a comparison workspace that puts videos, images, and HTML pages produced by multiple AI models into one matrix for side-by-side review.

https://github.com/user-attachments/assets/94a8c775-da2a-4a25-bdb8-92f341eb76ee

> An 11-second screen recording — click to play (with background music).

Real output from a local run:

```text
$ bun run dev

▲ Next.js 16.1.3 (Turbopack)
- Local:         http://localhost:3000
✓ Starting...
✓ Ready in 665ms
```

## Table of contents

- [Why this project](#why-this-project)
- [Features](#features)
- [Getting started](#getting-started)
- [Usage](#usage)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Project structure](#project-structure)
- [Development](#development)
- [FAQ](#faq)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Why this project

After feeding the same prompt to several models, the outputs end up scattered across browser tabs, download folders,
and chat windows, and comparing them means switching windows. OmniCompare collects them into one page matrix: each
video, image, or HTML page takes one cell, so you can play, scroll, and compare them on a single screen.

It is not a video site and not a file manager. It is an AI output comparison tool. The project evolved from an earlier
"Video Wall": server-side persistence, matrix layout, batch playback, and the upload pipeline were all inherited, and
the product was renamed once images and HTML pages joined videos.

## Features

- **Three content types in one matrix**: videos (MP4 / MOV / WebM and other common formats), images (PNG / JPG / GIF / WebP / SVG / BMP / AVIF), and HTML pages. HTML accepts either a single file (≤10MB) or a zip page bundle (≤50MB).
- **Adjustable matrix**: 1–12 content slots with any row × column combination; switch between automatic layout and an explicit matrix; slots expand automatically when you import more files than slots.
- **Multi-project**: projects are grouped as active / draft / archived and are fully isolated from each other. Switch from the top bar, or browse everything in the Library view.
- **Three import paths**: click an empty slot, drag files onto the page, or multi-select import.
- **Batch playback**: play-all / pause / loop / global mute / playback rate. Pure-HTML projects have no playback semantics, so the primary action becomes "Refresh all". In Focus mode, Space / F toggles one-key playback (videos and BGM rewind together and start in sync) ⇄ pause-all — no mouse on screen while recording.
- **Background music**: one project-level BGM track, supporting MP3 / WAV / FLAC / M4A / AAC / OGG (≤50MB each). Upload it from the "Music" button in the top bar (a status dot appears once set; clicking again replaces it); volume and removal live in "Play → Background music", stored per project. Focus mode adds a one-click "loop from the start" button in the bottom-right corner: videos and the music rewind together, start in sync, and loop — built for screen recording.
- **Auto-fit viewport**: when the wall grows taller than the viewport, it scales down proportionally until everything fits on screen (screenshots and recordings capture it all); always on in Focus mode.
- **Implicit controls**: video progress bars and play buttons are hidden by default and appear only while the pointer hovers over a card; during Focus-mode playback they never appear, keeping recordings clean.
- **Adaptive top bar**: the controls follow the content you imported; there is no mode to pick manually.
- **Studio / Focus modes, dark / light themes.**
- **Sandboxed rendering**: HTML and SVG are doubly isolated by iframe `sandbox="allow-scripts"` plus server-side CSP headers.
- **Server-side persistence**: content and settings are stored per project on the server and survive device changes; video streaming supports HTTP Range requests.

## Getting started

Requirements: Node.js ≥ 20.9 (or Bun ≥ 1.1).

```sh
bun install
bun run dev
```

Open <http://localhost:3000> and drag videos, images, or HTML files onto the page.

If you do not want to install anything, [`standalone.html`](./standalone.html) at the repository root is a
zero-dependency single-file version: put it next to `video1.mp4` … `video6.mp4`, open it in a browser, and you get a
3 × 2 video matrix with synchronized start. It only plays videos, keeps titles in browser local storage, and does not
depend on the main application.

## Usage

1. **Create a project** from the project switcher in the top bar. The sidebar card's "Manage" entry renames it, changes its status, or deletes it (the default project cannot be deleted).
2. **Pick slots and matrix**: open "Layout" in the top bar, choose 1–12 slots, then pick rows × columns. Matrices marked "补" do not divide evenly and leave empty cells at the end.
3. **Import content**: click any empty slot, drag files onto the page, or use multi-select import. Files beyond the slot count expand the matrix automatically; dropping onto an occupied card never overwrites it — the file lands in the next free slot.
4. **Add titles**: each cell has a title box, typically the model name. It saves on blur, up to 100 characters.
5. **Compare playback**: with videos present, "Play all" rewinds every video and starts them together. Loop, mute, speed, and background music live in the "Play" menu in the top bar; title and info visibility live in the "Title" menu — all stored on the server. To add music, click the "Music" button in the top bar and pick a file (≤50MB); adjust the volume under "Play → Background music". In Focus mode, Space or F toggles play/pause (videos and BGM in sync); combined with implicit controls you can record entirely from the keyboard.
6. **Reorder**: drag the number badge in a card's top-left corner.
7. **Per-card ratio**: the ratio button on the info row overrides the global ratio for that card; "Follow" restores it.
8. **Remove**: the trash icon on a card removes one item; the trash icon in the top bar clears everything (with confirmation, irreversible).

zip page bundle requirements: a root-level `index.html` is required, assets must be referenced with relative paths
(an absolute `/x` resolves against the site rather than the bundle), asset extensions go through an allowlist, and the
bundle must stay within 120MB uncompressed and 300 files.

## Configuration

Server code reads no environment variables; everything configurable comes from the start scripts and container config:

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Production listen port |
| `NODE_ENV` | No | `production` | Injected by `bun run start` |
| `HOSTNAME` | No | `0.0.0.0` | Listen address inside the container |
| `TZ` | No | `Asia/Shanghai` | Container time zone |
| `KEEP` | No | `14` | How many backups `scripts/backup-data.sh` keeps |
| `DEST` | No | `<repo>/backups` | Output directory of `scripts/backup-data.sh` |

Upload and capacity limits live in `src/lib/types.ts` and are shared by client and server:

| Constant | Value | Meaning |
|---|---|---|
| `MAX_FILE_SIZE` | 200MB | Single video |
| `MAX_IMAGE_SIZE` | 20MB | Single image |
| `MAX_HTML_SIZE` | 10MB | Single HTML file |
| `MAX_AUDIO_SIZE` | 50MB | Single background music file (MP3 / WAV / FLAC / M4A / AAC / OGG) |
| `MAX_BUNDLE_SIZE` | 50MB | zip page bundle, compressed |
| `MAX_BUNDLE_UNCOMPRESSED` | 120MB | zip page bundle, uncompressed total |
| `MAX_BUNDLE_FILES` | 300 | Files inside a zip page bundle |
| `SLOT_MAX` | 12 | Content slots, and the item cap of the v2 API |

All state lives in the `data/` directory (gitignored): a backup is a copy of `data/`. There is also a script:

```sh
bash scripts/backup-data.sh          # archive into backups/, keeping 14 by default
KEEP=30 bash scripts/backup-data.sh  # custom retention
```

## Deployment

The bundled Docker setup mounts `./data` from the host:

```sh
docker compose up -d --build     # build and start, listening on 3000
docker compose logs -f
```

The image is a multi-stage build; the runtime is `node:24-slim` plus the standalone output, without source or
dependencies. A health check probes `/api/videos` every 30 seconds.

Without Docker:

```sh
bun run build
bun run start                    # production mode, port from PORT, default 3000
```

Besides `next build`, `bun run build` copies `.next/static` and `public` into `.next/standalone` and verifies the copy
afterwards. Without those files the server returns a 200 homepage that renders as a blank page in the browser.

> ⚠️ **Add access control before exposing this to the internet.** The project has no authentication at all; any
> visitor can upload and delete content. Put Basic Auth or an IP allowlist in front of it, or add a login layer.
> For the same reason `public/robots.txt` disallows all crawlers by default.

## Project structure

```text
src/
├── app/
│   ├── layout.tsx                # Root layout: fonts, theme provider, global toaster
│   ├── globals.css               # Theme tokens (@theme inline), scan sources, anti-jitter rules
│   ├── page.tsx                  # Home page, renders <VideoWall />
│   └── api/
│       ├── videos/               # v1 view endpoints (default project / ?project=id)
│       ├── projects/             # schema v2 endpoints (new UI and further development)
│       ├── files/[name]/         # Content file stream (Range 206; sandboxed headers for HTML/SVG)
│       └── bundles/[name]/[[...path]]/  # Assets inside a zip bundle
├── components/
│   ├── video/video-wall.tsx      # Main component: top bar, grid, batch logic, multi-project
│   ├── video/video-card.tsx      # One cell: object-contain, drag upload, sandboxed iframe
│   └── ui/                       # shadcn/ui components (only the ones in use)
└── lib/
    ├── types.ts                  # Shared constants, types, and pure helpers
    ├── project-store.ts          # v2 storage core: project lock, atomic writes, streaming unzip
    ├── video-store.ts            # v1 compatibility facade
    ├── v1-project-param.ts       # v1 ?project= resolution
    └── v2-project-param.ts       # v2 [id] resolution
scripts/                          # build helpers, dead-code scan, tests, backups
data/                             # Runtime data (gitignored)
standalone.html                   # Zero-dependency single-file version
```

Architecture, data flow, the API reference, and constraints for further development are in
[PROJECT.md](./PROJECT.md); the product blueprint is in [docs/BLUEPRINT.md](./docs/BLUEPRINT.md); the backlog is in
[ROADMAP.md](./ROADMAP.md); hard-won lessons are in [docs/LESSONS-LEARNED.md](./docs/LESSONS-LEARNED.md).
These documents are written in Chinese.

## Development

```sh
bun run dev          # dev server, logs to both the terminal and dev.log
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
bun run build        # production build (with a standalone copy self-check)

# API regression suite (no external dependencies, 62 assertions)
# ⚠️ The script wipes ALL content of the default project at the end (all=1).
#    Run it only against a local development environment, and make sure the
#    default project holds nothing you need; back up data/ first if it does.
node scripts/api-regression-test.mjs

# Dead-code scan: lists unreachable modules from the import graph
bun run scripts/find-dead-code.mjs
```

`scripts/api-adversarial-test.sh` (v1 compatibility layer) and `scripts/api-v2-smoke-test.sh` (v2) are the older
adversarial suites; they need `curl`, `jq`, and `python3` installed, and fail outright without `jq`.

Read the invariants in [PROJECT.md](./PROJECT.md) §11 before changing code. Add UI components with
`npx shadcn@latest add <name>` (`components.json` is already configured).

### Update the homepage demo

The top of the README is a GitHub attachment video — the Markdown renderer strips `<video>` / `<iframe>` tags, and
attachment links (`user-attachments`, ≤10MB) are the only way to embed a playable video. After recording a new demo:

```sh
node scripts/make-demo-media.mjs your-recording.mp4 --keep-mp4
```

The script compresses the raw recording into a compact `docs/demo.mp4` (900px, H.264, faststart). To get the
attachment link, open any issue, drag that MP4 into the comment box, copy the generated
`https://github.com/user-attachments/assets/…` link, swap it into the top of both READMEs, then delete the draft
issue (the link keeps working). Attachment links can only be produced by dragging the file onto github.com; they
are not version-controlled.

## FAQ

**`bun run dev` works but `dev.log` stays empty.**
Check that you are using the current dev script. It pipes logs through `scripts/run-with-log.mjs`; earlier versions
wrote `... | tee dev.log`, which leaves a 0-byte file on Windows because `tee` is unavailable there.

**After `bun run build`, the server starts and the homepage returns 200 but renders blank.**
Check whether `.next/standalone/.next/static` exists. A failed copy step leaves exactly that state — HTML 200 with
every static asset 404. The current build script verifies the copy and exits non-zero instead.

**`npm run dev` fails with `EADDRINUSE: address already in use :::3000`.**
Something else holds the port — usually a previous dev server that was never shut down (closing the terminal window
does not stop it). The dev script checks the port up front and tells you the owning PID plus three ways out:

```
✗ 端口 3000 已被占用，服务没能启动。
  占用它的进程 PID：34712
  三种处置方式：
    1) taskkill /PID 34712 /F        (Windows; use `kill 34712` on macOS/Linux)
    2) set PORT=3001 && bun run dev  (use `PORT=3001 bun run dev` on macOS/Linux)
    3) netstat -ano | findstr :3000
```

**Startup reports `Unable to acquire lock at .next/dev/lock`.**
Another dev instance is already running for this project (Next's single-instance lock). Stop the old instance, or
delete `.next/dev/lock` if you are sure there is none. The script warns about this file before starting.

**Uploading a zip page bundle reports a missing root `index.html`.**
The entry file must sit at the very root of the archive, not inside a subdirectory.

**Videos do not autoplay.**
Browsers block autoplay with sound. Global mute is on by default, and every playback action happens after a click.

**How do I change the port?**
For development, use `PORT=3001 bun run dev` (the script states explicitly when the port comes from the environment,
so it never drifts silently). For production, use `PORT=8080 bun run start`.

## Known limitations

- **No authentication**: every API is unauthenticated, so anyone can upload and delete. Access control is your responsibility before going public.
- **The mutex only works in a single process**: manifest read-modify-write is serialized by an in-process promise queue. Multiple instances or machines break consistency; you would need a file lock, a Redis lock, or a database.
- **No resumable or deduplicated uploads**: uploads are whole-body FormData requests, so large videos are bounded by the server body limit (Next has none by default, but reverse proxies usually do, for example nginx's `client_max_body_size`).
- **No cross-browser test matrix**: the UI uses newer CSS features such as `aspect-ratio`, `scrollbar-gutter`, and `100dvh`. Recent versions of Chrome / Edge / Safari / Firefox are recommended.
  <!-- TODO: 需补充——给出实际验证过的浏览器与最低版本区间 -->
- **Assets inside a zip bundle are served by plain file reads**, without Range support for video-sized assets. Do not put large videos in a bundle.

## Contributing

Issues and pull requests are welcome at
<https://github.com/ChenChen913/omnicompare/issues>. Before submitting, make sure this passes:

```sh
bun run typecheck && bun run lint && bun run build
node scripts/api-regression-test.mjs
```

If your change touches manifest writes, upload validation, or sandbox response headers, please name the relevant
invariant from [PROJECT.md](./PROJECT.md) §4.2 in the pull request description.

## License

[MIT](LICENSE) © 2026 ChenChen913

Third-party dependencies (Next.js, React, Tailwind CSS, shadcn/ui, and others) keep their own licenses; this
project's MIT license does not change their terms.
