import { test, expect } from '@playwright/test';

test.describe('Vizalyx M1 E2E Smoke Test', () => {
  test('loads image, draws rect mask, types prompt with spaces, and generates strict mask result', async ({
    page,
  }) => {
    // 1. Open application
    await page.goto('./');
    await expect(page.getByText('Vizalyx')).toBeVisible();

    // 2. Generate a valid 200x200 PNG buffer via browser canvas
    // Background is #4488ff (RGBA: 68, 136, 255, 255)
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('No ctx');
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(0, 0, 200, 200);
      return c.toDataURL('image/png');
    });

    const base64Data = dataUrl.split(',')[1]!;
    const testImageBuffer = Buffer.from(base64Data, 'base64');

    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles({
      name: 'input.png',
      mimeType: 'image/png',
      buffer: testImageBuffer,
    });

    // Verify canvas appears
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // 3. Draw a rectangle mask inside the canvas
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Drag from center toward offset to guarantee hitting source coordinates
    const startX = box.x + box.width / 2 - 30;
    const startY = box.y + box.height / 2 - 30;
    const endX = box.x + box.width / 2 + 30;
    const endY = box.y + box.height / 2 + 30;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY);
    await page.mouse.up();

    // 4. Enter a prompt containing spaces
    const promptArea = page.getByPlaceholder('Describe the edit...');
    await promptArea.click();
    await promptArea.pressSequentially('make the selected region red with modern design');
    expect(await promptArea.inputValue()).toBe('make the selected region red with modern design');

    // 5. Verify Strict Mask mode is selected
    const strictRadio = page.getByLabel('Strict Mask');
    await expect(strictRadio).toBeChecked();

    // 6. Click Generate
    const generateBtn = page.getByRole('button', { name: 'Generate' });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // 7. Verify Strict Mask result appears in UI
    await expect(page.getByText('Final (Strict Mask)')).toBeVisible({ timeout: 15000 });
    const finalImg = page.getByAltText('Final result');
    await expect(finalImg).toBeVisible();
    await expect(page.getByText(/Done in \d+ms \(Strict Mask\)/)).toBeVisible();

    // 8. Prove pipeline pixel correctness:
    // - known pixel outside mask (195, 195) MUST EXACTLY equal source RGBA [68, 136, 255, 255]
    // - known pixels inside mask MUST reflect Fake Provider transformation (elevated red)
    const inspection = await page.evaluate(async () => {
      const img = document.querySelector('img[alt="Final result"]') as HTMLImageElement;
      if (!img) throw new Error('Final result img element not found');

      if (!img.complete) {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
      }

      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Outside pixel: bottom-right corner at (195, 195)
      const outsideData = Array.from(ctx.getImageData(195, 195, 1, 1).data);

      // Center pixel: (100, 100), where rectangle was drawn
      const centerData = Array.from(ctx.getImageData(100, 100, 1, 1).data);

      return {
        dimensions: { width: c.width, height: c.height },
        outsideData,
        centerData,
      };
    });

    // Check dimensions match source 200x200
    expect(inspection.dimensions).toEqual({ width: 200, height: 200 });

    // Assert outside pixel is exactly equal to original source RGBA
    expect(inspection.outsideData).toEqual([68, 136, 255, 255]);

    // Assert inside pixel reflects Fake Provider 50% red blend (red elevated, blue reduced)
    expect(inspection.centerData[0]).toBeGreaterThan(100);
    expect(inspection.centerData[2]).toBeLessThan(200);
  });
});
