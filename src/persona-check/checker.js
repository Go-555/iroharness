// Persona-check cheap tier (persona-guard.md §5, Phase B): mechanically check
// candidate responses against parsed vocabulary rules. Pure function, regular
// expressions only, zero LLM calls — safe for CI.

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "sentence-end" terms must be followed by sentence-final or clause-final
// punctuation (読点 included: 「〜いたします、」 is still a です・ます ending)
// or the end of the text; "anywhere" terms match as literal substrings.
// Cheap tier: false positives (e.g. 私 inside 私立) are acceptable and
// visible in the report; the rich tier (Phase C) is the judgment call.
const compile = (term, scope) =>
  scope === "sentence-end"
    ? new RegExp(`${escapeRegExp(term)}(?=[。．.！!？?…、，\\s]|$)`, "u")
    : new RegExp(escapeRegExp(term), "u");

const textOf = (response) => {
  if (typeof response === "string") {
    return response;
  }
  if (response && typeof response.text === "string") {
    return response.text;
  }
  return "";
};

// checkResponses({ rules, responses }) ->
//   { ok, totalRules, checkableRules, responseCount,
//     violations: [{ rule, response, responseIndex, matched }] }
export const checkResponses = ({ rules = [], responses = [] } = {}) => {
  const checkable = rules.filter((rule) => rule.checkable);
  const violations = [];

  responses.forEach((response, responseIndex) => {
    const text = textOf(response);
    for (const rule of checkable) {
      for (const { term } of rule.forbidden) {
        const match = compile(term, rule.scope).exec(text);
        if (match) {
          violations.push(
            Object.freeze({
              rule,
              response: text,
              responseIndex,
              matched: match[0],
            }),
          );
        }
      }
    }
  });

  return Object.freeze({
    ok: violations.length === 0,
    totalRules: rules.length,
    checkableRules: checkable.length,
    responseCount: responses.length,
    violations: Object.freeze(violations),
  });
};
