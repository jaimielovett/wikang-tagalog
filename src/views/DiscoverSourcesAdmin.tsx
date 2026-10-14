// Account › Discover sources (admins): the default sources everyone's Discover draws on.
import { useEffect, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import { Switch } from "../components/ui";
import { errorText } from "../lib/api";
import { LEVELS, ago } from "../lib/discover";
import { useApp } from "../lib/store";
import { cloud } from "../lib/web/cloud";
import { channelId, listSources, requestRefresh, type DiscoverSource, type SourceKind } from "../lib/web/discover";

const KINDS: { value: SourceKind; label: string; icon: IconName; hint: string }[] = [
  { value: "youtube", label: "YouTube channel", icon: "youtube", hint: "Channel ID (UC…) or a youtube.com/channel/… link" },
  { value: "podcast", label: "Podcast", icon: "podcast", hint: "The podcast's RSS feed address" },
  { value: "articles", label: "Articles", icon: "text", hint: "The site's RSS or Atom feed address. Only Tagalog articles are kept." },
];
const SHELVES: { value: DiscoverSource["shelf"]; label: string }[] = [
  { value: "learn", label: "For learners" },
  { value: "news", label: "News" },
  { value: "culture", label: "Culture" },
  { value: "music", label: "Songs" },
];

type Draft = Pick<DiscoverSource, "name" | "kind" | "url" | "shelf" | "lo" | "hi" | "grade_titles">;
const blank = (): Draft => ({ name: "", kind: "youtube", url: "", shelf: "learn", lo: 1, hi: 3, grade_titles: true });

/** The address as the database expects it, or a message saying what is wrong. */
function checkUrl(d: Draft): { url: string } | { error: string } {
  if (d.kind === "youtube") {
    const id = channelId(d.url);
    return id ? { url: id } : { error: "Paste the channel ID (UC…) or a youtube.com/channel/… link. (Handles like @name aren't supported yet.)" };
  }
  try {
    const url = new URL(d.url.trim());
    return url.protocol === "https:" ? { url: url.href } : { error: "The feed address must start with https://" };
  } catch {
    return { error: "Enter the feed's full address, starting with https://" };
  }
}

const slug = (name: string) =>
  "tl-" +
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

function SourceForm({ initial, busy, onSave, onCancel }: { initial: Draft; busy: boolean; onSave(d: Draft): void; onCancel(): void }) {
  const [d, setD] = useState(initial);
  const kind = KINDS.find((k) => k.value === d.kind)!;
  return (
    <form
      className="source-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <div className="field">
        <label htmlFor="src-name">Name</label>
        <input id="src-name" className="input" value={d.name} maxLength={120} required onChange={(e) => setD({ ...d, name: e.target.value })} />
      </div>
      <div className="source-form-row">
        <div className="field">
          <label htmlFor="src-kind">Type</label>
          <select id="src-kind" className="select" value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as SourceKind })}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="src-shelf">Shelf</label>
          <select id="src-shelf" className="select" value={d.shelf} onChange={(e) => setD({ ...d, shelf: e.target.value as Draft["shelf"] })}>
            {SHELVES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="src-lo">From</label>
          <select id="src-lo" className="select" value={d.lo} onChange={(e) => setD({ ...d, lo: Number(e.target.value), hi: Math.max(d.hi, Number(e.target.value)) })}>
            {LEVELS.map((l, i) => (
              <option key={l} value={i + 1}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="src-hi">To</label>
          <select id="src-hi" className="select" value={d.hi} onChange={(e) => setD({ ...d, hi: Number(e.target.value) })}>
            {LEVELS.map((l, i) =>
              i + 1 >= d.lo ? (
                <option key={l} value={i + 1}>
                  {l}
                </option>
              ) : null,
            )}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="src-url">Address</label>
        <input id="src-url" className="input" value={d.url} required placeholder={d.kind === "youtube" ? "UC…" : "https://…"} onChange={(e) => setD({ ...d, url: e.target.value })} />
        <span className="source-hint">{kind.hint}</span>
      </div>
      <label className="check-label">
        <input type="checkbox" checked={d.grade_titles} onChange={(e) => setD({ ...d, grade_titles: e.target.checked })} />
        Read levels from titles (“for Beginners”, “A2”) within this range
      </label>
      <div className="form-actions">
        <button className="btn primary" disabled={busy}>
          Save source
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function status(s: DiscoverSource) {
  if (s.retired_at) return "Retired";
  if (!s.last_fetched_at) return "Not read yet";
  const when = ago(Math.floor(Date.parse(s.last_fetched_at) / 1000));
  return `${s.item_count} item${s.item_count === 1 ? "" : "s"} · read ${when}`;
}

export function DiscoverSourcesAdmin() {
  const toast = useApp((s) => s.toast);
  const [sources, setSources] = useState<DiscoverSource[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = () =>
    listSources()
      .then(setSources)
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = (d: Draft, id?: string) =>
    run(async () => {
      if (!cloud) return;
      const checked = checkUrl(d);
      if ("error" in checked) throw new Error(checked.error);
      const row = { name: d.name.trim(), kind: d.kind, url: checked.url, shelf: d.shelf, lo: d.lo, hi: d.hi, grade_titles: d.grade_titles };
      if (id) {
        const { error } = await cloud.from("discover_sources").update(row).eq("id", id);
        if (error) throw new Error("Could not save the source. Check its address and levels.");
      } else {
        const taken = new Set((sources ?? []).map((s) => s.id));
        let newId = slug(d.name) || "tl-source";
        for (let n = 2; taken.has(newId); n++) newId = `${slug(d.name)}-${n}`;
        const { error } = await cloud.from("discover_sources").insert({ id: newId, ...row });
        if (error) throw new Error("Could not add the source. Check its address and levels.");
      }
      setEditing(null);
      toast(id ? "Source saved" : "Source added. It appears after the next refresh.", "light");
    });

  const patch = (id: string, values: Partial<Pick<DiscoverSource, "enabled" | "retired_at">>) =>
    run(async () => {
      const { error } = await cloud!.from("discover_sources").update(values).eq("id", id);
      if (error) throw new Error("Could not update the source.");
    });

  const refresh = () =>
    run(async () => {
      const r = await requestRefresh();
      toast(
        !r.refreshed
          ? "A refresh is already running. Try again in a few minutes."
          : r.failed.length
            ? `Read ${r.sources} sources; ${r.failed.length} didn't answer.`
            : `Read ${r.sources} sources.`,
        r.failed.length ? "error" : "light",
      );
    });

  const current = (sources ?? []).filter((s) => !s.retired_at);
  const retired = (sources ?? []).filter((s) => s.retired_at);

  return (
    <section className="admin-sources">
      <div className="admin-sources-head">
        <div>
          <h2>Discover sources</h2>
          <p>Everyone's Discover draws on these. Learners can switch any of them off for themselves.</p>
        </div>
        <div className="form-actions">
          <button className="btn outline" disabled={busy} onClick={() => void refresh()}>
            <Icon name="refresh" size={15} /> Refresh now
          </button>
          <button className="btn primary" disabled={busy || editing === "new"} onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> Add a source
          </button>
        </div>
      </div>
      {error && (
        <div className="auth-error" role="alert">
          <Icon name="ban" size={15} />
          <span>{error}</span>
        </div>
      )}
      {editing === "new" && <SourceForm initial={blank()} busy={busy} onSave={(d) => void save(d)} onCancel={() => setEditing(null)} />}
      {!sources ? (
        <p className="muted">Loading sources…</p>
      ) : (
        <div className="source-list">
          {current.map((s) =>
            editing === s.id ? (
              <SourceForm key={s.id} initial={s} busy={busy} onSave={(d) => void save(d, s.id)} onCancel={() => setEditing(null)} />
            ) : (
              <div key={s.id} className={`source-row admin ${s.enabled ? "" : "off"}`}>
                <Icon name={KINDS.find((k) => k.value === s.kind)?.icon ?? "text"} size={17} />
                <span className="source-meta">
                  <strong>{s.name}</strong>
                  <span>
                    {SHELVES.find((x) => x.value === s.shelf)?.label} · {LEVELS[s.lo - 1]}
                    {s.hi !== s.lo ? `–${LEVELS[s.hi - 1]}` : ""} · {status(s)}
                  </span>
                  {s.last_error && <span className="source-error">{s.last_error}</span>}
                </span>
                <button className="btn ghost sm" disabled={busy} onClick={() => setEditing(s.id)}>
                  Edit
                </button>
                <button className="btn ghost sm" disabled={busy} onClick={() => void patch(s.id, { retired_at: new Date().toISOString() })}>
                  Retire
                </button>
                <Switch on={s.enabled} onChange={(on) => void patch(s.id, { enabled: on })} label={`${s.name} for everyone`} />
              </div>
            ),
          )}
          {retired.length > 0 && (
            <details className="sources-retired">
              <summary>Retired ({retired.length})</summary>
              {retired.map((s) => (
                <div key={s.id} className="source-row admin off">
                  <Icon name={KINDS.find((k) => k.value === s.kind)?.icon ?? "text"} size={17} />
                  <span className="source-meta">
                    <strong>{s.name}</strong>
                    <span>Hidden from everyone</span>
                  </span>
                  <button className="btn ghost sm" disabled={busy} onClick={() => void patch(s.id, { retired_at: null })}>
                    Restore
                  </button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
