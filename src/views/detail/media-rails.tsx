import { memo } from "react";
import { PickCard } from "@/components/pick-card";
import { Row } from "@/components/row";
import type { Meta } from "@/lib/cinemeta";
import { useT } from "@/lib/i18n";
import type { AnimeCharacter } from "@/lib/providers/anime-characters";
import type { CastEntry } from "@/lib/providers/tmdb";
import { CastCard } from "./cast-card";
import { CharacterCard } from "./character-card";
import type { GraphReason } from "./use-graph-reasons";

export const DetailCastRail = memo(function DetailCastRail({ cast }: { cast: CastEntry[] }) {
  const t = useT();
  return (
    <Row title={t("Cast · {n}", { n: cast.length })} min={128}>
      {cast.map((entry, index) => (
        <CastCard key={`${entry.id}-${index}`} cast={entry} />
      ))}
    </Row>
  );
});

export const DetailProviderCastRail = memo(function DetailProviderCastRail({
  cast,
}: {
  cast: string[];
}) {
  const t = useT();
  return (
    <Row title={t("Cast · {n}", { n: cast.length })} min={128}>
      {cast.map((name, index) => (
        <CastCard
          key={`${name}-${index}`}
          cast={{ id: 0, name, character: "", profilePath: null, order: index }}
        />
      ))}
    </Row>
  );
});

export const DetailCharacterRail = memo(function DetailCharacterRail({
  characters,
}: {
  characters: AnimeCharacter[];
}) {
  const t = useT();
  return (
    <Row title={t("Characters · {n}", { n: characters.length })} min={128}>
      {characters.map((character) => (
        <CharacterCard key={character.id} character={character} />
      ))}
    </Row>
  );
});

export const DetailRecommendationRail = memo(function DetailRecommendationRail({
  title,
  items,
  reasons,
}: {
  title: string;
  items: Meta[];
  reasons?: Map<string, GraphReason>;
}) {
  return (
    <Row title={title}>
      {items.map((item) => (
        <PickCard
          key={item.id}
          meta={item}
          reason={reasons?.get(item.id)?.label}
          reasonDetail={reasons?.get(item.id)?.detail}
        />
      ))}
    </Row>
  );
});
