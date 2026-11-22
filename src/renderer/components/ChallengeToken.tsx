import { GAME_ASSET_URL } from "../lib/constants";

interface ChallengeTokenProps {
  // Game-data path to the tier's token, as the client names it
  iconPath: string;
  size?: number;
  // An unstarted challenge borrows the IRON token, drawn faint so it doesn't
  // read as earned
  dim?: boolean;
  // Hover text, for the tokens that stand on their own without a label beside
  // them
  title?: string;
  className?: string;
}

export default function ChallengeToken({
  iconPath,
  size = 40,
  dim = false,
  title,
  className = "",
}: ChallengeTokenProps) {
  if (!iconPath) {
    return (
      <div
        style={{ width: size, height: size }}
        title={title}
        className={`rounded-full border border-lol-border/60 bg-white/5 shrink-0 ${className}`}
      />
    );
  }

  return (
    <img
      src={GAME_ASSET_URL("latest", iconPath)}
      alt=""
      title={title}
      width={size}
      height={size}
      className={`shrink-0 ${dim ? "opacity-25 grayscale" : ""} ${className}`}
      onError={(e) => {
        (e.target as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}
