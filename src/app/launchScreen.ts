export function startLaunchScreen() {
  const screen = document.getElementById("launchScreen");
  if (!screen) return;

  let removalTimer = 0;
  const dismiss = () => {
    if (screen.classList.contains("dismissed")) return;
    screen.classList.add("dismissed");
    removalTimer = window.setTimeout(() => screen.remove(), 320);
  };

  const refresh = document.documentElement.dataset.launchMode === "refresh";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const delay = reducedMotion ? 180 : refresh ? 430 : 1250;
  screen.addEventListener("click", dismiss, { once: true });
  const dismissTimer = window.setTimeout(dismiss, delay);

  window.addEventListener("pagehide", () => {
    window.clearTimeout(dismissTimer);
    window.clearTimeout(removalTimer);
  }, { once: true });
}
