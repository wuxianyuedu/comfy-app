import { describe, it, expect, beforeEach } from "vitest";
import { useShellTabs, MAIN_TAB_ID } from "./shell-tabs-store";

function reset() {
  useShellTabs.setState({
    tabs: [{ id: MAIN_TAB_ID, label: "主应用", url: null, closable: false }],
    activeTabId: MAIN_TAB_ID,
  });
}

beforeEach(reset);

describe("shell-tabs-store 应用级页签状态", () => {
  it("初始状态：仅含主应用页签且激活", () => {
    const s = useShellTabs.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]!.id).toBe(MAIN_TAB_ID);
    expect(s.activeTabId).toBe(MAIN_TAB_ID);
  });

  it("openTab 新增页签并激活", () => {
    useShellTabs.getState().openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true });
    const s = useShellTabs.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]!.id).toBe("comfyui");
    expect(s.tabs[1]!.url).toBe("http://127.0.0.1:8188");
    expect(s.activeTabId).toBe("comfyui");
  });

  it("openTab 使用稳定 id 时复用已有页签（不叠出重复）", () => {
    const st = useShellTabs.getState();
    st.openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true });
    st.openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8189", closable: true });
    const s = useShellTabs.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]!.url).toBe("http://127.0.0.1:8189");
    expect(s.activeTabId).toBe("comfyui");
  });

  it("activateTab 切换激活页签", () => {
    const st = useShellTabs.getState();
    st.openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true });
    useShellTabs.getState().activateTab(MAIN_TAB_ID);
    expect(useShellTabs.getState().activeTabId).toBe(MAIN_TAB_ID);
  });

  it("closeTab 关闭页签并回退到相邻页签", () => {
    const st = useShellTabs.getState();
    st.openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true });
    useShellTabs.getState().closeTab("comfyui");
    const s = useShellTabs.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(MAIN_TAB_ID);
  });

  it("closeTab 不可关闭主应用页签", () => {
    useShellTabs.getState().closeTab(MAIN_TAB_ID);
    const s = useShellTabs.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(MAIN_TAB_ID);
  });

  it("openTab 复用已有页签时同步 blockedUrl（重启换端口后说明里的地址跟着更新）", () => {
    const st = useShellTabs.getState();
    st.openTab({
      id: "comfyui",
      label: "ComfyUI",
      url: null,
      closable: true,
      blockedReason: "探测失败",
      blockedUrl: "http://127.0.0.1:8188",
    });
    st.openTab({
      id: "comfyui",
      label: "ComfyUI",
      url: null,
      closable: true,
      blockedReason: "探测失败",
      blockedUrl: "http://127.0.0.1:8189",
    });
    const s = useShellTabs.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]!.blockedUrl).toBe("http://127.0.0.1:8189");
  });

  /* 复用页签时 blockedUrl 与 blockedReason 同规则：**没有新结论就清空**。
   * 地址必须跟着「这一次的说明」走 —— 留着上一次的地址，用户复制去浏览器
   * 会打开一个早已换端口的实例，比没有地址更误导。 */
  it("openTab 复用页签时未带 blockedUrl 则清空（不留下上一次的地址）", () => {
    const st = useShellTabs.getState();
    st.openTab({
      id: "comfyui",
      label: "ComfyUI",
      url: null,
      closable: true,
      blockedUrl: "http://127.0.0.1:8188",
    });
    st.openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true });
    expect(useShellTabs.getState().tabs[1]!.blockedUrl).toBeNull();
  });

  it("updateTab 更新页签标题/地址", () => {
    const st = useShellTabs.getState();
    st.openTab({ id: "comfyui", label: "ComfyUI", url: "http://127.0.0.1:8188", closable: true });
    useShellTabs.getState().updateTab("comfyui", { label: "ComfyUI 2" });
    const s = useShellTabs.getState();
    expect(s.tabs[1]!.label).toBe("ComfyUI 2");
  });
});
