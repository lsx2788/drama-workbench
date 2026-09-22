import test from "node:test";
import assert from "node:assert/strict";
import { groupBasisAssets } from "../src/features/assets/basis-groups";
import type { Asset, Task } from "../src/domain/types";
import { emptyProject } from "../src/domain/structure";

test("character folders follow saved sample links across outfits and closeups, with legacy titles normalized", () => {
  const seed = emptyProject().tasks.source;
  const tasks: Record<string, Task> = {
    sample: { ...seed, title: "褚采薇角色参考·正面全身" },
    costume: { ...seed, imageSpec: { purpose: "服装图", basisTaskId: "sample" } },
    portrait: { ...seed, imageSpec: { purpose: "面部特写", basisTaskId: "sample" } },
  };
  const asset = (
    id: string,
    name: string,
    category: Asset["category"] = "人物",
  ): Asset => ({
    id,
    name,
    category,
    status: id === "costume" ? "draft" : "approved",
    description: "提到许七安，不代表所属角色",
    sourceIds: [],
    version: 1,
    taskId: id,
  });
  const result = groupBasisAssets(
    [
      asset("sample", "褚采薇角色参考·正面全身"),
      asset("costume", "鹅黄外衫服装图"),
      asset("portrait", "面部特写"),
      asset("other", "许七安·首样"),
      asset("room", "证物房·无人背景", "场景"),
      asset("prop", "证物房·道具布局", "道具"),
    ],
    tasks,
  );
  const character = result.find((g) => g.name === "褚采薇")!;
  assert.deepEqual(
    character.assets.map((a) => a.id),
    ["sample", "costume", "portrait"],
  );
  assert.equal(character.assets[1].status, "draft");
  assert.equal(result.length, 4);
  assert.notEqual(
    result.find((g) => g.category === "场景")?.id,
    result.find((g) => g.category === "道具")?.id,
  );
});
