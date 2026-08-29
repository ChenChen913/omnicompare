# OmniCompare (灵动对比)

**English** | [简体中文](./README.md)

A multi-content parallel comparison workspace (AI output comparison tool) built with Next.js: put the outputs of different models / tools for the same task — videos and HTML pages — side by side in one matrix for visual comparison and evaluation. The project evolved from "Video Wall", inheriting its server-side persistence, matrix layout, and batch playback capabilities, and has grown into a multi-content workspace. All data is persisted on the server and survives page refreshes and device changes.

## Features

- **Two content types**: videos (MP4 / MOV / WebM and other common formats) and single-file self-contained HTML pages; HTML runs immediately after upload (CSS animations and JS interactions both work), with cards showing live loading status.
- **Dynamic count and matrix**: switch between 1–12 content slots with any row × column combination; prime counts automatically offer padded-matrix options; a single item fills the screen.
- **Multiple import paths**: click an empty slot to pick a file, drag files onto the page, or use multi-select import; slots expand automatically when files outnumber empty positions.
- **Batch playback control**: play all / pause all / restart all / loop / global mute / playback speed (0.5×–2×), applied to all video items; HTML pages keep their own runtime rhythm and are never timeline-controlled.
- **Aspect ratio and title visibility**: switch the global card-frame ratio (original / 16:9 / 9:16 / 1:1) at any time, with per-card overrides; content is always shown fully via contain (never cropped); hide all titles and info rows with one click for pure viewing and screen recording. All settings live on the server and sync across devices.
- **Sandboxed HTML rendering**: double protection via the iframe `sandbox` attribute and server-side security headers (CSP, nosniff); page scripts are fully isolated from the main app, so pages from any model can be displayed safely.
- **Studio / Focus modes**: Studio offers a sidebar and full management controls; Focus hides all management UI and leaves only the content matrix — ideal for demos and screen recording; switching never loses content or interrupts playback.
- **Dark / light themes**: dark by default, one-click toggle in the top bar, fully tokenized colors that work in both themes.
- **Titles**: each item has its own title box (typically the model name, e.g. GPT / Claude / Gemini) that auto-grows, saves with a debounce, and survives refreshes.
- **Server-side multi-project persistence**: content files and manifests are stored per project on the server; streaming supports HTTP Range requests for seekable video playback.
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

For multiple content types, server-side persistence, and cross-device access, use the full version above.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · sonner · filesystem storage (no database)

## Notes

- The project ships with **no authentication**. Any visitor can upload and delete content. When deploying to the public internet, configure access control (Basic Auth, IP allowlists, etc.) at your reverse proxy.
- Upload limits: videos up to 200 MB each (MP4 / MOV / WebM and other common formats); HTML must be a single self-contained file up to 10 MB; up to 12 content slots.
- HTML pages must be **single-file self-contained** (inlined CSS/JS); pages depending on sibling local CSS / JS / image files are not supported yet, while external CDN resources load fine.
- All runtime data lives in the `data/` directory (gitignored). Copying that directory constitutes a complete backup.
- `prisma/` and `.env` are scaffolding leftovers; this project does not use a database and they can be safely ignored.

## Documentation

For architecture, data flow, the API reference, and constraints for further development, see [PROJECT.md](./PROJECT.md) (written in Chinese); for the product roadmap and confirmed decisions, see [docs/BLUEPRINT.md](./docs/BLUEPRINT.md).

## License

This project is released under the [MIT License](./LICENSE).
