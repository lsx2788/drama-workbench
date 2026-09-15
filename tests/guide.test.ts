import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/server/db";
import { seedGuide } from "../scripts/seed-guide";
import { guideParts, guideText, guidePeople } from "../scripts/guide-data";
import { workspace } from "../src/server/read-service";
import { listEpisodes, episodeDetail } from "../src/server/episode-service";
import { readStoryRange } from "../src/server/story-range";
import { storyFile } from "../src/server/story-service";
import { knowledge } from "../src/server/knowledge-service";
import { createProject, listProjects } from "../src/server/project-service";
import { audit } from "../src/server/common";

test("guide replaces only the registered old fixture and presents unchanged episode sources without production steps", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "drama-guide-"));
  const s = new Store(root);
  t.after(() => {
    s.close();
    assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(root, { recursive: true, force: true });
  });
  const old = createProject(s, { name: "青禾剑录" });
  audit(s, String(old.id), "demo.seeded", "qinghe-v1");
  const unrelated = createProject(s, { name: "青禾剑录" });
  const p = seedGuide(s),
    w = workspace(s, p);
  assert.equal(seedGuide(s), p);
  assert.equal(
    listProjects(s).some((row) => row.id === old.id),
    false,
  );
  assert.ok(listProjects(s).some((row) => row.id === unrelated.id));
  assert.ok(listProjects(s, true).some((row) => row.id === old.id));
  assert.equal(w.nodes.length, 3);
  assert.equal(w.items.length, 0);
  assert.equal(w.runs.length, 0);
  assert.equal(w.documents.length, 0);
  assert.equal(w.preparationRecords.length, 3);
  assert.ok(
    w.preparationRecords.every((record) => record.decision === "confirmed"),
  );
  assert.equal(w.aiRelations.length, 3);
  assert.equal(w.stories.length, 1);
  assert.equal(
    storyFile(s, p, String(w.stories[0].id)).bytes.toString("utf8"),
    guideText,
  );
  assert.equal(knowledge(s, p).entities.length, guidePeople.length);
  const episodes = listEpisodes(s, p);
  assert.equal(episodes.length, 3);
  for (const [index, episode] of episodes.entries()) {
    const detail = episodeDetail(s, p, String(episode.id)),
      source = detail.sources[0];
    assert.equal(
      readStoryRange(s, p, String(source.story_id), {
        startByte: source.start_byte,
        endByte: source.end_byte,
        encoding: source.encoding,
      }).text,
      guideParts[index].text,
    );
    assert.equal(
      w.nodes.some((node) => node.section_id === episode.id),
      false,
    );
  }
  assert.ok(w.messages.some((message) => message.sender_type === "agent"));
  assert.ok(
    w.messages
      .filter((message) => message.sender_type === "agent")
      .every((message) => String(message.content).includes("预置讨论")),
  );
  assert.equal(
    knowledge(s, p).relations.filter(
      (relation) => relation.from === "shen_yan" && relation.to === "father",
    ).length,
    3,
  );
  assert.deepEqual(s.all("PRAGMA foreign_key_check"), []);
});
