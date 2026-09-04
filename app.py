import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path
import re

st.set_page_config(page_title="Winter Arc", page_icon="❄️", layout="wide", initial_sidebar_state="collapsed")

jsx_path = Path(__file__).with_name("winter-arc.jsx")
jsx = jsx_path.read_text(encoding="utf-8")

# Remove package imports. The browser loads their UMD builds below.
jsx = re.sub(r'^import React,.*?;\n', '', jsx, count=1, flags=re.S)
jsx = re.sub(r'^import \{.*?\} from "recharts";\n', '', jsx, count=1, flags=re.S)
jsx = jsx.replace('export default function App()', 'function App()')

# Streamlit's component iframe does not provide the original window.storage API.
# Use browser localStorage for the first personal deployment, preserving the app's
# existing JSON state model and export/import functionality.
jsx = jsx.replace(
    'const res = await window.storage.get(STORAGE_KEY, false);\n        if (res?.value) {\n          setState(JSON.parse(res.value));',
    'const value = localStorage.getItem(STORAGE_KEY);\n        if (value) {\n          setState(JSON.parse(value));'
)
jsx = jsx.replace(
    'const res = await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);\n        if (!res) setStorageStatus("unavailable");',
    'localStorage.setItem(STORAGE_KEY, JSON.stringify(state));\n        setStorageStatus("ok");'
)

# Make the original imported symbols available from browser globals.
prelude = r'''
const React = window.React;
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const {
  Snowflake, Dumbbell, Activity, Beef, Droplet, Moon, BookOpen, Sparkles,
  Settings: SettingsIcon, Calendar, BarChart3, Home, Plus, Trash2,
  GripVertical, Check, X, Clock, Flame, ChevronLeft, ChevronRight, Star,
  Download, Upload, RotateCcw, AlertCircle, ChevronDown, MoreVertical,
  SkipForward, PencilLine, Sunrise, Wind, Shirt, Sparkle, Utensils, Sofa,
  ListChecks, CircleCheck, CircleDashed, CircleSlash, Ban
} = window.LucideReact;
const {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ScatterChart, Scatter, ZAxis, Cell
} = window.Recharts;
'''

html = f'''<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://unpkg.com/lucide-react@0.468.0/dist/umd/lucide-react.js"></script>
<script src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js"></script>
<style>
html,body,#root {{ margin:0; min-height:100%; background:#0A0F14; }}
body {{ overflow-x:hidden; }}
</style>
</head>
<body>
<div id="root"></div>
<script>
window.LucideReact = window.LucideReact || window.lucideReact || window.lucide;
window.Recharts = window.Recharts || window.recharts;

</script>
<script>
const appSource = {repr(prelude + jsx + '\nconst root = ReactDOM.createRoot(document.getElementById("root")); root.render(React.createElement(App));')};
try {{
  const transformed = Babel.transform(appSource, {{presets:['react'], sourceType:'script'}}).code;
  const run = new Function('React','ReactDOM','window', transformed);
  run(window.React, window.ReactDOM, window);
}} catch (e) {{
  document.getElementById('root').innerHTML = '<pre style="color:#ff8f8f;padding:20px;white-space:pre-wrap">Winter Arc failed to load\\n\\n' + String(e.stack || e) + '</pre>';
  console.error(e);
}}
</script>
</body>
</html>'''

# The iframe needs enough vertical room for the app; the app itself handles mobile layout.
components.html(html, height=1100, scrolling=True)
