import { NavLink } from "react-router-dom";
import type { ComponentType, SVGProps } from "react";
import { useLcuStatus } from "../hooks/useLcuStatus";
import type { UpdateInfo } from "../lib/types";
import { SettingsIcon, DownloadIcon } from "./icons";
import { Brand, RecapBadge, statusColors, statusLabels, useNavEntries } from "./NavChrome";

function SidebarLink({
  to,
  label,
  icon: Icon,
  search,
  title,
  badge,
  onClick,
}: {
  to: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  search?: string;
  title?: string;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={search ? { pathname: to, search } : to}
      end={to === "/"}
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      className={({ isActive }) =>
        `relative flex items-center justify-center xl:justify-start gap-3 p-2 xl:px-3 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors ${
          isActive
            ? "bg-lol-gold/10 text-lol-gold"
            : "text-lol-text hover:bg-white/5 hover:text-lol-text-bright"
        }`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="hidden xl:inline">{label}</span>
      {badge && (
        <>
          <RecapBadge name={badge} className="hidden xl:inline ml-auto" />
          <span className="xl:hidden absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-lol-gold" />
        </>
      )}
    </NavLink>
  );
}

// The links down the left of the window, for anyone who prefers them there to
// the header. Window controls sit in a strip above the page instead. On a
// narrow window it shrinks to a rail of icons, leaving the page the room it
// has under the header.
export default function Sidebar({
  update,
  onUpdate,
}: {
  update: UpdateInfo | null;
  onUpdate: () => void;
}) {
  const status = useLcuStatus();
  const entries = useNavEntries();

  return (
    <nav className="w-14 xl:w-56 shrink-0 flex flex-col border-r border-lol-border/60 bg-lol-card/60">
      {/* As tall as the strip above the page, so the two dividers meet */}
      <div className="titlebar-drag h-11 shrink-0 flex items-center justify-center xl:justify-start xl:px-4 border-b border-lol-border/60">
        <Brand nameClassName="hidden xl:inline" />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 p-2 xl:p-3">
        {entries.map((entry) => (
          <SidebarLink key={entry.to} {...entry} />
        ))}
      </div>

      <div className="px-2 xl:px-3 pb-2">
        <SidebarLink to="/settings" label="Settings" icon={SettingsIcon} />
      </div>

      <div className="flex flex-col gap-2 p-2 xl:p-3 border-t border-lol-border/60">
        {update && (
          <button
            onClick={onUpdate}
            title={`Update to version ${update.latest}`}
            aria-label={`Update to version ${update.latest}`}
            className="flex items-center justify-center gap-1.5 rounded-md border border-lol-gold/30 bg-lol-gold/10 p-2 xl:px-2.5 xl:py-1.5 text-xs text-lol-gold hover:bg-lol-gold/20 transition-colors"
          >
            <DownloadIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline">Update to v{update.latest}</span>
          </button>
        )}
        <div
          role="status"
          title={`League client: ${statusLabels[status]}`}
          className="flex items-center justify-center xl:justify-start gap-2 py-1 xl:px-1 xl:py-0"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusColors[status]}`} />
          <span className="hidden xl:inline text-xs text-lol-text">
            League client: {statusLabels[status]}
          </span>
        </div>
      </div>
    </nav>
  );
}
