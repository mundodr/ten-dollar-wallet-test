const words = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function toNumber(token) {
  return /^\d+$/.test(token) ? Number(token) : words[token.toLowerCase()];
}

export function solveAgentHansaChallenge(question) {
  const numberPattern = `(?:\\d+|${Object.keys(words).join("|")})`;
  const relation = question.match(
    new RegExp(
      `\\bhas\\s+(${numberPattern})\\b[\\s\\S]*?\\bhas\\s+(${numberPattern})\\s+(more|fewer|less)\\s+than\\b`,
      "i",
    ),
  );
  if (relation) {
    const base = toNumber(relation[1]);
    const delta = toNumber(relation[2]);
    return relation[3].toLowerCase() === "more" ? base + delta : base - delta;
  }

  const tokens = question.match(/\d+|[a-z]+/gi) ?? [];
  const lower = tokens.map((token) => token.toLowerCase());
  const values = tokens.map(toNumber).filter(Number.isFinite);
  if (lower.includes("minus") && values.length >= 2) {
    return values[0] - values[1];
  }
  if (lower.includes("plus") && values.length >= 2) {
    return values[0] + values[1];
  }
  const eachIndex = lower.indexOf("each");
  if (eachIndex > 0 && values.length >= 2) {
    return values[0] * values[1];
  }
  const hasIndex = tokens.findIndex((token) => token.toLowerCase() === "has");
  let value = hasIndex >= 0 ? toNumber(tokens[hasIndex + 1]) : undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`Unsupported Agent Hansa check-in challenge: ${question}`);
  }
  if (/gives?\s+away\s+half/i.test(question)) return value / 2;
  if (/\bdoubles?\b/i.test(question)) return value * 2;
  if (/\btriples?\b/i.test(question)) return value * 3;

  for (let index = hasIndex + 2; index < lower.length - 1; index += 1) {
    const operation = lower[index];
    const amount = toNumber(tokens[index + 1]);
    if (!Number.isFinite(amount)) continue;
    if (["gains", "gets", "receives", "finds", "buys", "adds"].includes(operation)) {
      value += amount;
      index += 1;
    } else if (["loses", "spends", "eats", "drops", "removes"].includes(operation)) {
      value -= amount;
      index += 1;
    }
  }
  return value;
}
