import { test, expect } from '@playwright/test';

/**
 * Opt-in manual live OpenAI smoke test.
 *
 * Runs end-to-end against the real OpenAI GPT Image 2.5 API in a real browser.
 *
 * To execute:
 *   cmd /c "set OPENAI_API_KEY=sk-... && npm run test:e2e:live"
 *
 * This test is strictly opt-in and is automatically skipped whenever
 * OPENAI_API_KEY is unset or when running in CI.
 */
test.describe('OpenAI Live End-to-End Smoke Test', () => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const shouldSkip = Boolean(process.env.CI) || !apiKey || !apiKey.startsWith('sk-');

  test('generates an image edit via real OpenAI provider in the browser', async ({ page }) => {
    test.skip(shouldSkip, 'Requires valid OPENAI_API_KEY and must never run in CI');
    test.setTimeout(180_000);

    // 1. Open app
    await page.goto('./');
    await expect(page.getByText('Vizalyx')).toBeVisible();

    // 2. Prepare and load a clean 1024x1024 test image
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 1024;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('No ctx');
      ctx.fillStyle = '#1e3a5f';
      ctx.fillRect(0, 0, 1024, 1024);
      return c.toDataURL('image/png');
    });

    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles({
      name: 'live-test-source.png',
      mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64'),
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // 3. Open Settings and enter the real OpenAI API key
    await page.getByRole('button', { name: /Settings/i }).click();
    await expect(page.getByText('OpenAI BYOK Configuration')).toBeVisible();

    const keyInput = page.getByPlaceholder('sk-...');
    await keyInput.fill(apiKey!);

    const validateBtn = page.getByRole('button', { name: 'Validate' });
    await validateBtn.click();
    await expect(page.getByText('Connected successfully')).toBeVisible({ timeout: 30_000 });

    // Close settings modal
    await page.getByRole('button', { name: '✕' }).click();

    // 4. Select OpenAI provider in the sidebar
    const providerSelect = page.locator('select').first();
    await providerSelect.selectOption('openai');

    // Select 'low' quality to minimize latency and credits for the smoke test
    const qualitySelect = page.locator('select').nth(2);
    await qualitySelect.selectOption('low');

    // 5. Draw a rectangular mask in the center
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const startX = box.x + box.width / 2 - 30;
    const startY = box.y + box.height / 2 - 30;
    const endX = box.x + box.width / 2 + 30;
    const endY = box.y + box.height / 2 + 30;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    // 6. Enter prompt
    const promptArea = page.getByPlaceholder('Describe the edit...');
    await promptArea.click();
    await promptArea.fill('a glowing bright golden emblem in the center');

    // 7. Click Generate
    const generateBtn = page.getByRole('button', { name: 'Generate' });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // 8. Wait for live generation to complete and verify final result
    await expect(page.getByText('Final (Strict Mask)')).toBeVisible({ timeout: 120_000 });
    const finalImg = page.getByAltText('Final result').first();
    await expect(finalImg).toBeVisible();

    const dimensions = await page.evaluate(async () => {
      const img = document.querySelector('img[alt="Final result"]') as HTMLImageElement;
      if (!img) throw new Error('Final result image not found');
      if (!img.complete) {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
      }
      return { width: img.naturalWidth, height: img.naturalHeight };
    });

    expect(dimensions.width).toBe(1024);
    expect(dimensions.height).toBe(1024);
  });
});
