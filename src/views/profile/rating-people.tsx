import { Loader2 } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search } from "@/components/icons/search-icon";
import { useT } from "@/lib/i18n";
import { sourceLabel, type RatingSource } from "@/lib/ratings/trigger";
import { eachLimit, ratingsVisible } from "@/lib/ratings/visible";
import { searchUsers, type UserHit } from "@/lib/social/user-search";
import { Avatar } from "./profile-bits";

/** Every person the picker can offer, ranked by how well they match what is typed. */
function rankPeople(sources: RatingSource[], hits: UserHit[], query: string): RatingSource[] {
  const all: RatingSource[] = [];
  const seen = new Set<string>();
  const add = (source: RatingSource) => {
    const key = source.handle.toLowerCase();
    if (!source.handle || seen.has(key)) return;
    seen.add(key);
    all.push(source);
  };
  for (const source of sources) add(source);
  for (const hit of hits) {
    add({
      handle: hit.handle,
      label: hit.alias,
      kind: "any",
      avatarUrl: hit.avatarUrl,
      online: hit.online,
    });
  }
  const q = query.trim().toLowerCase();
  if (!q) return all;
  const score = (source: RatingSource) => {
    const label = (source.label || source.handle).toLowerCase();
    const handle = source.handle.toLowerCase();
    if (label.startsWith(q) || handle.startsWith(q)) return 0;
    if (label.includes(q) || handle.includes(q)) return 1;
    return -1;
  };
  return all.filter((source) => score(source) >= 0).sort((a, b) => score(a) - score(b));
}

/**
 * The people half of the rating picker: the profile owner, the author and every friend, plus a
 * search field that reaches anyone on Harbor by @handle or name. People whose ratings are not
 * published are dropped once we know that, so the list only offers ratings that can be quoted.
 */
export function PeoplePanel({
  sources,
  activeHandle,
  onPick,
  onBack,
}: {
  sources: RatingSource[];
  activeHandle: string;
  onPick: (source: RatingSource) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<UserHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const ctrl = new AbortController();
    const id = window.setTimeout(() => {
      searchUsers(q, ctrl.signal)
        .then((found) => {
          if (ctrl.signal.aborted) return;
          setHits(found);
          setSearching(false);
        })
        .catch(() => {
          if (ctrl.signal.aborted) return;
          setHits([]);
          setSearching(false);
        });
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(id);
    };
  }, [query]);

  const candidates = useMemo(() => rankPeople(sources, hits, query), [sources, hits, query]);

  useEffect(() => {
    const unknown = candidates.filter(
      (person) => hidden[person.handle.toLowerCase()] === undefined,
    );
    if (!unknown.length) return;
    let live = true;
    void eachLimit(unknown, 5, async (person) => {
      const visible = await ratingsVisible(person.handle);
      if (live) setHidden((prev) => ({ ...prev, [person.handle.toLowerCase()]: visible }));
    });
    return () => {
      live = false;
    };
  }, [candidates, hidden]);

  const people = candidates.filter((person) => hidden[person.handle.toLowerCase()] !== false);
  const core = people.filter((person) => person.kind === "owner" || person.kind === "me");
  const friends = people.filter((person) => person.kind === "friend");
  const anyone = people.filter((person) => person.kind === "any");
  const ordered = [...core, ...friends, ...anyone];
  const active = Math.max(0, Math.min(index, ordered.length - 1));
  const activeKey = activeHandle.trim().toLowerCase();

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const move = (step: number) =>
    setIndex((i) => (ordered.length ? (i + step + ordered.length) % ordered.length : 0));

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const person = ordered[active];
      if (person) onPick(person);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    }
  };

  return (
    <div>
      <div className="flex items-center gap-1.5 border-b border-soft px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("Back")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-subtle transition-colors hover:bg-raised hover:text-ink"
        >
          <span aria-hidden="true">&#8592;</span>
        </button>
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute inset-y-0 start-2.5 my-auto text-ink-subtle"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("@handle or name")}
            spellCheck={false}
            aria-label={t("Find someone whose rating to quote")}
            className="h-9 w-full rounded-lg border border-edge-soft bg-canvas ps-8 pe-8 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-edge"
          />
          {searching && (
            <Loader2
              size={14}
              className="absolute inset-y-0 end-2.5 my-auto animate-spin text-ink-subtle"
            />
          )}
        </div>
      </div>

      <div
        role="listbox"
        aria-label={t("People you can quote")}
        className="harbor-scroll max-h-[240px] overflow-y-auto py-1"
      >
        {ordered.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12.5px] text-ink-subtle">
            {query.trim()
              ? t('No matches for "{query}"', { query: query.trim() })
              : t("No one here has ratings to quote.")}
          </p>
        ) : (
          ordered.map((person, i) => (
            <div key={person.handle.toLowerCase()} role="presentation">
              {i === core.length && friends.length > 0 && <Divider label={t("Friends")} />}
              {i === core.length + friends.length && anyone.length > 0 && (
                <Divider label={t("Anyone")} />
              )}
              <PersonRow
                person={person}
                label={sourceLabel(person, t)}
                active={i === active}
                current={person.handle.toLowerCase() === activeKey}
                onHover={() => setIndex(i)}
                onPick={() => onPick(person)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
      {label}
    </p>
  );
}

function PersonRow({
  person,
  label,
  active,
  current,
  onHover,
  onPick,
}: {
  person: RatingSource;
  label: string;
  active: boolean;
  current: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-start transition-colors ${
        active ? "bg-raised" : ""
      }`}
    >
      <Avatar
        src={person.avatarUrl}
        size={28}
        online={person.online}
        alias={person.label ?? person.handle}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
        {label}
        {label !== `@${person.handle}` && (
          <span className="font-normal text-ink-subtle"> @{person.handle}</span>
        )}
      </span>
      {current && (
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-accent">
          {t("Selected")}
        </span>
      )}
    </button>
  );
}
