import { CHAMPION_ICON_URL } from "../lib/constants";

interface ChampionIconProps {
  championId: number;
  size?: number;
  className?: string;
}

export default function ChampionIcon({ championId, size = 32, className = "" }: ChampionIconProps) {
  return (
    <img
      src={CHAMPION_ICON_URL(championId)}
      alt=""
      width={size}
      height={size}
      className={`rounded-full ${className}`}
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}
