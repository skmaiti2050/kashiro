import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/ui/App";
import { startApp } from "@/ui/platform/startup";
import { showTheme, startupTheme } from "@/ui/theme";

// Before the first render, so the first frame has the chosen theme's colours (Task F21b item 4).
showTheme(startupTheme());

// The web build shows a loading screen with Harper's download progress first (src/ui/platform-web/startup.ts).
startApp(
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement),
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
