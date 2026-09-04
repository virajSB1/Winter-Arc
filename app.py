import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="Winter Arc",
    page_icon="❄️",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def build_html():
    jsx_path = Path(__file__).parent / "winter-arc.jsx"
    source = jsx_path.read_text(encoding="utf-8")

    # Remove the three ES-module imports from the original React source.
    source = re.sub(
        r'^import React,.*?from ["\']react["\'];\s*',
        '', source, count=1, flags=re.MULTILINE | re.DOTALL
    )
    source = re.sub(
        r'^import\s*\{[\s\S]*?\}\s*from\s*["\']lucide-react["\'];\s*',
        '', source, count=1, flags=re.MULTILINE
    )
    source = re.sub(
        r'^import\s*\{[\s\S]*?\}\s*from\s*["\']recharts["\'];\s*',
        '', source, count=1, flags=re.MULTILINE
    )

    # Turn `export default function App()` into a normal function declaration.
    source = source.replace("export default function App()", "function App()", 1)

    # Replace the non-browser window.storage API used by the original app.
    source = source.replace(
        """const res = await window.storage.get(STORAGE_KEY, false);
        if (res?.value) {
          setState(JSON.parse(res.value));""",
        """const value = localStorage.getItem(STORAGE_KEY);
        if (value) {
          setState(JSON.parse(value));""",
    )
    source = source.replace(
        """const res = await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
        if (!res) setStorageStatus("unavailable");""",
        """localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setStorageStatus("ok");""",
    )

    # The original JSX expects these names to exist in its module scope.
    prelude = r'''
import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} from "https://esm.sh/react@18.3.1";

import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";

import {
  Snowflake, Dumbbell, Activity, Beef, Droplet, Moon, BookOpen, Sparkles,
  Settings as SettingsIcon, Calendar, BarChart3, Home, Plus, Trash2,
  GripVertical, Check, X, Clock, Flame, ChevronLeft, ChevronRight, Star,
  Download, Upload, RotateCcw, AlertCircle, ChevronDown, MoreVertical,
  SkipForward, PencilLine, Sunrise, Wind, Shirt, Sparkle, Utensils, Sofa,
  ListChecks, CircleCheck, CircleDashed, CircleSlash, Ban
} from "https://esm.sh/lucide-react@0.468.0?external=react";

import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ScatterChart, Scatter, ZAxis, Cell
} from "https://esm.sh/recharts@2.12.7?external=react,react-dom";
'''

    mount = r'''

const root = createRoot(document.getElementById("root"));
root.render(React.createElement(App));
'''

    full_source = prelude + "\n" + source + mount

    # repr() safely embeds the source in the HTML script.
    source_literal = repr(full_source)

    return f'''<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body, #root {{
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100%;
  background: #0A0F14;
}}
body {{ overflow-x: hidden; }}
* {{ box-sizing: border-box; }}
</style>
</head>
<body>
<div id="root"></div>

<script src="https://unpkg.com/@babel/standalone@7.26.0/babel.min.js"></script>
<script>
(async function () {{
  const root = document.getElementById("root");

  function showError(error) {{
    console.error("Winter Arc error:", error);
    root.innerHTML =
      '<div style="min-height:100vh;background:#0A0F14;color:#E7EEF2;padding:32px;font-family:Inter,system-ui,sans-serif">' +
      '<h2 style="color:#C9E8F5">Winter Arc failed to load</h2>' +
      '<pre style="color:#ff8f8f;white-space:pre-wrap;line-height:1.5">' +
      String(error && (error.stack || error.message) || error) +
      '</pre></div>';
  }}

  try {{
    if (!window.Babel) throw new Error("Babel failed to load");

    const appSource = {source_literal};

    // Convert JSX to JavaScript, while preserving ESM imports.
    const transformed = Babel.transform(appSource, {{
      presets: ["react"],
      sourceType: "module"
    }}).code;

    // Execute as a genuine browser ES module. This avoids CommonJS/require.
    const blob = new Blob([transformed], {{ type: "text/javascript" }});
    const url = URL.createObjectURL(blob);

    try {{
      await import(url);
    }} finally {{
      URL.revokeObjectURL(url);
    }}
  }} catch (error) {{
    showError(error);
  }}
}})();
</script>
</body>
</html>'''


html = build_html()
components.html(html, height=1400, scrolling=True)
