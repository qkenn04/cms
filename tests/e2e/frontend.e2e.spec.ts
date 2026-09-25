import { test, expect } from '@playwright/test'

test.describe('Frontend', () => {
  test('trang chủ CMS chuyển tới /admin', async ({ page }) => {
    await page.goto('http://localhost:3000')
    await expect(page).toHaveURL(/\/admin/)
  })
})
