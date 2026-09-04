import streamlit as st
import streamlit.components.v1 as components
from pathlib import Path
import re


st.set_page_config(
    page_title="Winter Arc",
    page_icon="❄️",
    layout="wide",
    initial_sidebar_state="collapsed",
)


def load_winter_arc():
    jsx_path = Path(__file__).with_name("winter-arc.jsx")
    source = jsx_path.read_text(encoding="utf-8")

    # ------------------------------------------------------------
    # 1. Remove the original package imports.
    #
    # The original JSX imports React, lucide-react and recharts.
    # We provide those through browser-native ESM imports instead.
    # ------------------------------------------------------------

    source = re.sub(
        r'import\s+React,\s*\{[\s\S]*?\}\s+from\s+["\']react["\'];?\s*',
        '',
        source,
        count=1,
    )

    source = re.sub(
        r'import\s*\{[\s\S]*?\}\s*from\s*["\']lucide-react["\'];?\s*',
        '',
        source,
        count=1,
    )

    source = re.sub(
        r'import\s*\{[\s\S]*?\}\s*from\s*["\']recharts["\'];?\s*',
        '',
        source,
        count=1,
    )

    # Remove ES module export.
    source = re.sub(
        r'export\s+default\s+',
        '',
        source,
        count=1,
    )

    # ------------------------------------------------------------
    # 2. Replace the original window.storage API with localStorage.
    #
    # Streamlit's iframe does not provide window.storage.
    # ------------------------------------------------------------

    source = source.replace(
        """const res = await window.storage.get(STORAGE_KEY, false);
        if (res?.value) {
          setState(JSON.parse(res.value));""",
        """const value = localStorage.getItem(STORAGE_KEY);
        if (value) {
          setState(JSON.parse(value));"""
    )

    source = source.replace(
        """const res = await window.storage.set(STORAGE_KEY, JSON.stringify(state), false);
        if (!res) setStorageStatus("unavailable");""",
        """localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        setStorageStatus("ok");"""
    )

    # ------------------------------------------------------------
    # 3. Browser-native module imports.
    #
    # React and ReactDOM come from esm.sh.
    # Lucide and Recharts are also loaded as real ESM modules,
    # avoiding the CommonJS "require is not defined" problem.
    # ------------------------------------------------------------

    imports = r"""
import React, {
    useState,
    useEffect,
    useMemo,
    useCallback,
    useRef
} from "https://esm.sh/react@18.3.1";

import ReactDOM from "https://esm.sh/react-dom@18.3.1/client";

import {
    Snowflake,
    Dumbbell,
    Activity,
    Beef,
    Droplet,
    Moon,
    BookOpen,
    Sparkles,
    Settings as SettingsIcon,
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
} from "https://esm.sh/lucide-react@0.468.0";

import {
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
} from "https://esm.sh/recharts@2.12.7";
"""

    # ------------------------------------------------------------
    # 4. Mount React.
    # ------------------------------------------------------------

    source += r"""

const root = ReactDOM.createRoot(
    document.getElementById("root")
);

root.render(
    React.createElement(App)
);
"""

    # ------------------------------------------------------------
    # 5. Build HTML.
    # ------------------------------------------------------------

    html = f"""
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >

    <style>
        html,
        body,
        #root {{
            margin: 0;
            padding: 0;
            min-height: 100%;
            width: 100%;
            background: #0A0F14;
        }}

        body {{
            overflow-x: hidden;
        }}

        * {{
            box-sizing: border-box;
        }}
    </style>
</head>

<body>

<div id="root"></div>

<script src="https://unpkg.com/@babel/standalone@7.26.0/babel.min.js"></script>

<script type="text/plain" id="winter-arc-source">
{imports}

{source}
</script>

<script>
(async () => {{
    const root = document.getElementById("root");

    try {{
        // Read the JSX/module source.
        const source = document.getElementById(
            "winter-arc-source"
        ).textContent;

        // Babel converts JSX into normal JavaScript.
        const transformed = Babel.transform(
            source,
            {{
                presets: ["react"],
                sourceType: "module"
            }}
        ).code;

        // Create a Blob URL so the browser can execute
        // the transformed JavaScript as a real ES module.
        const blob = new Blob(
            [transformed],
            {{ type: "text/javascript" }}
        );

        const moduleUrl = URL.createObjectURL(blob);

        await import(moduleUrl);

        URL.revokeObjectURL(moduleUrl);

    }} catch (error) {{
        console.error(error);

        root.innerHTML = `
            <div style="
                min-height:100vh;
                background:#0A0F14;
                color:#E7EEF2;
                padding:32px;
                font-family:Inter,system-ui,sans-serif;
            ">
                <h2 style="
                    color:#C9E8F5;
                    margin-bottom:12px;
                ">
                    Winter Arc failed to load
                </h2>

                <pre style="
                    color:#ff9b9b;
                    white-space:pre-wrap;
                    line-height:1.5;
                    font-size:13px;
                ">${{
                    String(error.stack || error)
                }}</pre>
            </div>
        `;
    }}
}})();
</script>

</body>
</html>
"""

    return html


def app():
    html = load_winter_arc()

    components.html(
        html,
        height=1400,
        scrolling=True,
    )


if __name__ == "__main__":
    app()
