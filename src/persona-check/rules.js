// Persona-check cheap tier (persona-guard.md §5, Phase B): parse the
// `## Vocabulary Rules` section of SOUL.md (persona-guard.md §4a) into rule
// objects that the mechanical checker can compile into string/regex checks.
// No LLM calls anywhere in this module.

const SECTION_HEADING = /^#{2,6}\s+vocabulary rules\s*$/i;
const ANY_HEADING = /^#{1,6}\s+\S/;
const BULLET = /^[-*]\s+(.*)$/;

const KIND_BY_LABEL = [
  [/^first[\s-]?person/i, "first-person"],
  [/^second[\s-]?person/i, "second-person"],
  [/^sentence[\s-]?endings?/i, "sentence-ending"],
  [/^forbidden/i, "forbidden"],
];

const kindOf = (label) => {
  for (const [pattern, kind] of KIND_BY_LABEL) {
    if (pattern.test(label)) {
      return kind;
    }
  }
  return "custom";
};

// Split a never-list such as "私 / 僕", "です・ます", or "拝承, 承知いたしました"
// into literal terms.
const splitTerms = (text) =>
  text
    .split(/[/、,・，]/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);

// Extract forbidden terms from a bullet value. Two shapes are recognized:
// a parenthetical "(never 私 / 僕)" and a trailing clause "; never です・ます".
const extractNeverClauses = (value) => {
  const forbidden = [];
  let remainder = value;

  remainder = remainder.replace(
    /[（(]\s*never\s+([^）)]+)[）)]/gi,
    (_match, terms) => {
      forbidden.push(...splitTerms(terms));
      return " ";
    },
  );
  remainder = remainder.replace(
    /(?:^|[;；]\s*)never\s+(.+)$/i,
    (_match, terms) => {
      forbidden.push(...splitTerms(terms));
      return " ";
    },
  );

  return { forbidden, remainder: remainder.replace(/\s+/g, " ").trim() };
};

const sectionLines = (soulText) => {
  const lines = soulText.split(/\r?\n/);
  const start = lines.findIndex((line) => SECTION_HEADING.test(line.trim()));
  if (start === -1) {
    return null;
  }
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (ANY_HEADING.test(lines[index])) {
      break;
    }
    body.push(lines[index]);
  }
  return body;
};

// parseVocabularyRules(soulText) -> { sectionFound, rules, skipped }
//
// Each rule: { id, kind, label, raw, mustUse, forbidden: [{ term }],
//              scope: "anywhere" | "sentence-end", checkable }
// A rule is mechanically checkable when it carries at least one forbidden
// term; must-use values are recorded but only enforced through their
// never-list (a bare must-use has no precise mechanical test).
export const parseVocabularyRules = (soulText) => {
  if (!soulText || typeof soulText !== "string") {
    return { sectionFound: false, rules: [], skipped: [] };
  }
  const body = sectionLines(soulText);
  if (body === null) {
    return { sectionFound: false, rules: [], skipped: [] };
  }

  const rules = [];
  const skipped = [];
  for (const line of body) {
    const bullet = line.trim().match(BULLET);
    if (!bullet) {
      continue; // prose and blank lines inside the section are fine
    }
    const raw = bullet[1].trim();
    const separator = raw.search(/[:：]/);
    if (separator === -1) {
      skipped.push({
        raw,
        reason: "no label separator (expected `Label: value`)",
      });
      continue;
    }
    const label = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    const kind = kindOf(label);
    const isForbiddenList = kind === "forbidden";
    const { forbidden, remainder } = isForbiddenList
      ? { forbidden: splitTerms(value), remainder: "" }
      : extractNeverClauses(value);

    rules.push(
      Object.freeze({
        id: `${kind}-${rules.length + 1}`,
        kind,
        label,
        raw,
        mustUse: isForbiddenList ? null : remainder || null,
        forbidden: Object.freeze(
          forbidden.map((term) => Object.freeze({ term })),
        ),
        scope: kind === "sentence-ending" ? "sentence-end" : "anywhere",
        checkable: forbidden.length > 0,
      }),
    );
  }

  return { sectionFound: true, rules, skipped };
};
