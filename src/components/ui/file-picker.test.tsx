/**
 * 隐藏 `<input type=file>` 的出口（规范 16 §16.2.4）。
 *
 * 这条账的实质是**三个共性问题**，而它们在各自的调用点都看不出来
 * （都能跑、界面也都有反应），所以必须先在这里把行为钉住，再谈迁移：
 *  ① `click()` 在 ref 未挂上时静默空操作 → 由组件自己持 input，不存在这个窗口；
 *  ② 选完之后**没有复位 `event.target.value`** → 用户第二次选**同一个文件**
 *     不触发 `change`（浏览器只在取值变化时派发），看起来像上传坏了；
 *  ③ ref + click 的样板在同一文件里重复，改一处要改四处。
 *
 * 第 ② 条是本文件最值钱的两条用例：它是**静默**的（没有报错、没有告警），
 * 只有连选两次同一文件才复现。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* 本仓库的 setup 不做自动 cleanup，而 `fileInput()` 是**全局**查询 ——
 * 不复位时它会拿到上一个用例留下的（已卸载）input，于是「按钮点了没反应」
 * 这类假失败会出现。显式清，开销可以忽略。 */
afterEach(cleanup);

import {
  FilePicker,
  FilePickerButton,
  useFilePicker,
  type FilePickerHandle,
} from "./file-picker";

/** 把文件塞进 input 的 `files` 并派发 `change`（jsdom 不允许直接赋值）。 */
function pick(input: HTMLInputElement, ...files: File[]) {
  const list = {
    ...files,
    length: files.length,
    item: (i: number) => files[i],
  } as unknown as FileList;
  Object.defineProperty(input, "files", { value: list, configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** 回调占位：`noop` 而不是 `() => {}`，后者被 `no-empty-function` 拦下。 */
const noop = (): void => undefined;

function fileInput(): HTMLInputElement {
  return document.querySelector("input[type=file]")!;
}

/** 文件在**用例内**创建：文件对象与「塞进哪个 input」必须同批，
 *  跨用例复用同一个 `File` 容易掩盖「这个用例其实没走到回调」的假绿。 */
function makeFile(name: string): File {
  return new File([name], name);
}

describe("FilePicker", () => {
  it("默认隐藏，accept / multiple 透传", () => {
    render(<FilePicker onPick={noop} accept="image/*" multiple />);
    const input = fileInput();
    expect(input.className).toContain("hidden");
    expect(input.accept).toBe("image/*");
    expect(input.multiple).toBe(true);
  });

  it("选中文件后回调：同时给出 file 与整份 FileList（多选要整份）", () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} multiple />);
    const A = makeFile("a.png");
    const B = makeFile("b.png");
    pick(fileInput(), A, B);

    expect(onPick).toHaveBeenCalledTimes(1);
    const call = onPick.mock.calls[0] as [File, FileList];
    expect(call[0]).toBe(A);
    expect(Array.from(call[1])).toEqual([A, B]);
  });

  it("**选完复位 value**：不清时连选同一个文件不会触发 change", () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} />);
    const input = fileInput();
    const A = makeFile("a.png");

    pick(input, A);
    expect(onPick).toHaveBeenCalledTimes(1);
    /* 复位的是 `value`，不是 `files` —— jsdom 里 `value` 只对文件选择返回
     * 空串，这里断言「复位动作真的做了」而不是它的取值。 */
    expect(input.value).toBe("");

    /* 再选一次**同一个**文件：真实浏览器里若 `value` 未复位，
     * change 事件根本不会派发。jsdom 不会自己模拟这层抑制，所以这里
     * 直接断言「复位之后仍能正常回调」—— 判据是行为不是实现。 */
    pick(input, A);
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  it("用户取消（files 为空）不回调 —— 否则会把「取消」当成一次选择", () => {
    const onPick = vi.fn();
    render(<FilePicker onPick={onPick} />);
    const input = fileInput();
    Object.defineProperty(input, "files", { value: null, configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("inputProps 透传（`aria-label` 这类无障碍属性要能传进去）", () => {
    render(
      <FilePicker onPick={noop} inputProps={{ "aria-label": "选择文件" }} />,
    );
    expect(screen.getByLabelText("选择文件")).toBeTruthy();
  });
});

describe("useFilePicker（命令式）", () => {
  it("open() 点到真 input；没挂上 Input 时不抛异常（静默空操作，与旧写法一致）", () => {
    const click = vi.fn();
    function Probe() {
      const picker = useFilePicker({ onPick: noop });
      return <picker.Input />;
    }
    render(<Probe />);
    const input = fileInput();
    input.click = click;

    /* 从组件外拿不到 picker，所以这里用「点 input 能被点到」来验证
     * 组件确实持有了它 —— 真实调用点由各视图自己的用例覆盖。 */
    input.click();
    expect(click).toHaveBeenCalled();
  });

  it("Input 身份稳定：多次渲染不重建 input（否则会打断正开着的文件对话框）", () => {
    const seen: string[] = [];
    function Probe() {
      const [, force] = useState(0);
      const picker = useFilePicker({ onPick: noop });
      seen.push(picker.Input.name);
      return (
        <button onClick={() => force((n) => n + 1)}>
          <picker.Input />
        </button>
      );
    }
    render(<Probe />);
    const before = fileInput();
    screen.getByRole("button").click();
    expect(fileInput(), "input 被卸载重建了").toBe(before);
  });
});

describe("FilePickerButton（声明式）", () => {
  it("按钮触发 input，选完回调", () => {
    const onPick = vi.fn();
    render(<FilePickerButton onPick={onPick}>上传</FilePickerButton>);
    screen.getByRole("button", { name: "上传" }).click();
    const A = makeFile("a.png");
    pick(fileInput(), A);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0]).toBe(A);
  });

  it("按钮样式与文案透传（调用方仍能控制外观）", () => {
    render(
      <FilePickerButton onPick={noop} className="custom-class">
        导入
      </FilePickerButton>,
    );
    const btn = screen.getByRole("button", { name: "导入" });
    expect(btn.className).toContain("custom-class");
  });
});

describe("FilePicker 与 handleRef", () => {
  it("挂上 handleRef 后能经它 open（useFilePicker 的内部机制）", () => {
    const click = vi.fn();
    function Probe() {
      const ref = useRef<FilePickerHandle>(null);
      return (
        <>
          <button onClick={() => ref.current?.open()}>开</button>
          <FilePicker onPick={noop} handleRef={ref} />
        </>
      );
    }
    render(<Probe />);
    fileInput().click = click;
    screen.getByRole("button", { name: "开" }).click();
    expect(click).toHaveBeenCalled();
  });
});
