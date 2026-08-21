import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { startLaunchScreen } from "./app/launchScreen";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startLaunchScreen();

if ("serviceWorker" in navigator && !window.AtherloomNative) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => undefined);
  });
}
