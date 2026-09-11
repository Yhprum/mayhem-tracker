import { useState, useEffect } from "react";
import { QUEUE_LABELS } from "../../shared/queues";
import { QUEUE_GROUP_ARENA } from "../../shared/queues";
import { useHistoryScopeQueue } from "../lib/historyScope";

export function queueLabel(queueId: number): string {
  return QUEUE_LABELS[queueId] ?? `Queue ${queueId}`;
}

export default function QueueSelect({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (queue: number | undefined) => void;
}) {
  const [queues, setQueues] = useState<number[]>([]);
  const scopedQueue = useHistoryScopeQueue();

  useEffect(() => {
    const fetchQueues = () =>
      window.api.getMatchFilterOptions({ queue: scopedQueue }).then((o) => setQueues(o.queues));
    fetchQueues();
    const unsub = window.api.onGamesUpdated(fetchQueues);
    return unsub;
  }, [scopedQueue]);

  // Clear the selection if new data leaves it without any matching games
  useEffect(() => {
    if (value !== undefined && queues.length > 0 && !queues.includes(value)) {
      onChange(undefined);
    }
  }, [queues, value, onChange]);

  if (queues.length < 2) return null;

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
      className="select"
    >
      <option value="">All Queues</option>
      {queues.map((q) => (
        <option key={q} value={q}>
          {q === QUEUE_GROUP_ARENA ? "Arena" : queueLabel(q)}
        </option>
      ))}
    </select>
  );
}
