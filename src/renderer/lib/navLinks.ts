import type { ComponentType, SVGProps } from "react";
import {
  SwordsIcon,
  TrophyIcon,
  CrosshairIcon,
  UsersIcon,
  GlobeIcon,
  TrendingUpIcon,
  MedalIcon,
  RadioIcon,
  AwardIcon,
  CalendarIcon,
} from "../components/icons";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export type NavLinkDef = { to: string; label: string; icon: IconComponent };

export const NAV_LINKS: NavLinkDef[] = [
  { to: "/", label: "Match History", icon: SwordsIcon },
  { to: "/live", label: "Live Game", icon: RadioIcon },
  { to: "/champions", label: "Champions", icon: TrophyIcon },
  { to: "/augments", label: "Augments", icon: CrosshairIcon },
  { to: "/friends", label: "Friends", icon: UsersIcon },
  { to: "/trends", label: "Trends", icon: TrendingUpIcon },
  { to: "/records", label: "Records", icon: MedalIcon },
  { to: "/season", label: "Season Recap", icon: CalendarIcon },
  { to: "/challenges", label: "Challenges", icon: AwardIcon },
  { to: "/global", label: "Total Stats", icon: GlobeIcon },
];

// The page the app opens on, so its link can't be hidden
export const HOME_PATH = "/";

export const HIDDEN_NAV_LINKS_SETTING = "hidden_nav_links";

// The paths of the links switched off in Settings, shared between that page
// and the header so a change shows up without a reload
let hidden: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>) {
  hidden = next;
  for (const listener of listeners) listener();
}

export function getHiddenNavLinks(): ReadonlySet<string> {
  return hidden;
}

export function subscribeHiddenNavLinks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Read from the database once per launch; after that this module is the copy
// every writer goes through
let loading: Promise<void> | null = null;

export function loadHiddenNavLinks(): Promise<void> {
  loading ??= window.api.getSetting(HIDDEN_NAV_LINKS_SETTING).then((raw) => {
    publish(new Set(raw ? raw.split(",").filter((to) => to !== HOME_PATH) : []));
  });
  return loading;
}

export async function toggleNavLink(to: string): Promise<void> {
  if (to === HOME_PATH) return;
  const next = new Set(hidden);
  if (!next.delete(to)) next.add(to);
  publish(next);
  await window.api.setSetting(HIDDEN_NAV_LINKS_SETTING, [...next].join(","));
}
