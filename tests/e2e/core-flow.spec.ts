import { expect, test } from "@playwright/test";

test("admin creates official mnemonic, user submits, reviewer approves, user reviews", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill("admin@example.com");
  await page.getByPlaceholder("密码").fill("password123");
  await page.getByRole("button", { name: "登录" }).click();

  await page.goto("/admin/words/new");
  const unique = `flowword${Date.now()}`;
  await page.getByPlaceholder("word").fill(unique);
  await page.getByPlaceholder("词性").fill("n.");
  await page.getByPlaceholder("短中文释义").fill("流程词");
  await page.getByPlaceholder("中文释义").fill("用于端到端测试的流程词");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(`编辑 ${unique}`)).toBeVisible();

  await page.getByPlaceholder("标题").fill("官方流程助记");
  await page.locator("textarea[name=contentMarkdown]").first().fill(`通过 [[word:philosophy]] 和 [[root:soph]] 连接 ${unique}`);
  await page.getByRole("button", { name: "保存官方助记" }).click();

  await page.goto(`/word/${unique}`);
  await expect(page.getByText("官方流程助记")).toBeVisible();
  await expect(page.locator('a[href="/word/philosophy"]')).toBeVisible();
  await expect(page.locator('a[href="/node/root/soph"]')).toBeVisible();

  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill("user@example.com");
  await page.getByPlaceholder("密码").fill("password123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto(`/word/${unique}`);
  await page.getByRole("button", { name: "保存我的助记" }).click();
  await page.getByRole("button", { name: "提交审核" }).click();

  await page.goto("/login");
  await page.getByPlaceholder("邮箱").fill("reviewer@example.com");
  await page.getByPlaceholder("密码").fill("password123");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/admin/reviews");
  await page.getByRole("button", { name: "通过" }).first().click();

  await page.goto(`/word/${unique}`);
  await expect(page.getByText("用户公开助记")).toBeVisible();
  await page.getByRole("button", { name: "加入复习" }).click();
  await page.goto("/review");
  await page.getByRole("button", { name: "认识" }).first().click();
});
