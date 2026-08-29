# Video Wall

**English** | [简体中文](./README.md)

A multi-video matrix display page built with Next.js: choose how many videos to show (1–12) and any row × column layout, batch-upload files, add a title to each video, then start them all in sync with one click. All data is persisted on the server and survives page refreshes and device changes.

## Features

- **Dynamic count and matrix**: switch between 1–12 video slots with any row × column combination; prime counts automatically offer padded-matrix options; a single video fills the screen.
- **Multiple upload paths**: click an empty slot to pick a file, drag files onto the page, or use multi-select import; slots expand automatically when files outnumber empty positions.
- **Titles**: each video has its own title box that auto-grows, saves with a debounce, and survives refreshes.
- **Play in sync**: all videos rewind to the beginning and start together; global mute and loop toggles are persisted.
- **Server persistence**: video files and the manifest live on the server; streaming supports HTTP Range requests for seekable playback.
- **Refined interactions**: confirmation before shrinking slots, automatic cleanup of replaced files, non-stacking toasts, and zero layout jitter when switching layouts.

## Getting started

Requirements: Node.js ≥ 20.9 or Bun ≥ 1.1.

```bash
# Install dependencies
bun install          # or npm install

# Development mode (listens on http://localhost:3000)
bun run dev          # or npm run dev

# Production build and start
bun run build
bun run start
```

To stop the server: press Ctrl + C for foreground processes, or run `lsof -ti:3000 | xargs kill` to free port 3000.

## Standalone single-file version (no setup)

If you just want to play a few videos without installing anything, use [`standalone.html`](./standalone.html) at the repository root. It is a zero-dependency, single-file page that runs in any browser after download:

- Put `standalone.html` in the same folder as 6 videos named `video1.mp4` through `video6.mp4`;
- Open it in a browser to get a 3 × 2 video matrix with synchronized start, restart-all, a global loop toggle, and editable titles (stored in the browser's local storage, which must be allowed);
- No dependencies, no server process — handy for temporary demos and quick previews.

For custom video counts and matrices, server-side persistence, and cross-device access, use the full version above.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · sonner · filesystem storage (no database)

## Notes

- The project ships with **no authentication**. Any visitor can upload and delete content. When deploying to the public internet, configure access control (Basic Auth, IP allowlists, etc.) at your reverse proxy.
- Upload limits: no more than 200 MB per file; MP4 / MOV / WebM and other common video formats are supported; up to 12 video slots.
- All runtime data lives in the `data/` directory (gitignored). Copying that directory constitutes a complete backup.
- `prisma/` and `.env` are scaffolding leftovers; this project does not use a database and they can be safely ignored.

## Documentation

For architecture, data flow, the API reference, and constraints for further development, see [PROJECT.md](./PROJECT.md) (written in Chinese).

## License

This project is released under the [MIT License](./LICENSE).
