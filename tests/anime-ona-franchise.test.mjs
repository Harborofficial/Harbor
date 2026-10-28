import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as episodeBuild from "../src/lib/providers/anime-episode-build.ts";
import * as placeholders from "../src/lib/providers/episode-placeholder.ts";
import {
  pickPreferredEpisodeOverview,
  pickPreferredEpisodeTitle,
} from "../src/lib/localized-text.ts";
import { isUpcomingDate } from "../src/lib/dates.ts";
import { resolveAnimeSlotMatch } from "../src/views/detail/anime-episodes/anime-slot-match.ts";

function load(path, dependencies, select) {
  let source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  if (select) {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    source = ast.statements
      .filter((node) =>
        ts.isFunctionDeclaration(node)
          ? select.includes(node.name?.text)
          : ts.isVariableStatement(node) &&
            node.declarationList.declarations.some((declaration) =>
              select.includes(declaration.name.getText(ast)),
            ),
      )
      .map((node) => node.getText(ast))
      .join("\n");
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", compiled)((id) => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}

// Use the real classifier without initializing the unrelated detail providers.
const classification = load("src/lib/providers/anime-detail.ts", {}, [
  "SHORT_SUBTYPES",
  "isFranchiseExtra",
  "franchiseTags",
]);

function entry(id, patch = {}) {
  return {
    meta: { id: `kitsu:${id}`, type: "series", name: "Cyberpunk: Edgerunners" },
    subtype: "ONA",
    episodeCount: 10,
    year: 2022,
    startDate: "2022-09-13",
    isCurrent: false,
    isUpcoming: false,
    ...patch,
  };
}

const franchise = [
  entry(43248, { isCurrent: true }),
  entry(50016, { year: 2026, startDate: "2026-10-20" }),
  entry(46480, { subtype: "music", episodeCount: 1 }),
];
const titles = [
  "Last Chance for a Slow Dance",
  "Give Me Another Day",
  "0+2=1",
  "Someone That I Used to Know",
  "Fades (Pass the Distance)",
  "Everything Hate",
  "To the Depths with You",
  "Serce",
  "Strictly Reserved for You",
  "Then Everyone Went Home",
];

function addon(id, season) {
  return {
    id: `kitsu:${id}`,
    videos: titles.map((_, i) => ({
      id: `kitsu:${id}:${i + 1}`,
      title: `Episode ${i + 1}`,
      season: 1,
      episode: i + 1,
      imdb_id: "tt12590266",
      imdbSeason: season,
      imdbEpisode: i + 1,
    })),
  };
}

function rawEpisodes(id) {
  return titles.map((_, i) => ({
    id: id * 100 + i + 1,
    number: i + 1,
    seasonNumber: 1,
    title: `Episode ${i + 1}`,
    synopsis: "",
    thumbnail: null,
    airdate: "2026-10-20",
    length: 28,
  }));
}

const mapping = {
  mappings: { kitsu_id: 50016, imdb_id: "tt12590266", mal_id: 61990 },
  episodes: Object.fromEntries(
    titles.map((title, i) => [
      String(i + 1),
      {
        titles: { en: title },
        seasonNumber: 2,
        episodeNumber: i + 1,
        absoluteEpisodeNumber: 11 + i,
        tvdbId: 11229710 + i,
      },
    ]),
  ),
};

function hooks(states = []) {
  let index = 0;
  const effects = [];
  return {
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in states)) states[slot] = initial;
        return [
          states[slot],
          (value) => {
            states[slot] = value;
          },
        ];
      },
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useEffect: (fn) => {
        effects.push(fn);
      },
    },
    render(fn) {
      index = 0;
      effects.length = 0;
      return fn();
    },
    async settle() {
      for (const effect of effects.splice(0)) effect();
      await new Promise(setImmediate);
    },
  };
}

function seasonPanel(episodes, pool, currentId) {
  const rows = titles.map((_, i) => ({
    id: 11229710 + i,
    seasonNumber: 2,
    episodeNumber: i + 1,
    name: "TBA",
    overview: "TBA",
    airDate: "2026-10-20",
  }));
  const ordering = {
    seasons: [{ seasonNumber: 2, name: "Season 2", airDate: "2026-10-20" }],
    bySeason: new Map([[2, rows]]),
    absByEpId: new Map(rows.map((row) => [row.id, row.episodeNumber + 10])),
    imageByAbs: new Map(),
  };
  const state = hooks([384541, ordering, [], "aired", "2", true, "has", new Set()]);
  const { useAnimeTvdbPanel } = load("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", {
    react: state.react,
    "@/lib/i18n": { useT: () => (text) => text },
    "@/lib/providers/anime-mapping": {},
    "@/lib/providers/anime-detail": classification,
    "@/lib/providers/anime-episode-build": episodeBuild,
    "@/lib/providers/tvdb": {},
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
    "@/lib/localized-text": { pickPreferredEpisodeOverview, pickPreferredEpisodeTitle },
    "@/lib/dates": { isUpcomingDate },
    "@/lib/providers/harbor-imdb": { harborImdbEpisodesCached: () => undefined },
    "@/lib/providers/tvdb-order": {
      seasonDateRange: () => ({ from: "2026-10-20", to: "2026-10-20" }),
    },
    "@/lib/streams/anime-identity": {},
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  return state.render(() =>
    useAnimeTvdbPanel(
      Number(currentId.slice(6)),
      "tt12590266",
      episodes,
      "aired",
      "",
      true,
      pool,
      undefined,
      "2",
      franchise,
      currentId,
    ),
  ).panel;
}

test("multi-episode ONA series are seasons regardless of current or upcoming status", () => {
  for (const subtype of ["ona", "ONA"]) {
    for (const status of [{}, { isCurrent: true }, { isUpcoming: true }]) {
      assert.equal(
        classification.isFranchiseExtra(entry(1, { subtype, episodeCount: 2, ...status })),
        false,
      );
    }
  }
  assert.deepEqual(classification.franchiseTags(franchise), [
    { kind: "season", seasonNum: 1, short: "S1" },
    { kind: "season", seasonNum: 2, short: "S2" },
    { kind: "movie", seasonNum: 0, short: "MOV" },
  ]);
});

test("one-off and unknown ONA entries and existing extra types stay extras", () => {
  for (const episodeCount of [undefined, 0, 1]) {
    for (const status of [{}, { isCurrent: true }, { isUpcoming: true }]) {
      assert.equal(classification.isFranchiseExtra(entry(1, { episodeCount, ...status })), true);
    }
  }
  for (const subtype of ["ova", "special", "music", "one_shot"]) {
    assert.equal(classification.isFranchiseExtra(entry(1, { subtype, isCurrent: true })), true);
  }
  assert.equal(classification.isFranchiseExtra(entry(1, { meta: { type: "movie" } })), true);
  assert.equal(classification.isFranchiseExtra(entry(1, { subtype: "TV" })), false);
  assert.equal(classification.isFranchiseExtra(entry(1, { subtype: "TV", episodeCount: 1 })), true);
  assert.equal(
    classification.isFranchiseExtra(entry(1, { subtype: "TV", episodeCount: 1, isCurrent: true })),
    false,
  );
});

test("opening Edgerunners pools its ONA sequel and fills all Season 2 titles without changing playback", async () => {
  const { fetchEntryEpisodes } = load("src/lib/providers/anime-franchise-episodes.ts", {
    "@/lib/providers/anizip": { aniZipByKitsu: async () => mapping },
    "@/lib/providers/anime-episode-build": episodeBuild,
    "@/lib/providers/anime-episode-enrich": { enrichEpisodes: async () => {} },
    "@/lib/providers/anime-kitsu-addon": { animeKitsuMeta: async () => addon(50016, 2) },
    "@/lib/providers/kitsu": { kitsuEpisodes: async () => rawEpisodes(50016) },
    "@/lib/providers/anime-mapping": {
      kitsuToTvdb: async () => null,
      applyAnidbSeasonWindow: async () => {},
    },
    "@/lib/providers/episode-placeholder": placeholders,
    "@/lib/providers/mal-episodes": { malEpisodeTitles: async () => null },
    "@/lib/providers/tvdb": { tvdbLangFromIso1: () => "eng" },
    "@/lib/providers/tmdb/tmdb-details": {},
  });
  const state = hooks();
  const requested = [];
  const { useFranchiseEpisodes } = load(
    "src/views/detail/anime-episodes/use-franchise-episodes.ts",
    {
      react: state.react,
      "@/lib/providers/anime-detail": classification,
      "@/lib/settings": { useSettings: () => ({ settings: { uiLanguage: "en" } }) },
      "@/lib/providers/anime-franchise-episodes": {
        fetchEntryEpisodes: (id, settings) => {
          requested.push(id);
          assert.equal(id, 50016, "only the sequel should be fetched, never an extra");
          return fetchEntryEpisodes(id, settings);
        },
      },
      "@/lib/providers/kitsu": { parseKitsuId: (id) => Number(id.slice(6)) },
    },
  );
  const anchor = episodeBuild.buildKitsuEpisodes(addon(43248, 1), rawEpisodes(43248));
  const render = () => useFranchiseEpisodes(franchise, "kitsu:43248", anchor, true);
  assert.equal(state.render(render), anchor);
  await state.settle();
  assert.deepEqual(requested, [50016]);
  const pooled = state.render(render);
  assert.equal(pooled.length, 20);
  assert.deepEqual(pooled.slice(0, 10), anchor);
  const panel = seasonPanel(anchor, pooled, "kitsu:43248");
  assert.equal(panel.activeKey, "2");
  assert.deepEqual(
    panel.visibleEpisodes.map((ep) => ep.title),
    titles,
  );

  const direct = episodeBuild.buildKitsuEpisodes(addon(50016, 2), rawEpisodes(50016));
  episodeBuild.mergeAniZipEpisodes(direct, mapping);
  const directPanel = seasonPanel(direct, undefined, "kitsu:50016");
  for (const [i, ep] of panel.visibleEpisodes.entries()) {
    const { sourceMetaId, ...episode } = ep;
    assert.equal(sourceMetaId, "kitsu:50016");
    assert.deepEqual(episode, directPanel.visibleEpisodes[i]);
    assert.equal(ep.id, 5001600 + i + 1);
    assert.equal(ep.streamId, `kitsu:50016:${i + 1}`);
    assert.equal(ep.imdbId, "tt12590266");
    assert.equal(ep.imdbSeason, 2);
    assert.equal(ep.imdbEpisode, i + 1);
    assert.equal(ep.absoluteNumber, 11 + i);
    assert.equal(ep.tvdbEpisodeId, 11229710 + i);
  }
});
