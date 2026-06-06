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
  /(?:发售日期|发售日|发布日期|上市日期|上线日期|发行日期|日期)\s*[:：]?\s*([^\n，。；;]+)/i,
  /((?:20\d{2}|19\d{2})\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?)/,
  /((?:20\d{2}|19\d{2})[-/.]\d{1,2}[-/.]\d{1,2})/,
  /(\d{1,2}\s*月\s*\d{1,2}\s*[日号])/,
  /(未定|待定|TBA|Coming Soon|即将推出)/i,
];

const labelMap = {
  游戏名称: "title",
  游戏名: "title",
  名称: "title",
  标题: "title",
  发售日期: "date",
  发售日: "date",
  发布日期: "date",
  登陆平台: "platforms",
  登录平台: "platforms",
  平台: "platforms",
  关键信息: "info",
  信息: "info",
  备注: "info",
};

function cleanTitle(rawTitle) {
  return rawTitle.trim().replace(/^[-*#\d.\s、]+/, "").trim();
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizePlatforms(rawPlatforms) {
  const explicit = rawPlatforms
    .split(/[,，、/|；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (explicit.length) return unique(explicit);
  return extractPlatforms(rawPlatforms);
}

function extractTitle(block, fallbackIndex) {
  const bracketTitle = block.match(/《([^》]{1,80})》/);
  if (bracketTitle) return bracketTitle[1].trim();

  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const firstUsefulLine = lines.find(
    (line) => !/^(游戏名称|游戏名|标题|名称|发售|发行|上市|上线|登陆|登录|平台|价格|预购|售价|备注|信息|日期)\s*[:：]/.test(line),
  );
  return cleanTitle(firstUsefulLine || `新公布游戏${fallbackIndex}`);
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
    .filter((line) => !/^[-*#\d.\s、]*《[^》]+》/.test(line))
    .filter((line) => !/^(游戏名称|游戏名|标题|名称|发售日期|发售日|发布日期|日期|登陆平台|登录平台|平台)\s*[:：]/.test(line))
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

function normalizeLabeledGame(game, fallbackIndex) {
  return {
    title: cleanTitle(game.title || `新公布游戏${fallbackIndex}`),
    date: game.date?.trim() || "待公布",
    platforms: normalizePlatforms(game.platforms || "待公布"),
    info: game.info?.trim() || "在这里补充预购、价格、试玩、发售窗口或其他关键信息。",
    image: "",
  };
}

function parseLabeledGames(input) {
  const lines = input
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const labeledLineCount = lines.filter((line) => {
    const labelMatch = line.match(/^([^:：]{1,12})\s*[:：]/);
    return labelMatch && labelMap[labelMatch[1].trim()];
  }).length;
  if (labeledLineCount < 2) return [];

  const games = [];
  let current = {};
  let currentField = "";

  for (const line of lines) {
    const labelMatch = line.match(/^([^:：]{1,12})\s*[:：]\s*(.*)$/);
    if (labelMatch) {
      const field = labelMap[labelMatch[1].trim()];
      if (field) {
        if (field === "title" && Object.keys(current).length) {
          games.push(current);
          current = {};
        }
        current[field] = labelMatch[2].trim();
        currentField = field;
        continue;
      }
    }

    if (currentField) {
      current[currentField] = [current[currentField], line].filter(Boolean).join(currentField === "info" ? " " : " ");
    } else if (!current.title) {
      current.title = line;
    } else {
      current.info = [current.info, line].filter(Boolean).join(" ");
    }
  }

  if (Object.keys(current).length) games.push(current);

  return games
    .filter((game) => game.title || game.date || game.platforms || game.info)
    .map((game, index) => normalizeLabeledGame(game, index + 1));
}

export function parseGamesFromText(input) {
  const labeledGames = parseLabeledGames(input);
  if (labeledGames.length) return labeledGames;

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
