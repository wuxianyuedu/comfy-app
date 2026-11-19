// workflow-local-roots 的单一出处测试。
//
// 钉住真实缺陷：`getLocalWorkflowRoots`（list 磁盘扫描）经 `readEnvVar` 实时读 .env，
// `getAllowedLocalWorkflowRoots`（create 导入边界）读 `process.env` 启动快照；.env 新增目录后
// 界面扫得出「待导入」、导入却被「只允许配置目录下文件」拒绝。两者必须同走一份出处：改其一这里就红。

import { beforeEach, describe, expect, it, vi } from "vitest";

const envStub = vi.hoisted(() => ({
  /* SAFETY: 类型断言已复核 */
  localWorkflowsPath: null as string | null,
}));
vi.mock("~/lib/envfile", () => ({
  readEnvVar: vi.fn(() => envStub.localWorkflowsPath),
}));
vi.mock("~/lib/app-settings/app-settings.server", () => ({
  getSettingsSync: vi.fn(() => ({ comfyuiPath: "" })),
  deriveComfyuiWorkflowsDir: vi.fn(() => null),
}));

import {
  getAllowedLocalWorkflowRoots,
  getLocalWorkflowRoots,
  isWithinAllowedLocalWorkflowRoot,
} from "./workflow-local-roots";

beforeEach(() => {
  envStub.localWorkflowsPath = null;
});

describe("本地工作流根目录：扫描与导入守卫同源", () => {
  it(".env 里配置的额外目录对两个口径同时可见（守卫不再比扫描器严）", () => {
    envStub.localWorkflowsPath = "D:/wf-extra";
    expect(getLocalWorkflowRoots()).toContain("D:/wf-extra");
    expect(getAllowedLocalWorkflowRoots()).toContain("D:/wf-extra");
  });

  it("两份口径的根目录集合逐项一致", () => {
    envStub.localWorkflowsPath = "D:/wf-a\nD:/wf-b";
    expect(getAllowedLocalWorkflowRoots()).toEqual(getLocalWorkflowRoots());
  });

  it("isWithinAllowedLocalWorkflowRoot：目录内放行、目录外拒绝", () => {
    envStub.localWorkflowsPath = "D:/wf-extra";
    expect(isWithinAllowedLocalWorkflowRoot("D:/wf-extra/sub/a.json")).toBe(true);
    expect(isWithinAllowedLocalWorkflowRoot("D:/elsewhere/a.json")).toBe(false);
  });
});
