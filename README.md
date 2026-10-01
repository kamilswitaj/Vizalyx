# Vizalyx

**Vizalyx** is a local-first AI Image Workbench built as a pure client-side Progressive Web App (PWA).

It enables precise, controllable image editing by combining visual selection tools (rectangle, brush, eraser), multi-model AI provider integrations, and an exact byte-level **Strict Mask Compositor** that guarantees pixels outside selected regions remain 100% untouched.

---

## Architecture & Principles

- **Pure Client-Side PWA**: Zero backend, zero Node.js server, zero ASP.NET Core, zero cloud databases, and zero proxy services.
- **Static Hosting**: Ready to host on GitHub Pages or any static CDN.
- **Bring Your Own Key (BYOK)**: API keys are used directly from the browser to communicate with AI providers.
- **In-Memory Credential Security**: Your OpenAI API key is held strictly in browser memory. It is **never** written to `localStorage`, `sessionStorage`, cookies, or IndexedDB. Refreshing or closing the tab clears the key.
- **Local-First Persistence**: Projects, run history, masks, and generated assets are stored entirely within your browser's IndexedDB via Dexie.

---

## Features

- **Multi-Tool Mask Editor**:
  - **Rectangle Selection**: Click and drag to create precise rectangular masks.
  - **Brush & Eraser**: Freehand painting and erasing with adjustable radius ($2\text{px} - 100\text{px}$).
  - **Undo / Redo & Clear**: Full undo/redo history for mask edits and canvas clearing.
  - **Pan & Zoom**: Smooth scroll-wheel zoom, middle-click pan, spacebar-to-pan (with input/textarea guard), and one-click "Fit to Viewport".
- **Strict Mask Compositor**:
  - Independent byte-level compositor operating directly on raw pixel buffers.
  - Value `0`: guarantees exact byte-copy of the original source pixel.
  - Value `255`: takes the generated AI pixel.
  - Configurable edge feathering ($0\text{px} - 32\text{px}$) for natural, seamless boundaries.
  - Automatically transforms provider results back into source coordinate space before compositing.
- **AI Providers**:
  - **Fake (Dev/Test)**: Fully deterministic, offline provider for development and automated testing without API costs.
  - **OpenAI GPT Image 2.5**: Official browser-direct integration supporting `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` with `standard` and `high` quality.
  - Conforms to OpenAI's official multipart contract: ordered `image[]` (source image first, reference images following), explicit `size`, inverted alpha `mask`, and automatic dimension normalization (multiples of 16, aspect ratios up to 3:1, total pixel bounds).
- **Run History & Parameter/Mask Restoration**:
  - Automatically saves every generation as an immutable Run in IndexedDB.
  - **Load Params**: Restores exact prompt, provider, model, quality, feathering, reference images, and the exact raster mask from the historical run.
  - Reference asset deduplication: Reused references do not duplicate blobs in storage.
- **Workspace Management**:
  - **New / Clear**: Quickly clear the canvas and reset the workspace to zero after opening or pasting an image.
  - **Projects Modal**: Switch between projects or delete completed projects and cascade-delete all associated assets.

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Local Development

```bash
# Clone the repository
git clone https://github.com/kamilswitaj/Vizalyx.git
cd Vizalyx

# Install dependencies
npm install

# Start local dev server
npm run dev
```

Open `http://localhost:5173/Vizalyx/` in your browser.

### Verification & Testing

```bash
# Typecheck TypeScript (strict mode)
npm run typecheck

# Run unit & integration tests (Vitest)
npm test

# Run browser E2E smoke tests (Playwright)
npm run test:e2e

# Build production bundle with PWA service worker
npm run build
```

---

## GitHub Pages Deployment

Vizalyx is configured to deploy automatically via GitHub Actions upon every push to the `main` branch (see `.github/workflows/deploy.yml`).

### Required One-Time Setup in GitHub:

1. Open your repository on GitHub: `https://github.com/kamilswitaj/Vizalyx`
2. Navigate to **Settings** $\rightarrow$ **Pages**.
3. Under **Build and deployment** $\rightarrow$ **Source**, change the selection from *"Deploy from a branch"* to **"GitHub Actions"**.
4. The deployment workflow will automatically publish the static PWA to:
   ```
   https://kamilswitaj.github.io/Vizalyx/
   ```

---

## Manual Live OpenAI Smoke Test

Automated test suites and CI runs do **not** invoke paid external AI APIs.

To perform an end-to-end verification against the live OpenAI GPT Image 2.5 API using your own API key:

```powershell
# Windows PowerShell / CMD
cmd /c "set OPENAI_API_KEY=sk-your-openai-api-key && npx vitest run tests/providers/openAiLiveSmoke.manual.test.ts"
```

The test will:
1. Generate a test source image and mask.
2. Submit the multipart request directly to `https://api.openai.com/v1/images/edits`.
3. Assert that a valid image PNG result is returned and processed.

If `OPENAI_API_KEY` is not present, this test is safely skipped.

---

## Security & BYOK Trade-Offs

- **No Intermediate Server**: Vizalyx has no backend server or proxy. Requests travel directly from your browser to OpenAI's endpoint over TLS.
- **In-Memory Storage**: API keys are stored only in JavaScript heap memory and are wiped as soon as the tab or window is closed or refreshed.
- **Direct Responsibility**: Because Vizalyx is a client-only BYOK app, API keys are subject to the security of the host machine and browser environment. Always use a dedicated, rate-limited API key with appropriate spending limits.

---

## License

MIT
