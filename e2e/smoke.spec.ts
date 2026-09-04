import { expect, test } from "@playwright/test";

/**
 * 冒烟用例：不依赖 ComfyUI 后端，也不需要登录态。
 * 选择器文本均来自 src/app/login/page.tsx 与 src/components/studio/HomePage.tsx 的真实文案。
 */

// @critical：规范 11.7 的 CI 门禁只跑这一类关键流程（CLI: --grep @critical）。
// 新增冒烟用例若属于「合并前必须验证的主流程」，请带上同一个 tag。
test.describe("登录页冒烟", () => {
  test("@critical 渲染登录表单关键元素并支持切换注册模式", async ({ page }) => {
    await page.goto("/login");

    // 品牌与引导文案
    await expect(
      page.getByText("登录以同步你的作品、工作流与训练任务"),
    ).toBeVisible();

    // 邮箱 / 密码输入框（登录态）
    await expect(page.getByPlaceholder("name@example.com")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // 提交按钮（登录模式下表单内 type=submit 的按钮，避免与顶部「登录」Tab 重名）
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toBeVisible();
    await expect(submit).toHaveText("登录");

    // 切换到注册模式：出现昵称字段，提交按钮变为「创建并登录」
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page.getByText("创建一个本地账号，开启你的 AI 创作")).toBeVisible();
    await expect(page.getByText("昵称（可选）")).toBeVisible();
    await expect(submit).toHaveText("创建并登录");
  });
});

test.describe("首页冒烟", () => {
  test("@critical 首页重定向到 /workspace 且创作台正常渲染", async ({ page }) => {
    await page.goto("/");

    // src/app/page.tsx 服务端 redirect("/workspace")
    await expect(page).toHaveURL(/\/workspace$/);

    // 创作台 Hero 标题（无需登录、不依赖 ComfyUI 后端）
    await expect(
      page.getByRole("heading", { name: "灵感从这里开始" }),
    ).toBeVisible();
  });
});
