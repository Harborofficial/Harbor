import assert from "node:assert/strict";
import test from "node:test";
import {
  matchTorboxTransfers,
  recoverTorboxDownloads,
  torboxFailedLink,
  type SourceFile,
} from "../src/lib/games/torbox-download-recovery.ts";
import type { GameTransfer } from "../src/lib/games/transfers.ts";
import type { CloudDownload } from "../src/lib/games/cloud-files.ts";

function record(
  id: string,
  name: string,
  bytes: number,
  game = "Vellum",
  status: GameTransfer["status"] = "failed",
): GameTransfer {
  return {
    id,
    profile: "owner",
    name,
    game: { id: game, name: game },
    status,
    url: "https://nexus-008.indi.tb-cdn.pw/download?token=expired",
    destination: "C:\\\\Games\\\\" + name,
    received: bytes / 2,
    total: bytes,
    expectedBytes: bytes,
    expectedSha256: null,
    sha256: null,
    validator: "etag-old",
    createdAt: 1,
    updatedAt: 2,
    error: status === "failed" ? "transfer_http" : null,
    bytesPerSecond: 0,
  };
}
const remote = (
  parent: string,
  name: string,
  bytes: number,
  kind: "torrent" | "web" = "torrent",
): SourceFile => ({ parent, file: parent + ":" + name, kind, name, bytes });
function client(files: SourceFile[], override?: Partial<CloudDownload>) {
  const events: string[] = [];
  return {
    events,
    catalog: async () => files,
    resolve: async (kind: "torrent" | "web", parent: string, file: string) => {
      events.push("resolve:" + kind + ":" + parent);
      const source = files.find(
        (entry) => entry.kind === kind && entry.parent === parent && entry.file === file,
      );
      if (!source) throw Error("cloud_missing");
      return {
        url: "https://nexus-008.indi.tb-cdn.pw/download?token=fresh",
        name: source.name,
        expectedBytes: source.bytes,
        ...override,
      };
    },
    relink: async (record: GameTransfer, file: CloudDownload) => {
      events.push("relink:" + record.id);
      assert.ok(file.url.includes("fresh"));
    },
  };
}
test("only failed TorBox CDN links are eligible", () => {
  assert.equal(torboxFailedLink(record("a", "setup.bin", 200)), true);
  assert.equal(torboxFailedLink(record("b", "setup.bin", 200, "X", "paused")), false);
  assert.equal(
    torboxFailedLink({ ...record("c", "setup.bin", 200), url: "https://example.org/a?token=b" }),
    false,
  );
  assert.equal(
    torboxFailedLink({ ...record("d", "setup.bin", 200), error: "transfer_write" }),
    false,
  );
  assert.equal(
    torboxFailedLink({ ...record("e", "setup.bin", 200), url: "http://cdn.tb-cdn.pw/link" }),
    false,
  );
});
test("legacy repack files match exact basename and expected byte sizes", () => {
  const records = [record("a", "fg-01.bin", 100), record("b", "fg-02.bin", 200)];
  const files = [
    remote("54", "fg-01.bin", 100),
    remote("54", "fg-02.bin", 200),
    remote("63", "fg-01.bin", 300),
  ];
  assert.deepEqual(
    matchTorboxTransfers(records, files).map((item) => [item.record.id, item.source.parent]),
    [
      ["a", "54"],
      ["b", "54"],
    ],
  );
});
test("shared generic repack filenames need a uniquely matching multi-file container", () => {
  const records = [record("a", "fg-01.bin", 100), record("b", "fg-02.bin", 200)];
  const matches = matchTorboxTransfers(records, [
    remote("1", "fg-01.bin", 100),
    remote("2", "fg-01.bin", 100),
    remote("1", "fg-02.bin", 200),
  ]);
  assert.deepEqual(
    matches.map((item) => item.source.parent),
    ["1", "1"],
  );
  assert.deepEqual(
    matchTorboxTransfers(
      [record("a", "fg-01.bin", 100)],
      [remote("1", "fg-01.bin", 100), remote("2", "fg-01.bin", 100)],
    ),
    [],
  );
});
test("identical complete repacks in two remote torrents are ambiguous", () => {
  const records = [record("a", "fg-01.bin", 100), record("b", "fg-02.bin", 200)];
  assert.deepEqual(
    matchTorboxTransfers(records, [
      remote("1", "fg-01.bin", 100),
      remote("1", "fg-02.bin", 200),
      remote("2", "fg-01.bin", 100),
      remote("2", "fg-02.bin", 200),
    ]),
    [],
  );
});
test("web-download files can be recovered as well as torrent files", async () => {
  const records = [record("a", "webfile.part", 137), record("b", "torrentfile.part", 246)];
  const provider = client([
    remote("100", "webfile.part", 137, "web"),
    remote("200", "torrentfile.part", 246, "torrent"),
  ]);
  assert.deepEqual(await recoverTorboxDownloads(records, provider), { recovered: 2, unmatched: 0 });
  assert.ok(provider.events.includes("resolve:web:100"));
  assert.ok(provider.events.includes("resolve:torrent:200"));
});
test("does not modify completed or unrelated transfers", async () => {
  const files = [
    record("a", "fg-01.bin", 100),
    record("b", "fg-02.bin", 200, "Vellum", "complete"),
  ];
  const provider = client([remote("42", "fg-01.bin", 100), remote("42", "fg-02.bin", 200)]);
  assert.deepEqual(await recoverTorboxDownloads(files, provider), { recovered: 1, unmatched: 0 });
  assert.deepEqual(
    provider.events.filter((v) => v.startsWith("relink:")),
    ["relink:a"],
  );
});
test("incorrect replacement size and filename never resume partial data", async () => {
  for (const patch of [{ expectedBytes: 201 }, { name: "different.bin" }]) {
    const provider = client([remote("42", "setup.bin", 200)], patch);
    assert.deepEqual(await recoverTorboxDownloads([record("a", "setup.bin", 200)], provider), {
      recovered: 0,
      unmatched: 1,
    });
    assert.ok(!provider.events.some((v) => v.startsWith("relink:")));
  }
});
test("stored torrent IDs recover without scanning the catalog", async () => {
  const saved = {
    ...record("exact", "setup.bin", 400),
    torboxOrigin: { torrentId: "71", fileId: "9" },
  };
  const calls: string[] = [];
  assert.deepEqual(
    await recoverTorboxDownloads([saved], {
      catalog: async () => {
        throw Error("unexpected catalog");
      },
      resolve: async (kind, parent, file) => {
        calls.push([kind, parent, file].join(":"));
        return {
          url: "https://nexus-008.indi.tb-cdn.pw/file?token=fresh",
          name: "setup.bin",
          expectedBytes: 400,
        };
      },
      relink: async () => {
        calls.push("saved");
      },
    }),
    { recovered: 1, unmatched: 0 },
  );
  assert.deepEqual(calls, ["torrent:71:9", "saved"]);
});
test("stored web IDs recover using TorBox web-download endpoint", async () => {
  const saved = {
    ...record("exact", "setup.bin", 400),
    torboxOrigin: { torrentId: "71", fileId: "9", kind: "web" as const },
  };
  const calls: string[] = [];
  await recoverTorboxDownloads([saved], {
    catalog: async () => {
      throw Error("unexpected catalog");
    },
    resolve: async (kind, parent, file) => {
      calls.push([kind, parent, file].join(":"));
      return {
        url: "https://nexus-008.indi.tb-cdn.pw/file?token=fresh",
        name: "setup.bin",
        expectedBytes: 400,
      };
    },
    relink: async () => {},
  });
  assert.deepEqual(calls, ["web:71:9"]);
});
test("two games never auto-relink to the same remote file", () => {
  const files = [record("a", "setup.bin", 100, "A"), record("b", "setup.bin", 100, "B")];
  assert.deepEqual(matchTorboxTransfers(files, [remote("1", "setup.bin", 100)]), []);
});
test("a failed or truncated provider catalog never triggers a guess", async () => {
  const one = record("a", "setup.bin", 100);
  let relinked = 0;
  await assert.rejects(
    recoverTorboxDownloads([one], {
      catalog: async () => {
        throw Error("cloud_limit");
      },
      resolve: async () => ({ url: "https://host.test", name: "setup.bin", expectedBytes: 100 }),
      relink: async () => {
        relinked++;
      },
    }),
    /cloud_limit/,
  );
  assert.equal(relinked, 0);
});
