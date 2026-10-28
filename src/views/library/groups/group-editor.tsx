import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HarborMark } from "@/components/icons/harbor-mark";
import { Upload, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { validGroupImage, type LibraryGroup } from "@/lib/library-groups";

export const groupInputClass =
  "h-11 w-full rounded-xl border border-edge bg-canvas px-3.5 text-[14px] text-ink focus:border-accent outline-none";
export const groupButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-edge px-4 py-2 text-[13px] font-semibold text-ink hover:bg-raised disabled:opacity-40";

export function GroupEditor({
  group,
  onSave,
  onCancel,
}: {
  group?: LibraryGroup;
  onSave: (name: string, image: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(group?.name ?? "");
  const [image, setImage] = useState(group?.image ?? "");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      previous?.focus();
    };
  }, []);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw new Error(t("Choose a PNG, JPEG, or WebP image under 10 MB."));
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error(t("Could not read this image."));
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/webp", 0.8);
        if (!validGroupImage(data))
          throw new Error(t("This image is too large. Choose a smaller image."));
        setImage(data);
      } finally {
        bitmap.close();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("Could not read this image."));
    } finally {
      setUploading(false);
    }
  };
  return createPortal(
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-canvas/80 p-5"
      onClick={onCancel}
    >
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-label={group ? t("Edit group") : t("New group")}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = formRef.current?.querySelectorAll<HTMLElement>(
            "input:not(:disabled):not([hidden]),button:not(:disabled)",
          );
          const first = controls?.[0];
          const last = controls?.[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || uploading) return;
          if (!validGroupImage(image.trim())) {
            setError(t("Use an HTTPS image URL or upload an image."));
            return;
          }
          onSave(name.trim(), image.trim());
        }}
        className="flex max-h-[85vh] w-full max-w-[480px] flex-col overflow-y-auto rounded-2xl border border-edge bg-elevated shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-edge-soft px-6 py-5">
          <h2 className="font-display text-[24px] font-medium text-ink">
            {group ? t("Edit group") : t("New group")}
          </h2>
          <button
            type="button"
            aria-label={t("Close")}
            onClick={onCancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-raised hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex flex-col gap-5 px-6 py-6">
          <label className="flex flex-col gap-2 text-[13px] font-medium text-ink-muted">
            {t("Group name")}
            <input
              className={groupInputClass}
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-ink-muted">{t("Group artwork")}</span>
              <span className="text-[12px] text-ink-subtle">{t("Optional")}</span>
            </div>
            <div className="flex h-36 items-center justify-center rounded-xl border border-edge-soft bg-canvas p-4">
              {image && validGroupImage(image) ? (
                <img
                  src={image}
                  alt={t("Group artwork preview")}
                  className="h-full max-w-full object-contain"
                />
              ) : (
                <HarborMark className="h-20 w-20 text-ink" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={groupButtonClass}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload size={15} />
                {uploading ? t("Loading…") : t("Upload image")}
              </button>
              {image && (
                <button type="button" className={groupButtonClass} onClick={() => setImage("")}>
                  {t("Remove image")}
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={uploading}
              onChange={(event) => {
                void upload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <label className="flex flex-col gap-2 text-[13px] font-medium text-ink-muted">
              {t("Image URL (optional)")}
              <input
                className={groupInputClass}
                value={image.startsWith("data:") ? "" : image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="https://…"
              />
            </label>
            <p className="text-[12px] leading-relaxed text-ink-subtle">
              {t("Leave the image empty to use the Harbor logo.")}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-3 border-t border-edge-soft px-6 py-4">
          <button type="button" className={groupButtonClass} onClick={onCancel}>
            {t("Cancel")}
          </button>
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:opacity-40"
            disabled={!name.trim() || uploading}
          >
            {group ? t("Save changes") : t("Create group")}
          </button>
        </footer>
      </form>
    </div>,
    document.body,
  );
}
