const DEFAULT_SPLIT = ["。", "？", "！", ". ", "?", "!", "\n"];
const DEFAULT_OPTION_SPLIT = ["、", ", "];

export const createSentenceSplitter = ({
  splitChars = DEFAULT_SPLIT,
  optionSplitChars = DEFAULT_OPTION_SPLIT,
  optionSplitThreshold = 50,
} = {}) => {
  let buffer = "";
  const tryCut = () => {
    const sentences = [];
    let cursor = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const hit = splitChars.find((c) => buffer.startsWith(c, i));
      if (hit) {
        sentences.push(buffer.slice(cursor, i + hit.length));
        i += hit.length - 1;
        cursor = i + 1;
      }
    }
    buffer = buffer.slice(cursor);
    if (buffer.length > optionSplitThreshold) {
      const last = Math.max(
        ...optionSplitChars.map((c) => {
          const idx = buffer.lastIndexOf(c);
          return idx < 0 ? 0 : idx + c.length;
        }),
      );
      if (last > 0) {
        sentences.push(buffer.slice(0, last));
        buffer = buffer.slice(last);
      }
    }
    return sentences;
  };
  return Object.freeze({
    push(delta) {
      buffer += String(delta || "");
      return tryCut();
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return rest ? [rest] : [];
    },
  });
};
