// Regenerates src/main/augment-descriptions.json, the Mayhem augment tooltip
// text bundled into the main process, and src/renderer/texticons.json, the
// inline stat glyphs that text refers to.
//
// Run it when augments change:  npm run gen:augments
//
// Why a build step and not a fetch at runtime: unlike items, whose descriptions
// arrive fully formed in the items.json the app already loads per patch,
// augment text is assembled from two large game-data exports —
//
//   kiwi.bin.json         12MB  Mayhem's mode data. "Kiwi" is the mode's
//                               codename; its AugmentData entries carry the
//                               platform id the rest of the app keys on, a loc
//                               key for the description, and the spell whose
//                               DataValues fill that description's blanks.
//   lol.stringtable.json  32MB  every localized string in the game, including
//                               the text those loc keys point at.
//
// 44MB per patch branch is not something to make users download to read a
// tooltip; distilled to id -> text it is about 35KB, so it ships in the bundle
// instead. The tradeoff is that the text is current as of the last time this
// ran rather than per-patch — acceptable for prose, which is why augment NAMES,
// rarities and icons still come from the per-patch fetch in dragon.ts, where
// being wrong about a reworked augment would misreport what was played.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "main", "augment-descriptions.json");
const ICONS_OUT = path.join(ROOT, "src", "renderer", "texticons.json");
const CDRAGON = "https://raw.communitydragon.org";

// A branch only ships the augments in its own rotation, so "latest" alone
// leaves out everything Riot has since cycled or retired — 32 of 170 when this
// was written, Self Destruct and The Brutalizer among them. Walking back picks
// them up, the same way resolveAugmentIcon() digs their art out of the
// branches where they shipped. One patch back recovered 30 of those 32; the cap
// is what stops a permanently-absent augment from pulling down a year of 12MB
// manifests.
const MAX_BRANCH_LOOKBACK = 12;

const kiwiBinUrl = (branch) => `${CDRAGON}/${branch}/game/maps/modespecificdata/kiwi.bin.json`;

async function fetchJson(url, label) {
  process.stdout.write(`  ${label} … `);
  const res = await fetch(url, { headers: { "User-Agent": "MayhemTracker-build/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  console.log(`${(text.length / 1e6).toFixed(1)}MB`);
  return JSON.parse(text);
}

// Numeric patch branches, newest first — "latest" and "pbe" are handled
// separately and the rest are per-locale mirrors.
async function archivedBranches() {
  const listing = await fetchJson(`${CDRAGON}/json/`, "branch listing");
  return (Array.isArray(listing) ? listing : [])
    .map((entry) => String(entry?.name ?? ""))
    .filter((name) => /^\d+\.\d+$/.test(name))
    .sort((a, b) => {
      const [aMajor, aMinor] = a.split(".").map(Number);
      const [bMajor, bMinor] = b.split(".").map(Number);
      return bMajor - aMajor || bMinor - aMinor;
    });
}

// AugmentData entries are scattered through the bin rather than held in one
// list, so collect them wherever they appear.
function collectAugments(bin) {
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (!Array.isArray(node) && node.__type === "AugmentData") found.push(node);
    for (const key of Object.keys(node)) walk(node[key]);
  };
  walk(bin);
  return found;
}

// A formula that is one constant is a plain number, so it stays one: the loc
// string may still scale it ("@Calc*100@%") and the percent flag still applies.
function constantCalculation(calc) {
  const parts = calc?.mFormulaParts;
  if (!Array.isArray(parts) || parts.length !== 1) return undefined;
  const part = parts[0];
  return part?.__type === "NumberCalculationPart" ? part.mNumber : undefined;
}

// Anything else is a formula the game prints as a sum — Warlock Juicebox's
// omnivamp shows in-client as "(10% + 3.5%<ap icon>)", a flat share plus a
// scaling one. Dropping those left 9 augments saying "Gain  Omnivamp."
//
// The stat a StatByX part reads is named by number, and the export doesn't
// carry the enum. These five were read off the data instead: across every spell
// in kiwi.bin the ratio DataValues paired with each number are overwhelmingly
// named for one stat (mStat 2 takes ADRatio/BonusADRatio/ADPercent, 12 takes
// HealthScalar/MaxHealthShield/ShieldRatioBHealth), and an absent mStat is the
// Ability Power default (APRatio, ShieldRatioAP, SlowPer100AP). The numbers
// outside this set appear a handful of times each against names too generic to
// call — "ConversionRate" — so a part naming one is left unrendered rather than
// guessed at. A tooltip missing a term is recoverable; one confidently citing
// the wrong stat is not.
const STAT_MARKER = {
  0: "%i:scaleAP%",
  1: "%i:scaleArmor%",
  2: "%i:scaleAD%",
  4: "%i:scaleAS%",
  6: "%i:scaleMR%",
  8: "%i:scaleCrit%",
  11: "%i:scaleAH%",
  12: "%i:scaleHealth%",
};

// mStatFormula picks which slice of the stat is read, and 2 is the bonus: it is
// where every BonusADRatio, BADRatio, ShieldRatioBHealth and Heal_bHPRatio in
// the export sits, against an absent field for the plain totals. Worth saying
// out loud — Twin Fire scales off bonus AD but total AP, and a reader has no
// way to tell those apart from the number alone.
const BONUS_STAT_FORMULA = 2;

// Crit chance is itself a percentage, so a ratio against it does not mean
// "% per 100 points" the way one against AD or Health does — Twin Fire's 3 is
// three extra missiles at 100% crit, which as a flat percentage would print an
// absurd "300%". Stated the way the game says it: one per 33.33%.
const PERCENTAGE_STATS = new Set([8]);

// A stat ratio is per point of the stat, so x100 states it per 100 of it — and
// a percent-display calculation needs the usual second x100 on top, which is
// what turns Juicebox's 0.00035 omnivamp-per-AP into the 3.5% the game shows.
function statTerm(ratio, percent, part, marker) {
  const qualifier = part.mStatFormula === BONUS_STAT_FORMULA ? " bonus" : "";
  if (PERCENTAGE_STATS.has(part.mStat ?? 0)) {
    if (!ratio) return undefined;
    return `1 per ${formatNumber(100 / ratio)}%${qualifier}${marker}`;
  }
  return `${formatNumber(ratio * 100 * (percent ? 100 : 1))}%${qualifier}${marker}`;
}

// Scaling off the champion's resource rather than a stat — Juiced spends a
// share of max Mana and deals damage for a share of it. The part that names its
// data value survives the export only as a hash, and so does the field holding
// that name, which is why the value is fished out as the part's one other
// string rather than read off a known key.
const RESOURCE_BY_DATA_VALUE = binHash("AbilityResourceByNamedDataValueCalculationPart");
const RESOURCE_MARKER = "%i:scaleMana%";

function dataValueName(part) {
  if (typeof part.mDataValue === "string") return part.mDataValue;
  for (const [key, value] of Object.entries(part)) {
    if (key !== "__type" && typeof value === "string") return value;
  }
  return undefined;
}

function renderCalculation(calc, values) {
  const percent = calc?.mDisplayAsPercent === true;
  const scalar = (value) => (percent ? `${formatNumber(value * 100)}%` : formatNumber(value));
  const named = (part) => values.get(String(dataValueName(part)).toLowerCase())?.value;
  const terms = [];

  for (const part of calc?.mFormulaParts ?? []) {
    const marker = STAT_MARKER[part.mStat ?? 0];
    if (part.__type === RESOURCE_BY_DATA_VALUE) {
      const value = named(part);
      if (typeof value !== "number") return undefined;
      const resourceTerm = statTerm(value, percent, part, RESOURCE_MARKER);
      if (!resourceTerm) return undefined;
      terms.push(resourceTerm);
      continue;
    }
    switch (part.__type) {
      case "AbilityResourceByCoefficientCalculationPart": {
        if (typeof part.mCoefficient !== "number") return undefined;
        const term = statTerm(part.mCoefficient, percent, part, RESOURCE_MARKER);
        if (!term) return undefined;
        terms.push(term);
        break;
      }
      case "NumberCalculationPart":
        terms.push(scalar(part.mNumber));
        break;
      case "NamedDataValueCalculationPart": {
        const value = named(part);
        if (typeof value !== "number") return undefined;
        terms.push(scalar(value));
        break;
      }
      // Level scaling has no one number, so the game shows the span it covers.
      case "ByCharLevelInterpolationCalculationPart":
        terms.push(`${scalar(part.mStartValue)} - ${scalar(part.mEndValue)}`);
        break;
      // The same span, stated as steps: a level 1 value with a bonus added at
      // each breakpoint, so the top of the range is all of them applied.
      case "ByCharLevelBreakpointsCalculationPart": {
        const first = part.mLevel1Value ?? 0;
        const last = (part.mBreakpoints ?? []).reduce(
          (total, breakpoint) => total + (breakpoint?.mAdditionalBonusAtThisLevel ?? 0),
          first,
        );
        terms.push(first === last ? scalar(first) : `${scalar(first)} - ${scalar(last)}`);
        break;
      }
      case "StatByNamedDataValueCalculationPart": {
        const value = named(part);
        if (typeof value !== "number" || !marker) return undefined;
        const term = statTerm(value, percent, part, marker);
        if (!term) return undefined;
        terms.push(term);
        break;
      }
      case "StatByCoefficientCalculationPart": {
        if (typeof part.mCoefficient !== "number" || !marker) return undefined;
        const term = statTerm(part.mCoefficient, percent, part, marker);
        if (!term) return undefined;
        terms.push(term);
        break;
      }
      // Breakpoints, ability-resource scaling and the part types that survive
      // the export only as a hash. One unreadable term makes the whole sum
      // wrong, so the formula is abandoned rather than partly printed.
      default:
        return undefined;
    }
  }
  if (terms.length === 0) return undefined;
  return terms.length === 1 ? terms[0] : `(${terms.join(" + ")})`;
}

// Everything an augment's description can refer to, in the order the game
// resolves it: the spell's own data values first, then its calculations, then
// the handful of scalar spell fields that get named directly.
//
// Entries are { value, percent }: a GameCalculation can be flagged
// mDisplayAsPercent, meaning the game prints 0.3 as "30%" and the loc string
// says plain "@SpinDamageAmp@" rather than the usual "@SpinDamageAmp*100@%".
// "QUEST: Score @QuestRequirement@ takedowns" — the target is not in the spell
// at all but in a quest object under ModeSpecificData/ModesQuests, which the
// augment points at through its Quest field. Whether that field and the path
// it holds come through by name or as hashes depends on CommunityDragon's
// known-hashes list at export time (16.19 names both, 16.18 hashed both), so
// either form is accepted; hashing the paths back is what reconnects the
// hashed form, the same trick the hashed calculation names need. The target
// sits in the quest's Milestones.
//
// Only a quest with one milestone has a fixed number to print. Several means it
// levels up — Multishot runs 50, 250, 700, 2000 — and the figure on screen
// climbs with it, so those are left to read generically.
const QUEST_LINK = "{3ed971bd}";
const MILESTONE_TARGET = "{7fec0982}";

const namedField = (node, name) => node?.[name] ?? node?.[binHash(name)];
const questIndexes = new WeakMap();

function questIndex(bin) {
  const cached = questIndexes.get(bin);
  if (cached) return cached;
  const index = new Map();
  for (const objectPath of Object.keys(bin)) {
    if (objectPath.includes("/ModesQuests/")) index.set(binHash(objectPath), bin[objectPath]);
  }
  questIndexes.set(bin, index);
  return index;
}

function put(values, name, entry) {
  if (!values.has(name)) values.set(name, entry);
}

function questMilestone(augment, bin) {
  const link = namedField(augment?.[QUEST_LINK], "Quest");
  if (!link) return undefined;
  const quest = bin[link] ?? questIndex(bin).get(link);
  const targets = (quest?.Milestones ?? []).map((milestone) => milestone?.[MILESTONE_TARGET]);
  if (targets.length !== 1 || typeof targets[0] !== "number") return undefined;
  return targets[0];
}

// An augment bound to one ability has its quest scaled by that ability, so even
// a lone milestone is not the number the player is shown. Naming the ability is
// what gives it away.
const SPELL_NAME_REFERENCE = /\{\{\s*SpellName\s*\}\}/i;

// "Your {{SpellName}} gains 100 Ability Haste" — the game fills that in with
// the name of the ability the augment landed on, which depends on who picked
// it, so there is no one right answer to bake in. The slot is recoverable
// though: an augment aimed at one ability names its data values for it, and
// Bread And Butter's QAbilityHaste is a Q. The second letter has to be a
// capital or every Radius and RecastDelay would read as an R.
const SLOT_DATA_VALUE = /^([QWER])[A-Z]/;

function spellSlot(names) {
  for (const name of names) {
    const slot = String(name).match(SLOT_DATA_VALUE)?.[1];
    if (slot) return slot;
  }
  return "Ability";
}

function valuesFor(augment, bin) {
  const values = new Map();
  const spells = [augment.RootSpell, ...(augment.AdditionalSpells ?? [])]
    .filter(Boolean)
    .map((path) => bin[path]?.mSpell)
    .filter(Boolean);
  const put = (name, entry) => {
    const key = String(name).toLowerCase();
    if (!values.has(key)) values.set(key, entry);
  };

  // Data values first and across every spell: a formula can cite one by name,
  // so they all have to be in hand before any calculation is rendered.
  const dataValueNames = [];
  for (const spell of spells) {
    for (const value of spell.DataValues ?? []) {
      dataValueNames.push(value.name);
      put(value.name, { value: value.values?.[0], percent: false });
    }
    const cooldown = spell.Cooldown ?? spell.cooldownTime;
    if (typeof cooldown === "number") put("cooldown", { value: cooldown, percent: false });
  }
  // Ok Boomerang asks for @Cooldown@ where its spell carries only a
  // BaseCooldown data value; they are the same number by another name.
  if (!values.has("cooldown")) {
    const base = values.get("basecooldown");
    if (base) put("cooldown", base);
  }
  put("spellname", { text: spellSlot(dataValueNames) });

  for (const spell of spells) {
    for (const [name, calc] of Object.entries(spell.mSpellCalculations ?? {})) {
      const constant = constantCalculation(calc);
      if (constant !== undefined) {
        put(name, { value: constant, percent: calc?.mDisplayAsPercent === true });
        continue;
      }
      const text = renderCalculation(calc, values);
      if (text !== undefined) put(name, { text, percent: calc?.mDisplayAsPercent === true });
    }
  }
  return values;
}

// The bin export only keeps a field name when it is in Riot's known-hashes
// list; everything else survives as "{90a024ae}", the FNV-1a 32 of the
// lowercased name. Hashing the name a placeholder asks for recovers the match —
// SpinDamageAmp_Ult on 16.18 is one such calculation.
function binHash(name) {
  let hash = 0x811c9dc5;
  for (const char of name.toLowerCase()) {
    hash = (Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0) >>> 0;
  }
  return `{${hash.toString(16).padStart(8, "0")}}`;
}

function formatNumber(value) {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

// Strings can cite other strings: "{{ Item_Keyword_OnHit }}" stands in for the
// shared "On-Hit" phrasing. What comes back can carry its own placeholders, so
// this has to run before substitution — and can itself cite further strings,
// hence the passes. The cap is a cycle guard, not a depth requirement; two
// levels is the most the game data actually uses.
const REFERENCE = /\{\{\s*([^}\s]+)\s*\}\}/g;
const MAX_REFERENCE_PASSES = 4;

function expandReferences(text, strings) {
  let out = text;
  for (let pass = 0; pass < MAX_REFERENCE_PASSES && REFERENCE.test(out); pass++) {
    REFERENCE.lastIndex = 0;
    out = out.replace(REFERENCE, (whole, key) => strings[key.toLowerCase()] ?? "");
    REFERENCE.lastIndex = 0;
  }
  return out;
}

// "@SlowResist*100@%" — a value name, optionally scaled by a constant, and the
// literal "%" some strings put after it. That sign is only correct when the
// string is doing its own scaling: a percent-display calculation and a rendered
// formula both bring their own, and Jeweled Gauntlet's "@CritGranted@%" would
// otherwise read "(25% + 4.5%)%". Matching it here is what makes it droppable —
// it sits outside the placeholder, so the callback could not reach it.
// The lookahead keeps it from swallowing the "%" that opens an icon marker.
const PLACEHOLDER = /@([A-Za-z_][\w.]*)\s*(?:([*/])\s*([\d.]+))?@(%(?!i:))?/g;

function substitute(text, values) {
  let unresolved = 0;
  const filled = text.replace(PLACEHOLDER, (whole, name, operator, operand, sign) => {
    const percentSign = sign ?? "";
    const entry = values.get(name.toLowerCase()) ?? values.get(binHash(name));
    // A rendered formula is already formatted, percent signs and all, so the
    // only thing that could still be applied to it is a scaling operator — and
    // no loc string pairs one with a formula. Treat it as unresolved if that
    // ever changes rather than printing "(10% + 3.5%)*100".
    if (entry?.text !== undefined) {
      if (operator) {
        unresolved++;
        return "";
      }
      // A percent-display formula prints its own signs, so the string's would
      // double up (Jeweled Gauntlet's "(25% + 4.5%)%"). One that is not leaves
      // the unit to the string, and Protein Shake still needs its "%".
      return entry.percent ? entry.text : entry.text + percentSign;
    }
    const base = entry?.value;
    if (typeof base !== "number") {
      unresolved++;
      // Riot's own item descriptions ship with the number simply missing when
      // it can't be resolved ("restore Health per second"), so match that
      // rather than leaving @Placeholder@ on screen — and take the sign that
      // belonged to it, which would otherwise be left stranded mid-sentence.
      return "";
    }
    // An explicit operator means the string is doing the scaling itself, so its
    // own sign is the correct one and the percent flag does not apply.
    if (operator === "*") return formatNumber(base * Number(operand)) + percentSign;
    if (operator === "/") return formatNumber(base / Number(operand)) + percentSign;
    return entry.percent ? `${formatNumber(base * 100)}%` : formatNumber(base) + percentSign;
  });
  // A dropped placeholder leaves the spaces that surrounded it behind, and the
  // punctuation that followed it stranded after one of them. "%i:scaleAH%" is
  // an icon marker rather than a percent sign trailing a number, so the space
  // in front of that one is Riot's own and has to survive.
  const tidied = filled
    .replace(/ {2,}/g, " ")
    .replace(/ ([.,])/g, "$1")
    .replace(/ %(?!i:)/g, "%");
  return { text: tidied, unresolved };
}

// Riot's wording leaves the pool implicit where the data does not: Mind to
// Matter reads "half of your Mana" and Juiced "consume 2.5% Mana", and both are
// shares of the maximum — the spell scales off an AbilityResource part, which
// is the pool. Saying "max Mana" only where such a part exists keeps this off
// the augments that mean something else by the word, and the qualifiers guard
// the two clauses where the pool is not what is meant at all: Ocean Soul's
// "Mana regen" and Overflow's "Mana costs" (whose second sentence already says
// "max Mana", so the test for one spares it too).
const MANA_SPAN = /(<scaleMana>)([^<]*)(<\/scaleMana>)(\s*(?:regen|costs?)\b)?/gi;
const RESOURCE_PART = /^AbilityResource/;

function scalesOffResourcePool(spells) {
  for (const spell of spells) {
    for (const calc of Object.values(spell.mSpellCalculations ?? {})) {
      for (const part of calc?.mFormulaParts ?? []) {
        if (RESOURCE_PART.test(part.__type) || part.__type === RESOURCE_BY_DATA_VALUE) return true;
      }
    }
  }
  return false;
}

function nameTheManaPool(text) {
  return text.replace(MANA_SPAN, (whole, open, inner, close, qualifier) => {
    if (qualifier || /\bmax\b/i.test(inner)) return whole;
    return `${open}${inner.replace(/\bMana\b/, "max Mana")}${close}`;
  });
}

// Several strings end with the <br><br> that separated them from a section the
// export doesn't carry, which would render as empty space under the tooltip.
const EDGE_BREAKS = /^(?:<br\s*\/?>|\s)+|(?:<br\s*\/?>|\s)+$/gi;

function trimBreaks(text) {
  return text.replace(EDGE_BREAKS, "");
}

// Inline icons
//
// "%i:scaleAH%" asks the game's text renderer to draw a stat glyph mid-sentence.
// Riot keeps them as one 20x20 PNG per name under texticons/, addressed by the
// marker name lowercased, so the marker resolves to a file without a mapping
// table — only the category folder has to be searched for.
//
// They are a few hundred bytes each and the whole set the augments use is about
// 6KB, so they are inlined as data URIs and bundled rather than fetched: an
// icon sitting inside a sentence has nothing sensible to show while a request
// is in flight. Only the markers the descriptions actually use are downloaded;
// a marker Riot introduces next patch renders as nothing until this runs again,
// the same way RiotText already drops tags it doesn't know.
const TEXTICONS = `${CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/fonts/texticons/lol`;
const ICON_CATEGORIES = ["statsicon", "gameplay", "champion", "challenges", "ranks"];
const ICON_MARKER = /%i:([A-Za-z0-9_]+)%/g;

async function listIconCategory(category) {
  try {
    const listing = await fetchJson(
      `${CDRAGON}/json/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/fonts/texticons/lol/${category}/`,
      `texticons/${category}`,
    );
    return (Array.isArray(listing) ? listing : [])
      .map((entry) => String(entry?.name ?? ""))
      .filter((name) => name.endsWith(".png"));
  } catch {
    return [];
  }
}

async function fetchIcons(descriptions) {
  const wanted = new Set();
  for (const text of Object.values(descriptions)) {
    for (const [, name] of text.matchAll(ICON_MARKER)) wanted.add(name.toLowerCase());
  }
  if (wanted.size === 0) return {};

  // One listing per category beats probing every name against every folder.
  const where = new Map();
  for (const category of ICON_CATEGORIES) {
    for (const file of await listIconCategory(category)) {
      const name = file.slice(0, -4).toLowerCase();
      if (!where.has(name)) where.set(name, `${category}/${file}`);
    }
  }

  const icons = {};
  const missing = [];
  for (const name of [...wanted].sort()) {
    const at = where.get(name);
    if (!at) {
      missing.push(name);
      continue;
    }
    const res = await fetch(`${TEXTICONS}/${at}`, {
      headers: { "User-Agent": "MayhemTracker-build/1.0" },
    });
    if (!res.ok) {
      missing.push(name);
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    icons[name] = `data:image/png;base64,${bytes.toString("base64")}`;
  }
  console.log(`\n  inline icons:          ${Object.keys(icons).length}/${wanted.size} resolved`);
  if (missing.length) console.log(`  no texticon for:       ${missing.join(", ")}`);
  return icons;
}

// Any @Placeholder@ the regex above didn't recognise at all — a name with an
// operator we don't parse, say — would otherwise survive into the UI.
const ANY_PLACEHOLDER = /@[^@]+@/;

async function main() {
  console.log("Generating Mayhem augment descriptions\n");

  // One stringtable serves every branch: Riot keeps retired augments' strings
  // long after their data leaves the export, so the archived branches only have
  // to supply the id -> loc key -> spell mapping, not another 32MB of text.
  const [stringtable, cherry] = await Promise.all([
    fetchJson(
      `${CDRAGON}/latest/game/en_us/data/menu/en_us/lol.stringtable.json`,
      "en_us stringtable",
    ),
    fetchJson(
      `${CDRAGON}/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`,
      "cherry-augments",
    ),
  ]);
  const strings = stringtable.entries ?? {};

  // What the app can actually show: the Mayhem augment ids the live export
  // names. Whether they're all covered decides when the branch walk can stop.
  const wanted = new Set(
    (Array.isArray(cherry) ? cherry : Object.values(cherry ?? {}))
      .filter((aug) => String(aug?.augmentNameId ?? "").startsWith("ARAM_"))
      .map((aug) => Number(aug.id))
      .filter(Number.isFinite),
  );

  const descriptions = {};
  const unresolvedKeys = new Set();
  let partial = 0;
  let patch = "unknown";

  const harvest = (bin, branch) => {
    let added = 0;
    for (const augment of collectAugments(bin)) {
      const id = augment.AugmentPlatformId;
      // An older branch never overrides a newer one — the first branch to name
      // an augment is the most recent one that had it.
      if (!Number.isFinite(id) || id in descriptions) continue;
      const locKey = String(
        augment.DescriptionTra ?? augment.AugmentTooltipTra ?? "",
      ).toLowerCase();
      const raw = strings[locKey];
      if (!raw) {
        if (locKey) unresolvedKeys.add(locKey);
        continue;
      }
      const spells = [augment.RootSpell, ...(augment.AdditionalSpells ?? [])]
        .filter(Boolean)
        .map((path) => bin[path]?.mSpell)
        .filter(Boolean);
      const values = valuesFor(augment, bin);
      if (!SPELL_NAME_REFERENCE.test(raw)) {
        const milestone = questMilestone(augment, bin);
        if (milestone !== undefined) put(values, "questrequirement", { value: milestone });
      }
      const { text, unresolved } = substitute(expandReferences(raw, strings), values);
      const named = scalesOffResourcePool(spells) ? nameTheManaPool(text) : text;
      const cleaned = trimBreaks(named.replace(ANY_PLACEHOLDER, ""));
      if (!cleaned) continue;
      if (unresolved || ANY_PLACEHOLDER.test(text)) partial++;
      descriptions[id] = cleaned;
      added++;
    }
    const remaining = [...wanted].filter((id) => !(id in descriptions)).length;
    console.log(`    ${branch}: +${added} (${remaining} Mayhem augments still uncovered)`);
    return remaining;
  };

  const latest = await fetchJson(kiwiBinUrl("latest"), "kiwi.bin (latest)");
  patch = String(latest.version ?? "").trim() || (await resolveLivePatch());
  let remaining = harvest(latest, "latest");

  if (remaining > 0) {
    // The live patch has its own numbered branch as well, holding what
    // "latest" just supplied.
    const branches = (await archivedBranches())
      .filter((branch) => branch !== patch)
      .slice(0, MAX_BRANCH_LOOKBACK);
    for (const branch of branches) {
      let bin;
      try {
        bin = await fetchJson(kiwiBinUrl(branch), `kiwi.bin (${branch})`);
      } catch {
        // A branch without Mayhem data is not evidence about the augment.
        console.log(`    ${branch}: no kiwi.bin`);
        continue;
      }
      remaining = harvest(bin, branch);
      if (remaining === 0) break;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ patch, descriptions }, null, 2) + "\n");

  const covered = [...wanted].filter((id) => id in descriptions).length;
  console.log(`\n  descriptions written:  ${Object.keys(descriptions).length}`);
  console.log(`  Mayhem augments:       ${covered}/${wanted.size} covered`);
  console.log(`  missing a value:       ${partial}`);
  if (unresolvedKeys.size) console.log(`  loc keys with no text: ${unresolvedKeys.size}`);

  const icons = await fetchIcons(descriptions);
  fs.writeFileSync(ICONS_OUT, JSON.stringify(icons, null, 2) + "\n");

  for (const out of [OUT, ICONS_OUT]) {
    console.log(
      `\nWrote ${path.relative(ROOT, out)} (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`,
    );
  }
}

async function resolveLivePatch() {
  try {
    const versions = await fetchJson(
      "https://ddragon.leagueoflegends.com/api/versions.json",
      "live patch",
    );
    return String(versions[0]).match(/^(\d+\.\d+)/)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
