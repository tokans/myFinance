import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RootErrorBoundary } from "@/components/layout/RootErrorBoundary";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
