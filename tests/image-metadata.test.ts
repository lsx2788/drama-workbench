import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "../src/server/database";
import { StudioService } from "../src/server/studio-service";
import { readMaterial, storeUploads } from "../src/server/files";
import { imageDimensions } from "../src/server/image-metadata";

test("real PNG/JPEG/WebP dimensions persist; legacy metadata is recovered from original bytes", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "studio-dimensions-"));
  const db = new Database(root);
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });
  const service = new StudioService(db);
  for (const format of ["png", "jpeg", "webp"] as const) {
    const bytes = await sharp({
      create: { width: 31, height: 57, channels: 3, background: "#fff" },
    })
      .toFormat(format)
      .toBuffer();
    assert.deepEqual(await imageDimensions(bytes), { width: 31, height: 57 });
    const uploads = await storeUploads(db, [
      new File([new Uint8Array(bytes)], `test.${format}`),
    ]);
    const p = service.create("尺寸测试", "", uploads);
    assert.equal(service.snapshot().files[`${p}/sources`][0].width, 31);
    assert.equal(service.snapshot().files[`${p}/sources`][0].height, 57);
    db.run("DELETE FROM image_metadata WHERE file_id=?", uploads[0].id);
    const read = await readMaterial(db, p, uploads[0].id);
    assert.equal(read.kind, "image");
    if (read.kind === "image")
      assert.deepEqual([read.width, read.height], [31, 57]);
    assert.equal(service.snapshot().files[`${p}/sources`][0].width, 31);
  }
  await assert.rejects(imageDimensions(Buffer.from("fake image")));
});
