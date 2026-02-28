import { useState } from "react";
import { ITEM_ICON_URL } from "../lib/constants";

interface ItemIconProps {
  itemId: number;
  size?: number;
}

export default function ItemIcon({ itemId, size = 24 }: ItemIconProps) {
  const [failed, setFailed] = useState(false);

  if (!itemId || itemId === 0 || failed) {
    return (
      <div
        className="rounded bg-white/5 border border-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={ITEM_ICON_URL(itemId)}
      alt=""
      width={size}
      height={size}
      className="rounded"
      onError={() => setFailed(true)}
    />
  );
}
