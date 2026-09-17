// @vitest-environment jsdom
// 「选择文件」与「拖入文件」两个入口的回归（规范 11.2 行为测试）：导入面板此前
// 只有粘贴 JSON 一条路（拖入链路存在却没接线），本文件锁住两个文件入口都走同一个
// 漏斗 —— 读文件 → 识别格式 → 预填面板 → 由用户确认后走同一条导入提交。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { WorkflowImportPanel } from "./WorkflowImportPanel";
import {
  useWorkflowImport,
  type UseWorkflowImportArgs,
} from "./workflow-library/hooks/use-workflow-import";

afterEach(cleanup);

const API_GRAPH = { "3": { class_type: "KSampler", inputs: { seed: 1 } } };
const FILE_LABEL = "选择工作流 JSON 文件";

/** 面板只消费 hook 返回的 state，所以让真 hook 跑起来、只把 mutation 换成假的。 */
const createMut = {
  mutateAsync: vi.fn(),
} as unknown as UseWorkflowImportArgs["createMut"];

function Harness() {
  const state = useWorkflowImport({ createMut, load: () => undefined });
  return (
    <WorkflowImportPanel
      state={state}
      onClose={() => undefined}
      onImport={() => undefined}
    />
  );
}

/** jsdom 各版本对 `Blob.text()` 的支持不一致，这里直接钉死读取结果。 */
function jsonFile(name: string, content: unknown): File {
  const text = JSON.stringify(content);
  const file = new File([text], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

function pickFile(file: File) {
  fireEvent.change(screen.getByLabelText(FILE_LABEL), {
    target: { files: [file] },
  });
}

describe("导入面板的文件入口", () => {
  it("提供「选择文件」入口，input 限定 JSON / .workflow", () => {
    render(<Harness />);

    const input = screen.getByLabelText<HTMLInputElement>(FILE_LABEL);
    expect(input.accept).toContain(".json");
    expect(
      screen.getByRole("button", { name: /选择文件/ }),
    ).toBeInTheDocument();
  });

  it("选择文件后预填名称与 JSON 内容", async () => {
    render(<Harness />);

    pickFile(jsonFile("my-flow.json", API_GRAPH));

    await waitFor(() => {
      expect(screen.getByDisplayValue("my-flow")).toBeInTheDocument();
    });
    const textarea =
      screen.getByPlaceholderText<HTMLTextAreaElement>(/API 格式/);
    expect(textarea.value).toContain("class_type");
  });

  it("把文件拖到面板上同样能导入", async () => {
    const { container } = render(<Harness />);
    const panel = container.firstElementChild;
    expect(panel).not.toBeNull();

    fireEvent.drop(panel!, {
      dataTransfer: {
        files: [jsonFile("dropped.json", API_GRAPH)],
        types: ["Files"],
      },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("dropped")).toBeInTheDocument();
    });
  });

  it("拖入无法识别的 JSON：给出可见原因，不静默丢弃", async () => {
    render(<Harness />);

    pickFile(jsonFile("unknown.json", { hello: 1 }));

    expect(await screen.findByText(/无法识别的工作流格式/)).toBeInTheDocument();
  });
});
