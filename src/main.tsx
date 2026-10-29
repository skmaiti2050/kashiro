import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/ui/App";
import { showTheme, startupTheme } from "@/ui/theme";

// Before the first render, so the first frame has the chosen theme's colours (Task F21b item 4).
showTheme(startupTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
