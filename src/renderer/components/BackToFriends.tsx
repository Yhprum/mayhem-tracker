import { Link } from "react-router-dom";
import type { FriendsLink } from "../lib/types";

// `link` is the view to land on, for a page that opened from one other than the
// list's default
export default function BackToFriends({ link }: { link?: FriendsLink }) {
  return (
    <Link
      to="/friends"
      state={link}
      className="inline-flex items-center gap-1.5 text-xs text-lol-text hover:text-lol-text-bright transition-colors"
    >
      <span aria-hidden>←</span> Friends
    </Link>
  );
}
