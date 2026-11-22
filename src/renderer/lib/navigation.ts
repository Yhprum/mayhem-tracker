import type { ComponentType, SVGProps } from "react";
import { createSettingStore } from "./settingStore";
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

// The paths of the links switched off in Settings
export const hiddenNavLinks = createSettingStore<ReadonlySet<string>>(
  "hidden_nav_links",
  new Set(),
  (raw) => new Set(raw.split(",").filter((to) => to && to !== HOME_PATH)),
  (hidden) => [...hidden].join(","),
);

export function toggleNavLink(to: string): Promise<void> {
  if (to === HOME_PATH) return Promise.resolve();
  const next = new Set(hiddenNavLinks.get());
  if (!next.delete(to)) next.add(to);
  return hiddenNavLinks.set(next);
}

// Links across the top of the window, or down a sidebar on its left
export type NavLayout = "header" | "sidebar";

export const navLayout = createSettingStore<NavLayout>(
  "nav_layout",
  "header",
  (raw) => (raw === "sidebar" ? "sidebar" : "header"),
  (layout) => layout,
);
