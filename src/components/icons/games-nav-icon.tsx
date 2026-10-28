import lotGames from "@/assets/lottie/nav/games.json";
import { GamesIcon } from "./games-icon";
import { NavLottie } from "./nav-lottie";

export function GamesNavIcon({ hovered = false }: { hovered?: boolean }) {
  return <NavLottie data={lotGames} hovered={hovered} fallback={<GamesIcon />} />;
}
