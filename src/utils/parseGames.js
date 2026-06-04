const platformAliases = [
  ["Xbox Series", /\bXbox\s*(Series|Series X\|S|Series X|Series S|XSX|XSS)\b/i],
  ["Switch 2", /\b(Switch\s*2|Nintendo\s*Switch\s*2)\b/i],
  ["Switch", /\b(Nintendo\s*)?Switch\b/i],
  ["PS5", /\b(PS5|PlayStation\s*5)\b/i],
  ["PS4", /\b(PS4|PlayStation\s*4)\b/i],
  ["PC", /\bPC\b|Steam|Epic|Windows/i],
  ["Mac", /\bMac\b|macOS/i],
  ["iOS", /\biOS\b|iPhone|iPad/i],
  ["Android", /\bAndroid\b/i],
];

const datePatterns = [
  /(?:发售日期|发售日|発売日|上市日期|上线日期|发行日期|日期)\s*[:：]?\s*([^\n，,。；;]+)/i,
  /((?:20\d{2}|19\d{2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/,
  /((?:20\d{2}|19\d{2})[-/.]\d{1,2}[-/.]\d{1,2})/,
  /(\d{1,2}\s*月\s*\d{1,2}\s*[日号])/,
  /(未定|待定|TBA|Coming Soon|即将推出)/i,
];

function normalizeTitle(rawTitle) {
  const title = rawTitle.trim().replace(/^[-*#\d.\s、]+/, "").trim();
  if (!title) return "";
  if (/^《.+》$/.test(title)) return title;
  return `《${title.replace(/[《》]/g, "")}》`;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractTitle(block, fallbackIndex) {
  const bracketTitle = block.match(/《([^》]{1,80})》/);
  if (bracketTitle) return `《${bracketTitle[1].trim()}》`;

  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstUsefulLine = lines.find(
    (line) => !/^(发售|发行|上市|上线|登陆|登录|平台|价格|预购|售价|备注|信息|日期)\s*[:：]/.test(line),
  );
  return normalizeTitle(firstUsefulLine || `新公布游戏 ${fallbackIndex}`);
}

function extractDate(block) {
  for (const pattern of datePatterns) {
    const match = block.match(pattern);
    if (match) return (match[1] || match[0]).trim();
  }
  return "待公布";
}

function extractPlatforms(block) {
  const found = [];
  for (const [label, pattern] of platformAliases) {
    if (pattern.test(block)) found.push(label);
  }
  return unique(found.length ? found : ["待公布"]);
}

function stripKnownLines(block) {
  return block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^[-*#\d.\s、]*《[^》]+》$/.test(line))
    .filter((line) => !/^(游戏名|标题|名称|发售日期|发售日|日期|登陆平台|登录平台|平台)\s*[:：]/.test(line))
    .join("，")
    .replace(/《[^》]+》/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitBlocks(input) {
  const text = input.replace(/\r/g, "").trim();
  if (!text) return [];

  const titleMatches = [...text.matchAll(/《[^》]{1,80}》/g)];
  if (titleMatches.length > 1) {
    return titleMatches.map((match, index) => {
      const start = match.index;
      const end = titleMatches[index + 1]?.index ?? text.length;
      return text.slice(start, end).trim();
    });
  }

  return text
    .split(/\n\s*\n+|(?:^|\n)\s*(?:-{3,}|={3,})\s*(?=\n|$)/)
    .map((block) => block.trim())
    .filter(Boolean);
}

export function parseGamesFromText(input) {
  return splitBlocks(input).map((block, index) => {
    const title = extractTitle(block, index + 1);
    const date = extractDate(block);
    const platforms = extractPlatforms(block);
    const info = stripKnownLines(block) || "在这里补充预购、价格、试玩、发售窗口或其他关键信息。";

    return {
      title,
      date,
      platforms,
      info,
      image: "",
    };
  });
}
