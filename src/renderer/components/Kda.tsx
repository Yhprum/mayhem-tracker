// Kills / deaths / assists with the slashes dimmed and drawn in close, so the
// three numbers carry the line. The gap is in em to hold its proportion at any
// size the line is set in.
export default function Kda({
  kills,
  deaths,
  assists,
}: {
  kills: number | string;
  deaths: number | string;
  assists: number | string;
}) {
  return (
    <>
      {kills}
      <Slash />
      {deaths}
      <Slash />
      {assists}
    </>
  );
}

function Slash() {
  return <span className="mx-[0.15em] text-lol-text/40">/</span>;
}
