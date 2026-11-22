import { useState } from "react";
import { LOCALE } from "../lib/format";
import type { ReleaseNote } from "../lib/types";
import { ChevronRightIcon } from "./icons";
import Markdown from "./Markdown";

function formatReleaseDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(LOCALE, { month: "short", day: "numeric" });
}

function ReleaseBody({ release }: { release: ReleaseNote }) {
  if (!release.body) {
    return <p className="text-[12px] text-lol-text/50 italic">No notes for this release.</p>;
  }
  return (
    <div className="text-[12px] text-lol-text">
      <Markdown text={release.body} />
    </div>
  );
}

// A scrolling box of release notes, newest first
export default function ReleaseNotes({ releases }: { releases: ReleaseNote[] }) {
  // Only the newest is expanded up front: someone several versions behind gets a
  // scannable list of what they missed instead of a wall of bullets.
  const [openVersions, setOpenVersions] = useState<Set<string>>(
    () => new Set(releases.length ? [releases[0].version] : []),
  );

  const toggleVersion = (version: string) => {
    setOpenVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };

  return (
    <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border border-lol-border bg-black/20 p-3">
      {releases.map((release, i) => {
        // A single release needs no accordion around it.
        if (releases.length === 1) return <ReleaseBody key={release.version} release={release} />;
        const open = openVersions.has(release.version);
        return (
          <div
            key={release.version}
            className={i > 0 ? "mt-1 border-t border-lol-border/50 pt-1" : ""}
          >
            <button
              onClick={() => toggleVersion(release.version)}
              className="flex w-full items-center gap-1.5 rounded py-1 text-left hover:bg-white/5 transition-colors cursor-pointer"
            >
              <ChevronRightIcon
                className={`w-3 h-3 shrink-0 text-lol-text/50 transition-transform ${open ? "rotate-90" : ""}`}
              />
              <span className="text-[12px] font-semibold text-lol-gold">v{release.version}</span>
              <span className="ml-auto text-[11px] text-lol-text/40">
                {formatReleaseDate(release.publishedAt)}
              </span>
            </button>
            {open && (
              <div className="pb-2 pl-[18px]">
                <ReleaseBody release={release} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
