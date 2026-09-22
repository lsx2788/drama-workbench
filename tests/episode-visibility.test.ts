import assert from "node:assert/strict";
import test from "node:test";
import { episodeColumns } from "../src/features/workflow/episode-visibility";
const episodes = Array.from({ length: 10 }, (_, i) => ({
  number: i + 1,
  title: `${i + 1}`,
  synopsis: "内容",
  shots: 0,
}));
const visible = (key: number, extra: number[] = []) =>
  episodeColumns(episodes, key, extra).flatMap((c) =>
    c.kind === "episode" ? [c.episode.number] : [],
  );
test("five nodes around key, shifted at either edge; gaps can be expanded", () => {
  assert.deepEqual(visible(5), [3, 4, 5, 6, 7]);
  assert.deepEqual(visible(1), [1, 2, 3, 4, 5]);
  assert.deepEqual(visible(10), [6, 7, 8, 9, 10]);
  const columns = episodeColumns(episodes, 5, []);
  assert.deepEqual(
    columns.filter((c) => c.kind === "gap").map((c) => c.next),
    [2, 8],
  );
  assert.deepEqual(visible(5, [2, 8]), [2, 3, 4, 5, 6, 7, 8]);
});
test("empty, sparse, single and no-key lists never invent nodes or mutate data", () => {
  const before = structuredClone(episodes);
  assert.deepEqual(visible(0), [1, 2, 3, 4, 5]);
  assert.deepEqual(episodeColumns([], 1, []), []);
  const sparse = [episodes[7], episodes[1]];
  assert.deepEqual(
    episodeColumns(sparse, 8, []).flatMap((c) =>
      c.kind === "episode" ? [c.episode.number] : [],
    ),
    [2, 8],
  );
  assert.equal(episodeColumns([episodes[0]], 1, []).length, 1);
  assert.deepEqual(episodes, before);
});
