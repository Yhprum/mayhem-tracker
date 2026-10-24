import { useEffect } from "react";
import { useFilterOptions } from "../hooks/useFilterOptions";
import { findSeason } from "../../shared/seasons";
import { FilterField } from "./FilterMenu";

export function seasonName(id: string): string {
  return findSeason(id)?.name ?? id;
}

// The Mayhem set to narrow a page to, by the date window its pass ran in
export default function SeasonSelect({
  value,
  onChange,
  label,
}: {
  value: string | undefined;
  onChange: (season: string | undefined) => void;
  // Set inside a filter menu, where the select fills a labelled field
  label?: string;
}) {
  const { seasons } = useFilterOptions();

  // Clear the selection if new data leaves it without any matching games
  useEffect(() => {
    if (value !== undefined && seasons.length > 0 && !seasons.includes(value)) {
      onChange(undefined);
    }
  }, [seasons, value, onChange]);

  const select = (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      className={label ? "select w-full" : "select"}
    >
      <option value="">All Sets</option>
      {seasons.map((s) => (
        <option key={s} value={s}>
          {seasonName(s)}
        </option>
      ))}
    </select>
  );
  return label ? <FilterField label={label}>{select}</FilterField> : select;
}
