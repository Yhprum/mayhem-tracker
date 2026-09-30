// The contract between the main process and the page it captures a card image
// from. A card is an ordinary route in the renderer, drawn in a second window
// sized to it, so the two halves only need to agree on where the route lives
// and on how the page says it is done drawing.

// The card is drawn by a second window running the same renderer at a fixed
// width, rather than by a drawing routine of its own: the image is then the
// app's own markup, it stays in step with the page for free, and it looks the
// same whatever size the visible window has been dragged to. The Season Recap
// page previews its card at this width too, scaled down to fit.
export const CARD_WIDTH = 1200;

export const GAME_CARD_ROUTE = "/card";

export const SEASON_CARD_ROUTE = "/season-card";

// What a card is of: one game's scoreboard, or a season's recap under the same
// filters and options the Season Recap page had selected.
export type CardSpec =
  | { kind: "game"; gameId: number }
  | {
      kind: "season";
      seasonId: string;
      queue?: number;
      account?: string;
      // Friends' names blanked out, for an image going somewhere public
      hideFriends?: boolean;
    };

export function cardRoute(card: CardSpec): string {
  if (card.kind === "game") return `${GAME_CARD_ROUTE}/${card.gameId}`;
  const params = new URLSearchParams();
  if (card.queue != null) params.set("queue", String(card.queue));
  if (card.account) params.set("account", card.account);
  if (card.hideFriends) params.set("hideFriends", "1");
  const query = params.toString();
  return `${SEASON_CARD_ROUTE}/${encodeURIComponent(card.seasonId)}${query ? `?${query}` : ""}`;
}

// Set on `window` by the card page. The main process has no other way to know
// when the card's data and every one of its icons have landed, and a capture
// taken a moment early is a card with holes in it.
export const CARD_STATUS_KEY = "__mayhemCardStatus";

export interface CardStatus {
  state: "ready" | "error";
  // Height of the card in CSS pixels, which the window is resized to before the
  // capture so the whole thing is on screen at once
  height: number;
  error?: string;
}
