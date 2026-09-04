# Winter Arc — Streamlit deployment

This is the Streamlit deployment wrapper for the existing Winter Arc React app.

## Run locally

```bash
pip install -r requirements.txt
streamlit run app.py
```

The original `winter-arc.jsx` is loaded into a browser-side React runtime inside a Streamlit component. Its existing UI and scoring logic are preserved, while the original `window.storage` persistence is mapped to browser `localStorage` for the first personal deployment.

## Deploy on Streamlit Community Cloud

1. Create a GitHub repository.
2. Put `app.py`, `winter-arc.jsx`, and `requirements.txt` in the repository root.
3. Open Streamlit Community Cloud and create a new app from the repository.
4. Set the main file to `app.py`.
5. Deploy.

The app currently uses CDN-loaded React, Recharts, Lucide React, and Babel in the browser, so those packages do not need to be installed in `requirements.txt`.
