import type { Asset, Task } from "../../domain/types";

export type BasisGroup = {
  id: string;
  name: string;
  category: Asset["category"];
  assets: Asset[];
};

function subjectName(name: string, category: Asset["category"]) {
  const prefix = name.split(/[·•｜|：:]/)[0].trim();
  // Older character samples used "角色参考" as part of their title.
  return (
    (category === "人物"
      ? prefix.replace(/(?:角色参考|角色设定|人物参考|角色首样|人物首样)$/, "")
      : prefix
    ).trim() || name
  );
}

export function groupBasisAssets(
  assets: Asset[],
  tasks: Record<string, Task>,
): BasisGroup[] {
  const groups = new Map<string, BasisGroup>();
  for (const asset of assets) {
    const task = asset.taskId ? tasks[asset.taskId] : undefined;
    const basisId = task?.imageSpec?.basisTaskId;
    const basis = basisId ? tasks[basisId] : undefined;
    // Use the saved sample relationship, not mentions of other characters in the description.
    const name = subjectName(
      basis?.assetName || basis?.title || asset.name,
      asset.category,
    );
    const id = `${asset.category}:${name}`;
    const group = groups.get(id) ?? {
      id,
      name,
      category: asset.category,
      assets: [],
    };
    group.assets.push(asset);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
  );
}
