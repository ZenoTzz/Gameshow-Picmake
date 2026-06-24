import os
import re

with open('src/App.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

utils_start = content.find('const platformOptions =')
app_func_start = content.find('function App() {')
components_start = content.find('function MeasurementLayer(')

imports_block = content[:utils_start]
utils_and_services_block = content[utils_start:app_func_start]
app_func_block = content[app_func_start:components_start]
components_block = content[components_start:].replace('export default App;', '').strip()

os.makedirs('src/utils', exist_ok=True)
os.makedirs('src/components', exist_ok=True)

# Generate coreUtils.js
# We need to make sure we don't blind replace 'const ' if it's inside a function.
# Luckily, the utils block is mostly top-level functions and consts.
lines = utils_and_services_block.split('\n')
export_lines = []
for line in lines:
    if line.startswith('const ') or line.startswith('function ') or line.startswith('async function '):
        if not line.startswith('export '):
            line = 'export ' + line
    export_lines.append(line)

core_utils_content = """import { blankGame, initialPoster } from "../data/sampleData";
import { themes } from "../data/themes";

""" + '\n'.join(export_lines)

with open('src/utils/coreUtils.js', 'w', encoding='utf-8') as f:
    f.write(core_utils_content)


# Generate PosterComponents.jsx
poster_components_content = """import React, { useRef, useState } from "react";
import { CalendarDays, Gamepad2, Info, ImagePlus } from "lucide-react";
import * as Core from "../utils/coreUtils";
import { themes } from "../data/themes";

const { getPlatformColor, resolveLogoSrc, getThemeText, getPosterFonts, defaultLogoPosition, defaultInfoFontWeight } = Core;

""" + components_block + """
export { MeasurementLayer, PosterPage, BrandMark, PosterDecor, GameCard, InfoRow };
"""
with open('src/components/PosterComponents.jsx', 'w', encoding='utf-8') as f:
    f.write(poster_components_content)


# Generate App.jsx
app_imports = imports_block + """
import * as Core from "./utils/coreUtils";
import { MeasurementLayer, PosterPage } from "./components/PosterComponents";

const { 
  getInitialPoster, getInitialGithubToken, getThemeText, getPosterFonts, 
  getPageFillSetting, cloneGame, countEmbeddedImages, 
  uploadPosterImages, saveRemoteTemplate, persistLocalTemplate, saveTemplateHistory, 
  getTemplateFields, formatHistoryTime, defaultInfoFontSize, defaultInfoFontWeight,
  githubTokenStorageKey, normalizePosterTemplate, maxHistoryItems, defaultLogoPosition,
  defaultThemeText
} = Core;

"""

app_content = app_imports + app_func_block + "\nexport default App;\n"

with open('src/App.jsx', 'w', encoding='utf-8') as f:
    f.write(app_content)

print("Refactoring completed via Python.")
