import { createRoot } from "react-dom/client";
import App from "./App";
import { initViewState } from "./lib/viewState";
import { hiddenNavLinks, navLayout } from "./lib/navigation";
import "./global.css";

const root = createRoot(document.getElementById("root")!);

// Pages read their remembered filters as they mount, so whether to remember at
// all has to be settled before the first render. So does the navigation, which
// would otherwise open in the default layout and then jump to the chosen one.
Promise.all([
  window.api.getSetting("remember_filters").catch(() => null),
  hiddenNavLinks.load(),
  navLayout.load(),
]).then(([remember]) => {
  initViewState(remember === "true");
  root.render(<App />);
});
