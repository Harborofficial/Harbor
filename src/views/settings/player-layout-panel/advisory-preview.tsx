import { ContentAdvisoryToast, type Advisory } from "@/components/player/content-advisory-toast";
import { useSampleArtwork } from "@/lib/sample-artwork";
import { useSettings } from "@/lib/settings";

const SAMPLE: Advisory[] = [
  { category: "Violence", severity: "Severe" },
  { category: "Profanity", severity: "Moderate" },
  { category: "Frightening", severity: "Mild" },
];

export function AdvisoryPreview() {
  const art = useSampleArtwork(11);
  const { settings } = useSettings();

  return (
    <div className="hset-row">
      <div className="relative flex min-h-[192px] w-full max-w-[286px] items-center justify-center overflow-hidden rounded-md bg-canvas p-6">
        {art.background && (
          <img
            src={art.background}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-black/45 via-black/10 to-transparent" />
        {settings.contentAdvisoryToast && (
          <div className="relative w-full">
            <ContentAdvisoryToast
              preview
              categories={SAMPLE}
              playKey="advisory-preview"
              mpaRating="15+"
            />
          </div>
        )}
      </div>
    </div>
  );
}
