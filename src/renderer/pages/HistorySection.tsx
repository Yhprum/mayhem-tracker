import Champions from "./Champions";
import Augments from "./Augments";
import Friends from "./Friends";
import Trends from "./Trends";
import Records from "./Records";
import GlobalStats from "./GlobalStats";
import Items from "./Items";
import Runes from "./Runes";
import WorkInProgress from "./WorkInProgress";
import { useParams } from "react-router-dom";
import { queueForHistoryScope } from "../lib/historyScope";

export default function HistorySection() {
  const { scope, section } = useParams<{ scope?: string; section?: string }>();
  if (section === "champions") return <Champions />;
  if (section === "augments") return <Augments />;
  if (section === "friends") {
    return <Friends relation="friends" historyScope={scope} historySection={section} />;
  }
  if (section === "enemies") {
    return <Friends relation="enemies" historyScope={scope} historySection={section} />;
  }
  if (section === "trends") return <Trends />;
  if (section === "records") return <Records />;
  if (section === "total-stats") return <GlobalStats />;
  if (section === "items") return <Items />;
  if (section === "runes") return <Runes queue={queueForHistoryScope(scope)} />;
  return <WorkInProgress />;
}
