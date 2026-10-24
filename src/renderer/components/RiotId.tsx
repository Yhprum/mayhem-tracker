// A player's Riot ID with its name and tag each isolated from the text around
// them. A name in a right-to-left script (Arabic, on the Middle East server)
// would otherwise pull a numeric tag, or a count beside it, over to its own
// side. An ID without a tag is shown as it is.
export default function RiotId({ id }: { id: string }) {
  const hash = id.lastIndexOf("#");
  if (hash <= 0) return <bdi>{id}</bdi>;
  return (
    <>
      <bdi>{id.slice(0, hash)}</bdi>#<bdi>{id.slice(hash + 1)}</bdi>
    </>
  );
}
