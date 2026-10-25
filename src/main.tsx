import React from "react";
import ReactDOM from "react-dom/client";
// Fonts are bundled with the app (not loaded from Google Fonts) because
// Discord's Activity sandbox blocks third-party hosts.
import "@fontsource/cinzel/latin-700.css";
import "@fontsource/cinzel/latin-900.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-700.css";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
