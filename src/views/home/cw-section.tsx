import { useState } from "react";
import { LogIn } from "lucide-react";
import stremioWordmark from "@/assets/stremio-wordmark.png";
import nuvioLogo from "@/assets/nuvio.png";
import { AuthModal } from "@/components/auth-modal";
import { NuvioAuthModal } from "@/components/nuvio-auth-modal";
import { activateNuvioAccountProvider } from "@/lib/nuvio/nuvio-auth";
import { ContinueCard } from "@/components/continue-card";
import { Row } from "@/components/row";
import { useT } from "@/lib/i18n";
import { type LibraryItem } from "@/lib/stremio";
import { isLibraryItemWatched } from "@/lib/trakt/library-key";
import type { ContinueDismiss } from "@/lib/continue-card-actions";

type Props = {
  signedIn: boolean;
  isNuvio?: boolean;
  items: LibraryItem[];
  watchedSet?: Set<string>;
  onDismiss: ContinueDismiss;
  loading?: boolean;
};

export function CWSection({ signedIn, isNuvio, items, watchedSet, onDismiss, loading }: Props) {
  const t = useT();
  const [showAuth, setShowAuth] = useState(false);

  const signInButton = signedIn ? null : (
    <button
      type="button"
      onClick={() => setShowAuth(true)}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-edge-soft px-3 py-1 text-[12.5px] font-medium text-ink-subtle transition-colors hover:bg-raised hover:text-ink"
    >
      <LogIn size={13} strokeWidth={2.2} />
      {t("profile.signIn")}
    </button>
  );

  const authModal = showAuth ? (
    isNuvio ? (
      <NuvioAuthModal onClose={() => setShowAuth(false)} onSuccess={activateNuvioAccountProvider} />
    ) : (
      <AuthModal onClose={() => setShowAuth(false)} />
    )
  ) : null;

  if (loading && items.length === 0) {
    return (
      <div className="flex flex-col gap-4 animate-in fade-in duration-200">
        <h3 className="text-[17px] font-medium tracking-tight text-ink">
          {t("Continue Watching")}
        </h3>
        <div className="flex gap-4 overflow-hidden py-1">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="flex w-[260px] shrink-0 flex-col gap-2.5 animate-pulse">
              <div className="aspect-[16/9] w-full rounded-xl bg-elevated/40" />
              <div className="h-4 w-3/4 rounded bg-elevated/30" />
              <div className="h-3 w-1/2 rounded bg-elevated/20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length > 0) {
    return (
      <div className="transition-opacity duration-300">
        <Row
          key="home:cw"
          title={t("Continue Watching")}
          min={260}
          shape="landscape"
          scrollKey="home:cw"
          headerRight={signInButton}
        >
          {items.map((item) => (
            <ContinueCard
              key={item._id}
              item={item}
              watched={watchedSet ? isLibraryItemWatched(item, watchedSet) : false}
              onDismiss={onDismiss}
            />
          ))}
        </Row>
        {authModal}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[17px] font-medium tracking-tight text-ink">{t("Continue Watching")}</h3>
      <div className="flex items-center justify-center rounded-2xl border border-dashed border-edge px-6 py-14 text-center">
        {signedIn ? (
          <p className="text-[15.5px] leading-relaxed text-ink-muted">
            {t("Nothing in progress yet. Press Play on something.")}
          </p>
        ) : isNuvio ? (
          <div className="flex flex-col items-center gap-3">
            <p className="text-[15.5px] leading-relaxed text-ink-muted">
              {t("Sign in to your Nuvio account to sync continue watching and watch history.")}
            </p>
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-accent-hover"
            >
              <img src={nuvioLogo} alt="Nuvio" className="h-4 w-4 object-contain rounded-sm" />
              <span>{t("Sign in to Nuvio")}</span>
            </button>
          </div>
        ) : (
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[15.5px] leading-relaxed text-ink-muted">
            <span>{t("Sign in to")}</span>
            <button
              type="button"
              onClick={() => setShowAuth(true)}
              className="rounded-md transition-opacity hover:opacity-80"
              aria-label={t("profile.signIn")}
            >
              <img
                src={stremioWordmark}
                alt="Stremio"
                className="relative top-0.5 h-7 w-auto select-none grayscale invert"
                draggable={false}
              />
            </button>
            <span>{t("to bring in your library.")}</span>
          </p>
        )}
      </div>
      {authModal}
    </div>
  );
}
