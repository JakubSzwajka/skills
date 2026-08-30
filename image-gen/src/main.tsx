import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { reportFirstPaint } from "./app/startup";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/components.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

reportFirstPaint();
