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
  - Configurable edge feathering ($0\text{px} - 50\text{px}$) for natural, seamless boundaries.
  - Automatically transforms provider results back into source coordinate space before compositing.
- **AI Providers**:
  - **Fake (Dev/Test)**: Fully deterministic, offline provider for development and automated testing without API costs.
  - **OpenAI GPT Image 2.5**: Official browser-direct integration supporting `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` with `low`, `medium`, `high`, `xhigh`, and `max` qualities.
  - Conforms to OpenAI's official multipart contract: canonical PNG source image, matching PNG mask with alpha channel, ordered `image[]` (source image first, reference images following), explicit `size`, and automatic dimension normalization (multiples of 16, aspect ratios $1:3 - 3:1$, total pixel bounds).
- **API Usage & Cost Tracking**:
  - **Exact Token Accounting**: Captures the actual `usage` object returned by OpenAI Image API responses (image input tokens, text input tokens, output image tokens, total tokens) without estimates.
  - **Versioned Pricing Schedule**: Pure calculation based on official OpenAI GPT Image 2.5 rates ($8/1M image input, $5/1M text input, $30/1M image output) preserved without internal rounding.
  - **Live NBP USD/PLN Exchange Rate**: Queries National Bank of Poland (NBP Table A) average exchange rate directly from the client, cached per local day with stale offline fallback.
  - **Non-Blocking Resilience**: Missing usage, network errors, or NBP service downtime never fail or block image generation.
  - **Immutable Snapshots**: Each completed generation permanently records its USD cost, effective PLN exchange rate, rate date, and token usage into IndexedDB.
  - **Costs & Usage Modal**: Accessible via the toolbar `Costs` button. Displays Total Spend, By Model & Quality, and By Edit Mode with scope toggle (Current Project vs. All Local Projects). Excludes Fake (Dev/Test) provider runs from paid totals.
  - **Bilingual Currency Display**: Primary PLN formatted per Polish locale conventions (`0,26 zł`) with informative tooltip; secondary USD displayed with 4-5 decimals (`$0.0674`).
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

Open `http://localhost:5173/` in your browser.

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

Vizalyx is configured to deploy automatically via GitHub Actions upon every push to the `main` branch (see `.github/workflows/ci.yml`).

### Custom Domain & GitHub Pages Setup:

1. Open your repository on GitHub: `https://github.com/kamilswitaj/Vizalyx`
2. Navigate to **Settings** $\rightarrow$ **Pages**.
3. Under **Build and deployment** $\rightarrow$ **Source**, select **"GitHub Actions"**.
4. Under **Custom domain**, enter your domain:
   ```
   vizalyx.izabelaswitaj.pl
   ```
   and ensure DNS (CNAME pointing to your `<username>.github.io` or configured records) is verified. GitHub Pages natively manages the TLS certificate and routing for this custom domain directly through repository settings.
5. The deployment workflow publishes the static PWA to root-path:
   ```
   https://vizalyx.izabelaswitaj.pl/
   ```

---

## Manual Live OpenAI Smoke Test

Automated test suites and CI runs do **not** invoke paid external AI APIs.

To perform an end-to-end verification against the live OpenAI GPT Image 2.5 API using your own API key in a real Chromium browser:

```powershell
# Windows PowerShell / CMD
cmd /c "set OPENAI_API_KEY=sk-your-openai-api-key&& npm run test:e2e:live"
```

This test:
1. Launches the Vizalyx application in a real Chromium browser instance.
2. Injects the API key into in-memory Settings and validates connectivity.
3. Selects the official OpenAI provider and model.
4. Generates a source image, creates an interactive mask, and sends a prompt.
5. Verifies the multipart request succeeds against `https://api.openai.com/v1/images/edits`.
6. Asserts that the Strict Mask result is rendered accurately with matching source dimensions.

If `OPENAI_API_KEY` is not set or when running in CI, this test is safely skipped.

---

## Security & BYOK Trade-Offs

- **No Intermediate Server**: Vizalyx has no backend server or proxy. Requests travel directly from your browser to OpenAI's endpoint over TLS.
- **In-Memory Storage**: API keys are stored only in JavaScript heap memory and are wiped as soon as the tab or window is closed or refreshed.
- **Direct Responsibility**: Because Vizalyx is a client-only BYOK app, API keys are subject to the security of the host machine and browser environment. Always use a dedicated, rate-limited API key with appropriate spending limits.

---

## License

MIT
