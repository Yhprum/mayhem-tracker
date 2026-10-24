import { useEffect } from "react";
import { useFilterOptions } from "../hooks/useFilterOptions";
import { formatPatch } from "../lib/format";
import { FilterField } from "./FilterMenu";

export default function PatchSelect({
  value,
  onChange,
  label,
}: {
  value: string | undefined;
  onChange: (patch: string | undefined) => void;
  // Set inside a filter menu, where the select fills a labelled field
  label?: string;
}) {
  const { patches } = useFilterOptions();

  // Clear the selection if new data leaves it without any matching games
  useEffect(() => {
    if (value !== undefined && patches.length > 0 && !patches.includes(value)) {
      onChange(undefined);
    }
  }, [patches, value, onChange]);

  const select = (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      className={label ? "select w-full" : "select"}
    >
      <option value="">All Patches</option>
      {patches.map((p) => (
        <option key={p} value={p}>
          Patch {formatPatch(p)}
        </option>
      ))}
    </select>
  );
  return label ? <FilterField label={label}>{select}</FilterField> : select;
}
