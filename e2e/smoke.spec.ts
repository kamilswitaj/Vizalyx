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

    // 4b. Attach a reference image
    const refInput = page.getByTestId('ref-file-input');
    await refInput.setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: testImageBuffer,
    });
    await expect(page.getByAltText('Reference')).toBeVisible();

    // 5. Verify Strict Mask mode is selected
    const strictRadio = page.getByLabel('Strict Mask');
    await expect(strictRadio).toBeChecked();

    // 6. Click Generate
    const generateBtn = page.getByRole('button', { name: 'Generate' });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // 7. Verify Strict Mask result appears in UI
    await expect(page.getByText('Final (Strict Mask)')).toBeVisible({ timeout: 15000 });
    const finalImg = page.getByAltText('Final result').first();
    await expect(finalImg).toBeVisible();
    await expect(page.getByText(/Done in \d+ms/)).toBeVisible();

    // Verify view toggle in toolbar
    await expect(page.getByRole('button', { name: 'Mask Editor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspect Result' })).toBeVisible();

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

    // 8. Verify Run History and Projects persistence
    await expect(page.getByText('Run History')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load Params' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View Result' })).toBeVisible();

    // Verify Projects modal opens and displays project
    const projectsBtn = page.getByRole('button', { name: /Projects/i });
    await projectsBtn.click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
  });

  test('supports brush, eraser, clear mask, undo, and redo interactions', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByText('Vizalyx')).toBeVisible();

    // 1. Generate and load test image
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('No ctx');
      ctx.fillStyle = '#2266aa';
      ctx.fillRect(0, 0, 200, 200);
      return c.toDataURL('image/png');
    });

    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles({
      name: 'input2.png',
      mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64'),
    });

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // 2. Select Brush tool
    const brushBtn = page.getByRole('button', { name: 'Brush' });
    await brushBtn.click();
    await expect(brushBtn).toHaveClass(/toolBtnActive/);

    // Verify Brush size control is visible
    await expect(page.getByText(/Size/)).toBeVisible();

    // Paint a stroke across center
    await page.mouse.move(box.x + 40, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 100);
    await page.mouse.up();

    // Verify Undo is enabled
    const undoBtn = page.getByRole('button', { name: 'Undo' });
    const redoBtn = page.getByRole('button', { name: 'Redo' });
    await expect(undoBtn).toBeEnabled();
    await expect(redoBtn).toBeDisabled();

    // 3. Select Eraser tool
    const eraserBtn = page.getByRole('button', { name: 'Eraser' });
    await eraserBtn.click();
    await expect(eraserBtn).toHaveClass(/toolBtnActive/);

    // Erase a vertical strip cutting through the stroke
    await page.mouse.move(box.x + 100, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 140);
    await page.mouse.up();

    // 4. Test Undo / Redo on Eraser
    await undoBtn.click();
    await expect(redoBtn).toBeEnabled();
    await redoBtn.click();

    // 5. Test Clear Mask, Undo, and Redo visual consistency on canvas
    const clearBtn = page.getByRole('button', { name: 'Clear Mask' });
    await expect(clearBtn).toBeEnabled();

    // Verify mask layer canvas has visible pixels before clear
    const countMaskPixels = () =>
      page.evaluate(() => {
        const canvases = document.querySelectorAll('.konvajs-content canvas');
        const maskCanvas = canvases[1] as HTMLCanvasElement | undefined;
        if (!maskCanvas) return 0;
        const ctx = maskCanvas.getContext('2d');
        if (!ctx) return 0;
        const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i]! > 0) count++;
        }
        return count;
      });

    // Verify mask layer canvas has visible pixels before clear (Brush painted)
    await expect.poll(async () => countMaskPixels()).toBeGreaterThan(0);

    // Clear mask -> empty
    await clearBtn.click();
    await expect.poll(async () => countMaskPixels()).toBe(0);

    // Undo Clear -> visible
    await undoBtn.click();
    await expect.poll(async () => countMaskPixels()).toBeGreaterThan(0);

    // Redo Clear -> empty
    await redoBtn.click();
    await expect.poll(async () => countMaskPixels()).toBe(0);

    // Undo Clear again so subsequent operations have mask context -> visible
    await undoBtn.click();
    await expect.poll(async () => countMaskPixels()).toBeGreaterThan(0);

    // 6. Test Fit button
    const fitBtn = page.getByRole('button', { name: 'Fit' });
    await expect(fitBtn).toBeEnabled();
    await fitBtn.click();

    // 7. Test Pan tool
    const panBtn = page.getByRole('button', { name: 'Pan' });
    await panBtn.click();
    await expect(panBtn).toHaveClass(/toolBtnActive/);
  });

  test('supports New button to clear workspace back to zero', async ({ page }) => {
    await page.goto('./');
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 100;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('No ctx');
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 100, 100);
      return c.toDataURL('image/png');
    });

    const fileInput = page.getByTestId('file-input');
    await fileInput.setInputFiles({
      name: 'test-clear.png',
      mimeType: 'image/png',
      buffer: Buffer.from(dataUrl.split(',')[1]!, 'base64'),
    });

    // Verify canvas is mounted
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // Click New button
    const newBtn = page.getByRole('button', { name: 'New' });
    await expect(newBtn).toBeVisible();
    await newBtn.click();

    // Verify workspace is reset back to zero (drop zone is visible)
    await expect(page.getByText('Open, paste (Ctrl+V), or drag & drop an image to start')).toBeVisible();
  });
});

