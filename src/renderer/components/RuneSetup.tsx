import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RuneData, RuneTreeLayout } from "../lib/types";
import { getRuneTree, splitRuneSelections, type RuneSelection } from "../lib/runes";
import { useRuneTreeData } from "../hooks/useChampions";
import RuneIcon from "./RuneIcon";

type RuneSetupProps = {
  runeIds: number[];
  primaryStyle?: number | null;
  secondaryStyle?: number | null;
  statShardIds?: number[];
  runeData: RuneData;
  version?: string | null;
};

function Icon({
  id,
  data,
  version,
  size,
  dim,
}: {
  id?: number;
  data: RuneData;
  version?: string | null;
  size: number;
  dim?: boolean;
}) {
  return (
    <RuneIcon
      runeId={id}
      path={id ? data[id]?.icon : undefined}
      version={version}
      size={size}
      className={dim ? "opacity-30 grayscale" : undefined}
    />
  );
}

type RenderSetup = RuneSelection & { statShardIds?: number[] };

function SetupContents({ setup, data, version, compact }: { setup: RenderSetup; data: RuneData; version?: string | null; compact?: boolean }) {
  const primaryTree = getRuneTree(data, setup.primaryTree);
  const secondaryTree = getRuneTree(data, setup.secondaryTree);
  return (
    <div className={compact ? "flex items-center gap-1" : "flex items-center gap-2"}>
      <div className="flex flex-col items-center gap-0.5">
        <Icon id={setup.keystone} data={data} version={version} size={compact ? 22 : 26} />
        {!compact && <span className="text-[9px] text-lol-gold">Keystone</span>}
      </div>
      {compact ? (
        <Icon id={setup.secondaryTree} data={data} version={version} size={18} />
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Icon id={setup.primaryTree} data={data} version={version} size={16} />
            {setup.primaryPerks.map((id) => <Icon key={`p-${id}`} id={id} data={data} version={version} size={21} />)}
          </div>
          <div className="flex items-center gap-1">
            {setup.secondaryPerks.map((id) => <Icon key={`s-${id}`} id={id} data={data} version={version} size={21} />)}
            <Icon id={setup.secondaryTree} data={data} version={version} size={16} />
          </div>
          <div className="flex items-center gap-1 border-t border-lol-border/50 pt-1">
            {setup.statShardIds?.map((id) => <Icon key={`shard-${id}`} id={id} data={data} version={version} size={16} />)}
          </div>
          <div className="text-[9px] text-lol-text">
            {primaryTree?.name ?? "Primary"} / {secondaryTree?.name ?? "Secondary"}
          </div>
        </div>
      )}
    </div>
  );
}

// Full tree layout for the tooltip: every rune Data Dragon lists for the
// player's primary/secondary trees, with the ones they actually picked lit up
// (gold ring) and everything else dimmed to grayscale. `treeData` is the raw
// runesReforged.json slot structure ({treeId: {slots: number[][]}}); `setup`
// carries which of those ids were selected.
function FullTreeContents({
  setup,
  data,
  treeData,
  version,
}: {
  setup: RenderSetup;
  data: RuneData;
  treeData: RuneTreeLayout;
  version?: string | null;
}) {
  const primaryTree = getRuneTree(data, setup.primaryTree);
  const secondaryTree = getRuneTree(data, setup.secondaryTree);
  const primaryLayout = setup.primaryTree != null ? treeData[setup.primaryTree] : undefined;
  const secondaryLayout = setup.secondaryTree != null ? treeData[setup.secondaryTree] : undefined;
  const selected = new Set(
    [setup.keystone, ...setup.primaryPerks, ...setup.secondaryPerks].filter(
      (id): id is number => id != null,
    ),
  );

  const renderRow = (ids: number[], size: number, keyPrefix: string) => (
    <div className="flex items-center gap-1">
      {ids.map((id) => (
        <Icon key={`${keyPrefix}-${id}`} id={id} data={data} version={version} size={size} dim={!selected.has(id)} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      {/* Primary tree: keystone row + 3 perk rows, using Data Dragon's own
          slot grouping (slots[0]=keystones, slots[1..3]=perk rows). */}
      <div>
        <div className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-wider text-lol-gold">
          <Icon id={setup.primaryTree} data={data} version={version} size={14} />
          {primaryTree?.name ?? "Primary"}
        </div>
        <div className="flex flex-col gap-1">
          {primaryLayout ? (
            primaryLayout.slots.map((row, i) => renderRow(row, i === 0 ? 26 : 21, `pri-${i}`))
          ) : (
            <div className="flex items-center gap-1">
              <Icon id={setup.keystone} data={data} version={version} size={26} />
              {setup.primaryPerks.map((id) => <Icon key={`p-${id}`} id={id} data={data} version={version} size={21} />)}
            </div>
          )}
        </div>
      </div>

      {/* Secondary tree: 2 of the 3 non-keystone rows, whichever the player
          picked from. */}
      <div>
        <div className="mb-1 flex items-center gap-1 text-[9px] uppercase tracking-wider text-lol-gold">
          <Icon id={setup.secondaryTree} data={data} version={version} size={14} />
          {secondaryTree?.name ?? "Secondary"}
        </div>
        <div className="flex flex-col gap-1">
          {secondaryLayout ? (
            secondaryLayout.slots
              .slice(1)
              .map((row, i) => renderRow(row, 21, `sec-${i}`))
          ) : (
            <div className="flex items-center gap-1">
              {setup.secondaryPerks.map((id) => <Icon key={`s-${id}`} id={id} data={data} version={version} size={21} />)}
            </div>
          )}
        </div>
      </div>

      {/* Stat shards */}
      {setup.statShardIds && setup.statShardIds.length > 0 && (
        <div className="flex items-center gap-1 border-t border-lol-border/50 pt-1.5">
          {setup.statShardIds.map((id) => (
            <Icon key={`shard-${id}`} id={id} data={data} version={version} size={16} />
          ))}
        </div>
      )}
    </div>
  );
}

export function RuneCompact({
  children,
  ...props
}: RuneSetupProps & { children?: ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const treeData = useRuneTreeData();
  const setup = splitRuneSelections(props.runeIds, props.primaryStyle, props.secondaryStyle);
  const compact = (
    <span
      className="inline-flex cursor-help"
      onMouseEnter={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => setAnchor(null)}
    >
      {children ?? <SetupContents setup={setup} data={props.runeData} version={props.version} compact />}
    </span>
  );
  const tooltip = anchor ? (
    <div
      className="pointer-events-none fixed z-[100] rounded-lg border border-lol-gold/60 bg-lol-dark px-3 py-2.5 shadow-2xl"
      style={{
        left: Math.min(anchor.left, window.innerWidth - 260),
        top: Math.max(8, anchor.bottom + 8),
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wider text-lol-gold">
        <span>Runes</span>
        <span className="text-lol-text">Full setup</span>
      </div>
      <FullTreeContents
        setup={{ ...setup, statShardIds: props.statShardIds }}
        data={props.runeData}
        treeData={treeData}
        version={props.version}
      />
    </div>
  ) : null;
  return (
    <>
      {compact}
      {tooltip && createPortal(tooltip, document.body)}
    </>
  );
}

export function RuneSetupGrid(props: RuneSetupProps) {
  const setup = splitRuneSelections(props.runeIds, props.primaryStyle, props.secondaryStyle);
  return <SetupContents setup={{ ...setup, statShardIds: props.statShardIds }} data={props.runeData} version={props.version} />;
}
