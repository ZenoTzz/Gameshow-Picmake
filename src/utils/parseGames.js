const platformAliases = [
  ["XBOX Series", /\b(?:Xbox\s*Series(?:\s*[XS](?:\s*\|\s*S)?)?|XSX|XSS)\b/i],
  ["Switch 2", /\b(?:Nintendo\s*)?Switch\s*2\b/i],
  ["Switch", /\b(?:Nintendo\s*)?Switch\b(?!\s*2\b)/i],
  ["PS5", /\b(?:PS5|PlayStation\s*5)\b/i],
  ["PS4", /\b(?:PS4|PlayStation\s*4)\b/i],
  ["PC", /\b(?:PC|Steam|Epic|Windows)\b/i],
  ["Mac", /\b(?:Mac|macOS)\b/i],
  ["移动端", /移动端|手游|\bMobile\b/i],
  ["iOS", /\biOS\b|iPhone|iPad/i],
  ["Android", /\bAndroid\b/i],
];
const labels = {
  游戏名称: "title", 游戏名: "title", 名称: "title", 标题: "title",
  发售日期: "date", 发售日: "date", 发布日期: "date", 上市日期: "date",
  上线日期: "date", 发行日期: "date", 日期: "date",
  登陆平台: "platforms", 登录平台: "platforms", 平台: "platforms",
  关键信息: "info", 信息: "info", 备注: "info",
};
const fallbackInfo = "在这里补充预购、价格、试玩、发售窗口或其他关键信息。";
const unique = (items) => [...new Set(items)];

function cleanTitle(title) {
  // Only remove actual list markers; titles such as “007” and “1945” are valid.
  return title.replace(/^(?:#{1,6}\s+|[-*]\s+|\d+[.、]\s*)/, "")
    .replace(/^《([^》]+)》$/, "$1").trim();
}

function fieldFor(line) {
  const match = line.match(/^([^:：]{1,12})\s*[:：]\s*(.*)$/);
  return match && labels[match[1].trim()] ? [labels[match[1].trim()], match[2].trim()] : null;
}

function splitBlocks(text) {
  const blocks = [];
  let current = [];
  const flush = () => { if (current.length) blocks.push(current); current = []; };
  const lines = text.split("\n");
  const hasTitles = lines.some((line) => /^《[^》]+》$/.test(cleanTitleMarker(line.trim())) || fieldFor(line.trim())?.[0] === "title");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { if (!hasTitles) flush(); continue; }
    if (/^(?:-{3,}|={3,})$/.test(line)) { flush(); continue; }
    const titleLine = /^《[^》]+》$/.test(cleanTitleMarker(line));
    if (current.length && (titleLine || fieldFor(line)?.[0] === "title")) flush();
    current.push(line);
  }
  flush();
  return blocks;
}

function cleanTitleMarker(line) {
  return line.replace(/^(?:#{1,6}\s+|[-*]\s+|\d+[.、]\s*)/, "");
}

function extractPlatforms(text) {
  return platformAliases.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function normalizePlatforms(text) {
  return unique(text.replace(/Series\s*X\s*\|\s*S/gi, "Series X/S")
    .replace(/Series X\/S/gi, "Series")
    .split(/[,，、/|；;]+/).map((part) => part.trim()).filter(Boolean)
    .flatMap((part) => { const known = extractPlatforms(part); return known.length ? known : [part]; }));
}

function extractDate(text) {
  const patterns = [
    /((?:20\d{2}|19\d{2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/,
    /((?:20\d{2}|19\d{2})[-/.]\d{1,2}[-/.]\d{1,2})/,
    /(\d{1,2}\s*月\s*\d{1,2}\s*[日号])/,
    /(未定|待定|TBA|Coming Soon|即将推出)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return "待公布";
}

export function parseGamesFromText(input) {
  if (typeof input !== "string" || !input.trim()) return [];
  return splitBlocks(input.replace(/\r\n?/g, "\n").trim()).map((lines, index) => {
    const game = {};
    const info = [];
    for (const line of lines) {
      const field = fieldFor(line);
      if (field) {
        if (field[0] === "info") info.push(field[1]);
        else game[field[0]] = field[1];
      } else if (!game.title && !Object.keys(game).length && !info.length) {
        game.title = cleanTitle(line);
      } else {
        // Unlabelled prose is descriptive text, never a continuation of platform/date fields.
        info.push(line);
      }
    }
    const text = lines.join("\n");
    const platforms = game.platforms ? normalizePlatforms(game.platforms) : extractPlatforms(text);
    return {
      title: cleanTitle(game.title || `新公布游戏${index + 1}`),
      date: game.date || extractDate(text),
      platforms: platforms.length ? platforms : ["待公布"],
      info: info.filter(Boolean).join(" ") || fallbackInfo,
      image: "",
    };
  });
}
