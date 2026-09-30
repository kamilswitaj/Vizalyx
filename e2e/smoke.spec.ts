import { test, expect } from '@playwright/test';



test.describe('Vizalyx M1 E2E Smoke Test', () => {
  test('loads image, draws rect mask, types prompt with spaces, and generates strict mask result', async ({
    page,
  }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err));

    // 1. Open application
    await page.goto('./');
    await expect(page.getByText('Vizalyx')).toBeVisible();

    // 2. Generate a valid PNG buffer via browser canvas
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 200;
      c.height = 200;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('No ctx');
      ctx.fillStyle = '#4488ff';
      ctx.fillRect(0, 0, 200, 200);
      ctx.fillStyle = '#ff8844';
      ctx.fillRect(40, 40, 80, 80);
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

    // 3. Draw a rectangle mask
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 120);
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

    // 7. Verify Strict Mask result appears
    await expect(page.getByText('Final (Strict Mask)')).toBeVisible({ timeout: 15000 });
    await expect(page.getByAltText('Final result')).toBeVisible();
    await expect(page.getByText(/Done in \d+ms \(Strict Mask\)/)).toBeVisible();
  });
});
