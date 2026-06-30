const defaultThemes = {
  stateOfPlay: {
    id: "stateOfPlay",
    label: "State of Play",
    logo: "PS",
    fontFamily: "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
    bg:
      "radial-gradient(circle at 22% 14%, rgba(16, 132, 255, .35), transparent 24%)," +
      "radial-gradient(circle at 82% 8%, rgba(27, 89, 255, .35), transparent 30%)," +
      "linear-gradient(145deg, #020a1d 0%, #041b43 46%, #031027 100%)",
    panel: "rgba(2, 18, 48, .75)",
    card: "linear-gradient(90deg, rgba(2, 27, 63, .92), rgba(2, 14, 37, .78))",
    line: "#18a7ff",
    glow: "rgba(0, 153, 255, .72)",
    accent: "#69d7ff",
    chipBg: "#1267e8",
    chipText: "#ffffff",
    titleShadow: "0 5px 0 rgba(0, 34, 89, .85), 0 0 24px rgba(76, 170, 255, .5)",
    decor: "symbols",
    cardTitle: "#ffffff",
    cardText: "#ffffff",
  },
  summerGameFest: {
    id: "summerGameFest",
    label: "Summer Game Fest",
    logo: "SGF",
    fontFamily: "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
    bg:
      "radial-gradient(circle at 58% 13%, rgba(255, 72, 160, .72), transparent 23%)," +
      "radial-gradient(circle at 21% 18%, rgba(33, 127, 255, .76), transparent 28%)," +
      "radial-gradient(circle at 80% 34%, rgba(18, 225, 237, .58), transparent 27%)," +
      "radial-gradient(circle at 43% 64%, rgba(255, 214, 103, .48), transparent 22%)," +
      "radial-gradient(circle at 72% 82%, rgba(188, 72, 255, .62), transparent 31%)," +
      "linear-gradient(145deg, #1736a4 0%, #9145da 38%, #ff78c7 66%, #1dc9e5 100%)",
    panel: "rgba(80, 32, 130, .54)",
    card: "linear-gradient(90deg, rgba(41, 35, 133, .72), rgba(167, 50, 162, .58), rgba(22, 166, 199, .5))",
    line: "#ffffff",
    glow: "rgba(73, 249, 255, .66)",
    accent: "#68fff4",
    chipBg: "#ffffff",
    chipText: "#b12ed5",
    titleShadow: "6px 7px 0 rgba(63, 238, 239, .76), 0 0 34px rgba(255, 255, 255, .48)",
    decor: "bubbles",
    cardTitle: "#ffffff",
    cardText: "#ffffff",
  },
  xbox: {
    id: "xbox",
    label: "Xbox Showcase",
    logo: "XB",
    fontFamily: "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
    bg:
      "radial-gradient(circle at 80% 7%, rgba(87, 255, 102, .3), transparent 28%)," +
      "linear-gradient(135deg, #020604 0%, #06160d 44%, #0d2414 100%)",
    panel: "rgba(2, 22, 10, .8)",
    card: "linear-gradient(90deg, rgba(5, 42, 19, .9), rgba(4, 19, 12, .78))",
    line: "#65e36f",
    glow: "rgba(67, 255, 91, .62)",
    accent: "#b6ffc0",
    chipBg: "#39d353",
    chipText: "#05130a",
    titleShadow: "0 5px 0 rgba(6, 54, 16, .85), 0 0 24px rgba(78, 255, 101, .42)",
    decor: "none",
    cardTitle: "#ffffff",
    cardText: "#ffffff",
  },
  nintendoDirect: {
    id: "nintendoDirect",
    label: "Nintendo Direct",
    logo: "ND",
    fontFamily: "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
    bg: "#e60012",
    panel: "rgba(92, 0, 9, .9)",
    card: "linear-gradient(100deg, rgba(91, 0, 9, .94), rgba(52, 0, 6, .92))",
    line: "#f4dedf",
    glow: "rgba(255, 255, 255, .18)",
    accent: "#ffffff",
    chipBg: "#e60012",
    chipText: "#ffffff",
    titleShadow: "0 5px 0 rgba(91, 0, 8, .62), 0 0 18px rgba(255, 255, 255, .2)",
    decor: "none",
    cardTitle: "#ffffff",
    cardText: "#ffffff",
  },
  nintendoDirectWarm: {
    id: "nintendoDirectWarm",
    label: "Nintendo Direct 暖白卡片",
    logo: "ND",
    fontFamily: "'Noto Sans SC', 'Microsoft YaHei', Arial, sans-serif",
    bg: "#e60012",
    panel: "rgba(92, 0, 9, .9)",
    card: "linear-gradient(100deg, #f3efed, #e8e1df)",
    line: "#8f000b",
    glow: "rgba(91, 0, 9, .22)",
    accent: "#e60012",
    chipBg: "#e60012",
    chipText: "#ffffff",
    titleShadow: "0 5px 0 rgba(91, 0, 8, .62), 0 0 18px rgba(255, 255, 255, .2)",
    decor: "none",
    cardTitle: "#181516",
    cardText: "#332d2e",
  },
};

export let themes = { ...defaultThemes };

const customThemesKey = "gameshow-pic-custom-themes-v1";
try {
  const saved = localStorage.getItem(customThemesKey);
  if (saved) {
    const customThemes = JSON.parse(saved);
    themes = { ...defaultThemes, ...customThemes };
  }
} catch {}

export function addCustomTheme(theme) {
  themes = { ...themes, [theme.id]: theme };
  saveCustomThemes();
}

export function removeCustomTheme(id) {
  const newThemes = { ...themes };
  delete newThemes[id];
  themes = newThemes;
  saveCustomThemes();
}

function saveCustomThemes() {
  const customThemes = Object.keys(themes)
    .filter((id) => id.startsWith("custom_"))
    .reduce((acc, id) => {
      acc[id] = themes[id];
      return acc;
    }, {});
  try {
    localStorage.setItem(customThemesKey, JSON.stringify(customThemes));
  } catch {}
}
