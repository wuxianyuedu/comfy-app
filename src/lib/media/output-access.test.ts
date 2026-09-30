/**
 * `~/lib/media/output-access` —— 产物读取口的归属判据（台账 A13）。
 *
 * 这个模块只回答一个问题：「这条产物**能否被确定属于请求者之外的人**」。
 * 它的答案必须是三态里保守的那一半，因为读侧一旦被反过来用，代价不对称：
 *
 *   · 判成「别人的」→ 用户自己的图变 404，且**没有任何线索指向原因**（历史数据、
 *     任务已删、`_shared` 之外磁盘上直接丢进来的目录都会中招）；
 *   · 判成「自己的」→ 别人按路径把出图、素材、成片拖走。
 *
 * 所以「库里查不到这一行」一律不算别人的 —— 这条是本文件最重要的一档，
 * 单独写成容易，被「顺手改成 `!== userId` 的严格相等」写坏也很容易（那样
 * `findById` 返回 null 时 `null.userId` 抛错，或把未知行判成别人的）。用例把
 * 每一族的「查不到」都钉住，而不是只钉一族：三族走的是三条不同的查询。
 *
 * 另一类容易被「统一简化」掉的是**无主前缀**（`films/bgm`）与**分片不足**
 * （`materials` 这一段本身不是任何人的东西）。它们都返回同一个 `false`，
 * 看起来跟「查不到」没区别，但语义不同：前者是「这一类本来就没有主人」，
 * 后者是「暂时判不了」。所以除了结果，还断言**它有没有去查库** —— 无主前缀
 * 若真去查一次 `filmProject`，那条 id 是字面量 `bgm` 的查询就是白付的代价，
 * 而且哪天有人真插了这么一行，读取口会在无人察觉的情况下把它判成别人的。
 *
 * db 用内存 SQLite + 真 Drizzle（`tests/helpers/test-db.ts`）：归属判据的价值
 * 就在「查询真按 userId 过滤」，把仓储 mock 掉等于把要测的那一层换掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

import { filmRepository, taskRepository } from "~/lib/core/repository";
import { isForeignOwnedArtifact } from "./output-access";
import {
  getTestDb,
  seedFilm,
  seedProject,
  seedTask,
  seedUser,
  type TestDb,
} from "../../../tests/helpers/test-db";

const tdb: TestDb = getTestDb();

/** 两个真用户 + 各自的画布 / 任务 / 成片，外加一格共享素材。 */
beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "user-a", email: "a@test.dev" });
  seedUser(tdb, { id: "user-b", email: "b@test.dev" });
  seedProject(tdb, { id: "proj-a", userId: "user-a", name: "我的画布" });
  seedProject(tdb, { id: "proj-b", userId: "user-b", name: "别人的画布" });
  seedTask(tdb, { id: "task-a", userId: "user-a" });
  seedTask(tdb, { id: "task-b", userId: "user-b" });
  seedFilm(tdb, { id: "film-a", userId: "user-a" });
  seedFilm(tdb, { id: "film-b", userId: "user-b" });
});

/** 各表的查询计数 —— 用来判「这一族有没有走到那条查询」。
 *  spy 保留真实实现（只记账不假答），所以它测的是「有没有查」而不是「查出什么」。 */
function countLookups() {
  return {
    film: vi.spyOn(filmRepository, "findById"),
    task: vi.spyOn(taskRepository, "findById"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("materials/<scope> —— 素材格按项目 id 分片", () => {
  it("自己的项目 → 不是别人的", async () => {
    expect(
      await isForeignOwnedArtifact(
        ["materials", "proj-a", "ref", "mine.png"],
        "user-a",
      ),
    ).toBe(false);
  });

  it("别人的项目 → 是别人的", async () => {
    expect(
      await isForeignOwnedArtifact(
        ["materials", "proj-b", "ref", "secret.png"],
        "user-a",
      ),
    ).toBe(true);
  });

  it("共享区 _shared 不属于任何人", async () => {
    expect(
      await isForeignOwnedArtifact(
        ["materials", "_shared", "ref", "x.png"],
        "user-a",
      ),
    ).toBe(false);
  });

  it("磁盘上直接丢进来、库里没有的 scope 目录 → 不算别人的", async () => {
    // 素材库的存储选型就是文件系统：用户可以把文件直接扔进目录。
    // 这一格没有对应的 project 行，判成别人的等于把用户自己的手动素材打裂。
    expect(
      await isForeignOwnedArtifact(
        ["materials", "随手建的目录", "ref", "x.png"],
        "user-a",
      ),
    ).toBe(false);
  });

  it("只有 materials 这一段（scope 还没给）→ 不去查任务表", async () => {
    const { task } = countLookups();
    expect(await isForeignOwnedArtifact(["materials"], "user-a")).toBe(false);
    expect(task.mock.calls.length).toBe(0);
  });
});

describe("projects/<项目 id>/<任务 id> —— 画布产物", () => {
  it("别人的项目 → 是别人的（第二格就是项目 id）", async () => {
    expect(
      await isForeignOwnedArtifact(
        ["projects", "proj-b", "task-b", "a.png"],
        "user-a",
      ),
    ).toBe(true);
  });

  it("自己的项目 → 不是别人的", async () => {
    expect(
      await isForeignOwnedArtifact(
        ["projects", "proj-a", "task-a", "a.png"],
        "user-a",
      ),
    ).toBe(false);
  });

  it("与素材那一族吃同一份项目归属判据：库里没有的项目行算未登记画布", async () => {
    // 新画布在 localStorage 里有 id、库里还没有行 —— 素材读侧（A12）已经把这
    // 判成「不是别人的」，产物侧必须是同一个答案，否则同一个目录名在两处
    // 一个是我的一个是别人的。
    expect(
      await isForeignOwnedArtifact(
        ["projects", "proj-new", "t1", "a.png"],
        "user-a",
      ),
    ).toBe(false);
  });
  it("只有 projects 这一段（项目 id 还没给）→ 不去查任务表", async () => {
    const { task } = countLookups();
    expect(await isForeignOwnedArtifact(["projects"], "user-a")).toBe(false);
    expect(task.mock.calls.length).toBe(0);
  });
});

describe("films/<成片 id> —— 成片与中间目录", () => {
  it("别人的成片 → 是别人的", async () => {
    expect(
      await isForeignOwnedArtifact(["films", "film-b.mp4"], "user-a"),
    ).toBe(true);
  });

  it("自己的成片 → 不是别人的", async () => {
    expect(
      await isForeignOwnedArtifact(["films", "film-a.mp4"], "user-a"),
    ).toBe(false);
  });

  it("合成前的中间目录 films/_tmp_<id>/… 也带主人（去掉 _tmp_ 前缀再查）", async () => {
    expect(
      await isForeignOwnedArtifact(
        ["films", "_tmp_film-b", "seg1.mp4"],
        "user-a",
      ),
    ).toBe(true);
    expect(
      await isForeignOwnedArtifact(
        ["films", "_tmp_film-a", "seg1.mp4"],
        "user-a",
      ),
    ).toBe(false);
  });

  it("库里查不到的成片 id → 不算别人的", async () => {
    expect(
      await isForeignOwnedArtifact(["films", "no-such-film.mp4"], "user-a"),
    ).toBe(false);
  });

  it("films/bgm 是无主内容：直接放行，且根本不去查出片表", async () => {
    const { film } = countLookups();
    expect(
      await isForeignOwnedArtifact(["films", "bgm", "lofi.mp3"], "user-a"),
    ).toBe(false);
    expect(film.mock.calls.length).toBe(0);
  });

  it("只有 films 这一段 → 不去查出片表", async () => {
    const { film } = countLookups();
    expect(await isForeignOwnedArtifact(["films"], "user-a")).toBe(false);
    expect(film.mock.calls.length).toBe(0);
  });
});

describe("其余落点 = <任务 id>/… （executor-finalize 的默认形状）", () => {
  it("别人的任务 → 是别人的", async () => {
    expect(await isForeignOwnedArtifact(["task-b", "out.png"], "user-a")).toBe(
      true,
    );
  });

  it("自己的任务 → 不是别人的", async () => {
    expect(await isForeignOwnedArtifact(["task-a", "out.png"], "user-a")).toBe(
      false,
    );
  });

  it("任务行已删（历史产物还在盘上）→ 不算别人的", async () => {
    // 删任务不保证删干净盘上的产物；这一格判成别人的会让那块文件永远读不出来，
    // 而它本来就没有主人可对了。
    expect(
      await isForeignOwnedArtifact(["deleted-task", "out.png"], "user-a"),
    ).toBe(false);
  });

  it("空路径片段 → false，不去查任何表", async () => {
    const { film, task } = countLookups();
    expect(await isForeignOwnedArtifact([], "user-a")).toBe(false);
    expect(film.mock.calls.length).toBe(0);
    expect(task.mock.calls.length).toBe(0);
  });
});
