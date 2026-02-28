import { createRoot } from "react-dom/client";
import App from "./App";
import "./global.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
