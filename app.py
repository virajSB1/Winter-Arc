import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path
import re


def app():
    st.set_page_config(
        page_title="Winter Arc",
        page_icon="❄️",
        layout="wide",
        initial_sidebar_state="collapsed",
    )

    jsx_path = Path(__file__).with_name("winter-arc.jsx")
    jsx = jsx_path.read_text(encoding="utf-8")

    # ---------------------------------------------------------
    # Remove the original npm imports because the browser will
    # load the UMD versions of React, Lucide and Recharts.
    # ---------------------------------------------------------

    jsx = re.sub(
        r'^import React,.*?;\n',
        '',
        jsx,
        count=1,
        flags=re.S,
    )

    jsx = re.sub(
        r'^import \{.*?\} from "recharts";\n',
        '',
        jsx,
        count=1,
        flags=re.S,
    )

    jsx = jsx.replace(
        'export default function App()',
        'function App()',
    )

    # ---------------------------------------------------------
    # Replace window.storage with browser localStorage.
    # ---------------------------------------------------------

    jsx = jsx.replace(
        '''const res = await window.storage.get(STORAGE_KEY, false);
        if (res?.value) {
          setState(JSON.parse(res.value));''',
        '''const value = localStorage.getItem(STORAGE_KEY);
        if (value) {
          setState(JSON.parse(value));''',
    )

    jsx = jsx.replace(
        '''const res = await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
        if (!res) setStorageStatus("unavailable");''',
        '''localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setStorageStatus("ok");''',
    )

    # ---------------------------------------------------------
    # Browser-side globals.
    #
    # IMPORTANT:
    # We deliberately do NOT declare:
    #     const React = window.React;
    #
    # The previous version did that while also passing React
    # into new Function(), causing:
    #
    # Identifier 'React' has already been declared
    # ---------------------------------------------------------

    prelude = r'''
const {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef
} = window.React;

const {
  Snowflake,
  Dumbbell,
  Activity,
  Beef,
  Droplet,
  Moon,
  BookOpen,
  Sparkles,
  Settings: SettingsIcon,
  Calendar,
  BarChart3,
  Home,
  Plus,
  Trash2,
  GripVertical,
  Check,
  X,
  Clock,
  Flame,
  ChevronLeft,
  ChevronRight,
  Star,
  Download,
  Upload,
  RotateCcw,
  AlertCircle,
  ChevronDown,
  MoreVertical,
  SkipForward,
  PencilLine,
  Sunrise,
  Wind,
  Shirt,
  Sparkle,
  Utensils,
  Sofa,
  ListChecks,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Ban
} = window.LucideReact;

const {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell
} = window.Recharts;
'''

    # ---------------------------------------------------------
    # Build the complete JavaScript application source.
    # ---------------------------------------------------------

    app_source = (
        prelude
        + "\n"
        + jsx
        + '''
        
const root = window.ReactDOM.createRoot(
  document.getElementById("root")
);

root.render(
  window.React.createElement(App)
);
'''
    )

    # repr() safely transfers the entire JSX source into the
    # iframe without Python/Javascript quoting collisions.
    app_source_js = repr(app_source)

    html = f'''<!doctype html>
<html>
<head>
<meta charset="utf-8" />

<meta
  name="viewport"
  content="width=device-width, initial-scale=1"
/>

<script
  crossorigin
  src="https://unpkg.com/react@18/umd/react.production.min.js">
</script>

<script
  crossorigin
  src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js">
</script>

<script
  src="https://unpkg.com/@babel/standalone/babel.min.js">
</script>

<script
  src="https://unpkg.com/lucide-react@0.468.0/dist/umd/lucide-react.js">
</script>

<script
  src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js">
</script>

<style>
html,
body,
#root {{
    margin: 0;
    min-height: 100%;
    background: #0A0F14;
}}

body {{
    overflow-x: hidden;
}}
</style>
</head>

<body>

<div id="root"></div>

<script>
/*
 * Normalize the globals exposed by the UMD builds.
 */
window.LucideReact =
    window.LucideReact ||
    window.lucideReact ||
    window.lucide;

window.Recharts =
    window.Recharts ||
    window.recharts;
</script>

<script>
const appSource = {app_source_js};

try {{

    /*
     * Babel converts the JSX from winter-arc.jsx into
     * normal JavaScript.
     */
    const transformed = Babel.transform(
        appSource,
        {{
            presets: ["react"],
            sourceType: "script"
        }}
    ).code;

    /*
     * IMPORTANT:
     *
     * Only `window` is passed into the generated function.
     *
     * The previous version passed React and ReactDOM as
     * function parameters while also declaring React inside
     * the generated source, which caused the duplicate
     * identifier error.
     */
    const run = new Function(
        "window",
        transformed
    );

    run(window);

}} catch (e) {{

    document.getElementById("root").innerHTML =
        '<pre style="' +
        'color:#ff8f8f;' +
        'padding:20px;' +
        'white-space:pre-wrap;' +
        'font-family:monospace;' +
        '">' +
        'Winter Arc failed to load\\n\\n' +
        String(e.stack || e) +
        '</pre>';

    console.error(e);
}}
</script>

</body>
</html>'''

    # ---------------------------------------------------------
    # Render React application inside Streamlit.
    # ---------------------------------------------------------

    components.html(
        html,
        height=1100,
        scrolling=True,
    )


# -------------------------------------------------------------
# Required by your deployment environment AND works normally
# with `streamlit run app.py`.
# -------------------------------------------------------------

if __name__ == "__main__":
    app()