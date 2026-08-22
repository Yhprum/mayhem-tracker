import { createRoot } from "react-dom/client";
import App from "./App";
import { initViewState } from "./lib/viewState";
import "./global.css";

const root = createRoot(document.getElementById("root")!);

// Pages read their remembered filters as they mount, so whether to remember at
// all has to be settled before the first render.
window.api
  .getSetting("remember_filters")
  .catch(() => null)
  .then((remember) => {
    initViewState(remember === "true");
    root.render(<App />);
  });
