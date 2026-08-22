import { useSummonerSpellData } from "../hooks/useChampions";
import { CDRAGON_ASSET_URL } from "../lib/constants";

interface SummonerSpellIconProps {
  spellId: number | null;
  size?: number;
}

export default function SummonerSpellIcon({ spellId, size = 16 }: SummonerSpellIconProps) {
  const spells = useSummonerSpellData();
  const spell = spellId != null ? spells[spellId] : undefined;

  if (!spellId || !spell?.iconPath) {
    return (
      <div
        className="rounded bg-white/5 border border-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={CDRAGON_ASSET_URL("latest", spell.iconPath)}
      alt=""
      title={spell.name}
      width={size}
      height={size}
      className="rounded"
    />
  );
}
