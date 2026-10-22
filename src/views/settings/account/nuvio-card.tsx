import { useEffect, useMemo, useState } from "react";
import { Fingerprint, LogOut, RefreshCw } from "../icons";
import { SettingRow } from "../kit";
import { SButton } from "../ui";
import { useT } from "@/lib/i18n";
import nuvioIcon from "@/assets/nuvio.png";
import { NuvioAuthModal } from "@/components/nuvio-auth-modal";
import { activateNuvioAccountProvider } from "@/lib/nuvio/nuvio-auth";
import { fetchNuvioProfiles, signOutNuvio } from "@/lib/nuvio/nuvio-auth";
import { loadNuvioState } from "@/lib/nuvio/nuvio-client";
import type { NuvioAccountState } from "@/lib/nuvio/nuvio-types";

export function NuvioCard() {
  const t = useT();
  const [state, setState] = useState<NuvioAccountState>(() => loadNuvioState());
  const [showAuth, setShowAuth] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const onStateChanged = () => setState(loadNuvioState());
    window.addEventListener("harbor:nuvio-state-changed", onStateChanged);
    return () => window.removeEventListener("harbor:nuvio-state-changed", onStateChanged);
  }, []);

  const session = state.session;
  const user = session?.user;

  const maskedEmail = useMemo(() => {
    if (!user?.email) return "";
    const [local, domain] = user.email.split("@");
    if (!domain) return "*****";
    return `${local.slice(0, 1)}${"*".repeat(Math.max(local.length - 1, 4))}@${domain}`;
  }, [user]);

  const onRefreshProfiles = async () => {
    setRefreshing(true);
    await fetchNuvioProfiles();
    setRefreshing(false);
  };

  if (!session) {
    return (
      <>
        <SettingRow
          icon={<img src={nuvioIcon} alt="Nuvio" className="h-5 w-5 rounded-md object-contain" />}
          label={t("Not connected")}
          desc={t("Sign in or link via nuvio.tv/link to sync profiles, watchlist, and addons.")}
        >
          <SButton variant="primary" onClick={() => setShowAuth(true)}>
            {t("Connect Nuvio")}
          </SButton>
        </SettingRow>
        {showAuth && <NuvioAuthModal onClose={() => setShowAuth(false)} onSuccess={activateNuvioAccountProvider} />}
      </>
    );
  }

  return (
    <>
      <SettingRow
        icon={<img src={nuvioIcon} alt="Nuvio" className="h-5 w-5 rounded-md object-contain" />}
        label={t("Connected to Nuvio")}
        desc={
          <span className="font-mono text-ink" dir="ltr">
            {reveal ? (user?.email || session.user.id) : maskedEmail}
          </span>
        }
      >
        <SButton onClick={() => setReveal((v) => !v)}>{reveal ? t("Hide") : t("Reveal")}</SButton>
        <SButton onClick={onRefreshProfiles} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {t("Refresh")}
        </SButton>
      </SettingRow>

      <SettingRow
        icon={<Fingerprint size={18} strokeWidth={2} />}
        label={t("Nuvio Account ID")}
        desc={t("Unique identifier for your Nuvio cloud account.")}
      >
        <span className="break-all font-mono text-[13px] text-ink-subtle" dir="ltr">
          {user?.id || session.user.id}
        </span>
      </SettingRow>

      <SettingRow
        icon={<LogOut size={18} strokeWidth={2} />}
        label={t("Disconnect Nuvio")}
        desc={t("Stops syncing with your Nuvio account on this device.")}
      >
        <SButton variant="danger" onClick={signOutNuvio}>
          {t("Disconnect")}
        </SButton>
      </SettingRow>

      {showAuth && <NuvioAuthModal onClose={() => setShowAuth(false)} onSuccess={activateNuvioAccountProvider} />}
    </>
  );
}
