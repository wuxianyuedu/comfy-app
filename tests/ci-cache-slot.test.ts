/**
 * 缓存根推导家（`scripts/ci-cache-slot.mjs`）的判据。
 *
 * #3479 退役依赖面缓存槽之后，这份文件只剩**四套根共用的一份推导**
 * （问 `pnpm store path` 取卷根 + 包名拼子目录）与三个入口
 * （`resolveBuildCacheRoot` / `resolveArtifactRoot` / `resolveToolRoot`）。
 * 钉四件事：① 推导只认**卷根**（store 搬家不换根、换盘跟着换）；
 * ② 三套根各是各的子目录（互不相扰的边界）；③ 显式 env 只管自己那一套；
 * ④ 问不出 store ⇒ 不猜路径。`SLOT_LOCK_FILE` 那一枚随锁原语住进了
 * `ci-slot-apply.mjs`（它的唯一消费者）。
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ARTIFACT_ROOT_ENV,
  resolveArtifactRoot,
  resolveBuildCacheRoot,
  resolveToolRoot,
  TOOLS_ROOT_ENV,
} from "../scripts/ci-cache-slot.mjs";

const ROOT = path.resolve(__dirname, "..");

describe("缓存根推导：四套根共用一份事实", () => {
  /** 给定 store 路径，回一个「问 store 就答它」的替身。 */
  const runStore = (store: string) => () => ({ status: 0, stdout: `${store}\n` });

  it("没配时由 store 推导，并且**与 store 同卷**（跨卷 ⇒ 硬链接退化成整树复制）", () => {
    const store = path.join(path.parse(ROOT).root, ".pnpm-store", "v11");
    const out = resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: runStore(store) });
    expect(out.root).not.toBeNull();
    expect(path.parse(out.root!).root).toBe(path.parse(store).root);
    expect(out.root!.endsWith(path.join("ci-build-cache", "comfy-app-t3"))).toBe(true);
    expect(out.from).toContain(store);
  });

  it("runner 换盘 ⇒ 推导跟着换，配置一个字都不用改（这一条就是那次搬家要防的事）", () => {
    /* 「换盘」在单卷宿主上造不出来（`path.parse` 只认当前平台，任何绝对路径的卷根都是
     * `/`），所以这一条改判同一条因果里可判的那一半：根**当且仅当**由 store 那一处
     * 事实推出来 —— store 落在哪个卷根，根就落在哪个卷根，且不夹带任何一项配置。 */
    const storeRoot = path.parse(ROOT).root;
    const rootOf = (store: string) =>
      resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: runStore(store) }).root;
    expect(path.parse(rootOf(path.join(storeRoot, ".pnpm-store", "v11"))!).root).toBe(storeRoot);
    /* 卷根一样、store 的**父目录**换了 ⇒ 根不动：推导只认卷根，不跟着 store 的具体
     * 位置漂（否则同一台机器上换一个 store 路径就会换一套根，等于把已有的缓存全弃了）。 */
    expect(rootOf(path.join(storeRoot, "别的", "store"))).toBe(
      rootOf(path.join(storeRoot, ".pnpm-store", "v11")),
    );
    expect(rootOf(path.join(storeRoot, ".pnpm-store", "v11"))).toContain("ci-build-cache");
  });

  it("三套根各是各的子目录（构建缓存 / 成品 / 工具互不相扰）", () => {
    const io = {
      cwd: ROOT,
      env: {},
      run: runStore(path.join(path.parse(ROOT).root, ".pnpm-store", "v11")),
    };
    const build = resolveBuildCacheRoot(io).root ?? "";
    const artifact = resolveArtifactRoot(io).root ?? "";
    const tools = resolveToolRoot(io).root ?? "";
    expect(build).toContain(path.join("ci-build-cache", "comfy-app-t3"));
    expect(artifact).toContain(path.join("ci-artifacts", "comfy-app-t3"));
    expect(tools).toContain(path.join("ci-tools", "comfy-app-t3"));
    /* 三份互不重叠：成品不是缓存（删了就没了），工具镜像也不是（删了今天就打不出包）。 */
    expect(new Set([build, artifact, tools]).size).toBe(3);
  });

  it("显式 env 各管各的那一套，且来源被点名（那是「这台机器要放另一块盘」的出口）", () => {
    const base = { cwd: ROOT, run: () => ({ status: 1, stdout: "" }) };
    const artifact = resolveArtifactRoot({
      ...base,
      env: { [ARTIFACT_ROOT_ENV]: "D:/somewhere/artifacts" },
    });
    const tools = resolveToolRoot({
      ...base,
      env: { [TOOLS_ROOT_ENV]: "D:/somewhere/tools" },
    });
    expect(artifact.root).toBe("D:/somewhere/artifacts");
    expect(artifact.from).toContain(ARTIFACT_ROOT_ENV);
    expect(tools.root).toBe("D:/somewhere/tools");
    expect(tools.from).toContain(TOOLS_ROOT_ENV);
  });

  it("问不出 store ⇒ 不猜路径（宁可不省，也不猜一个卷）", () => {
    expect(
      resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: () => ({ status: 1 }) }).root,
    ).toBeNull();
    expect(
      resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: () => ({ status: 0, stdout: "   \n" }) })
        .root,
    ).toBeNull();
    /* 没有 run 出口（用例注入漏了它）同判 —— 不猜，是这条推导的第一纪律。 */
    expect(resolveBuildCacheRoot({ cwd: ROOT, env: {} }).root).toBeNull();
    expect(resolveArtifactRoot({ cwd: ROOT, env: {} }).root).toBeNull();
    expect(resolveToolRoot({ cwd: ROOT, env: {} }).root).toBeNull();
  });

  it("来源必须连着路径一起出现（一个路径孤零零摆在那儿，读的人不知道它是哪来的）", () => {
    const store = path.join(path.parse(ROOT).root, ".pnpm-store", "v11");
    const out = resolveBuildCacheRoot({ cwd: ROOT, env: {}, run: runStore(store) });
    expect(out.from).toContain("由 store");
    expect(out.from).toContain(".pnpm-store");
  });
});
