/**
 * 「生成队列 / 批量提交」这一排的判据（ISSUE #1925 / 规范 16 §16.2.4.75）。
 *
 * 它是「一排里选一个」的一处漏网：旧形态是两枚 `ghost` 按钮 + 选中三元，
 * **钉了底色却没钉字色** —— `ghost` 自带的 `hover:text-foreground` 仍在，
 * 于是划过已选中那一枚时只有字色被翻掉（底色因 `cn()` 摘掉了 `hover:bg-muted`
 * 而没变），看着像「选中态松了一半」。
 *
 * 这里钉的是收口后的形态：单选语义（radiogroup + radio）、两枚的选中态由
 * `tab` 一处驱动、且选中档**自带与常态同值的悬停**。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

import { ToastProvider } from "./ToastProvider";
import { VideoQueueModal } from "./VideoQueueModal";

/* 队列数据来自网络层；这一组用例只判那一排按钮的形态，喂空队列即可。 */
vi.mock("~/lib/media/video-queue-client", () => ({
  fetchVideoTasks: vi.fn(async () => []),
  submitVideoTasks: vi.fn(async () => ({ ok: true })),
}));

afterEach(cleanup);

function renderModal() {
  /* 「批量提交」那一档里挂着用 `useToast` 的子组件（导入提示词），
     所以要包一层 Provider —— 与它在页面里的真实宿主一致。 */
  render(
    <ToastProvider>
      <VideoQueueModal open onClose={() => undefined} draftItems={[]} />
    </ToastProvider>,
  );
}

describe("VideoQueueModal 的队列视图切换", () => {
  it("语义是单选，不是 aria-pressed 开关", () => {
    renderModal();

    const group = screen.getByRole("radiogroup", { name: "队列视图" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      expect(radio).not.toHaveAttribute("aria-pressed");
    }
    expect(screen.getByRole("radio", { name: "生成队列" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("选中档把字色悬停也钉回常态（旧形态只钉了底色）", () => {
    renderModal();

    const queue = screen.getByRole("radio", { name: "生成队列" });
    expect(queue.className).toContain("aria-checked:hover:bg-primary-soft");
    expect(queue.className).toContain("aria-checked:hover:text-primary-strong");
    /* 四层俱在：底色 / 字色 / 描边 / 字重。 */
    expect(queue.className).toContain("aria-checked:bg-primary-soft");
    expect(queue.className).toContain("aria-checked:text-primary-strong");
    expect(queue.className).toContain("aria-checked:border-primary");
    expect(queue.className).toContain("aria-checked:font-semibold");
  });

  it("切到「批量提交」后选中态对调", () => {
    renderModal();

    fireEvent.click(screen.getByRole("radio", { name: /批量提交/ }));
    expect(screen.getByRole("radio", { name: /批量提交/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "生成队列" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});
