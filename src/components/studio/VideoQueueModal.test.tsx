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
 *
 * 另有一条判的是**失败通道**（台账 E4 第三刀之后）：整批都失败时，出口那句必须带上
 * 入参判据点名的那一列，而不是把原因吞成「检查参数或 ComfyUI 连接」。
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
const submitGenerationMock = vi.fn<
  (
    params: Record<string, unknown> | undefined,
    prompt: string,
  ) => Promise<unknown>
>(async () => {
  throw new Error(
    "这份请求的入参与当前形状不符（workflow：缺少要执行的工作流），这次没有发出去；请重新配置参数后再生成。",
  );
});
vi.mock("~/lib/media/video-queue-client", () => ({
  fetchVideoTasks: vi.fn(async () => []),
  submitGeneration: (
    params: Record<string, unknown> | undefined,
    prompt: string,
  ) => submitGenerationMock(params, prompt),
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

describe("VideoQueueModal 的批量提交出口", () => {
  it("整批都失败时，出口拿到的是判据点名的那一列，不是「检查参数或连接」", async () => {
    /* 「跳过失败项」是这条通路的域语义，但**第一条失败的原因不能一起跳掉**：
     * 草稿页签只有提示词、没有工作流来源，于是每条都过不了入参判据，而旧界面只给一句
     * 「提交失败，请检查参数或 ComfyUI 连接」—— 那既不是提示词框的问题也不是连接问题，
     * 用户照着那句话查错方向。原因本身来自客户端预检（见
     * `tests/task-list-wire-contract.test.ts` 的 `submitGeneration`），这里判的是它有没有走到界面。 */
    /* 播种走在 **prop 变化**上（挂载时就给同一份批次不会切页签 —— 那段判据写的是
     * 「换了批次」，不是「打开时有批次」），所以先空后有一发 rerender。 */
    const withDrafts = (items: { prompt: string }[]) => (
      <ToastProvider>
        <VideoQueueModal open onClose={() => undefined} draftItems={items} />
      </ToastProvider>
    );
    const view = render(withDrafts([]));
    view.rerender(withDrafts([{ prompt: "一条镜头" }]));

    fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
    expect(await screen.findByText(/缺少要执行的工作流/)).toHaveTextContent(
      "workflow",
    );
  });
});

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
