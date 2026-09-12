/** Resolve shadcn's semantic color tokens at mount time so xterm's canvas
 * renderer follows the active light/dark theme. */
export function createTerminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim() || fallback;
    // xterm's canvas color parser does not understand every CSS Color 4
    // format (notably oklch, which shadcn uses). Let the browser normalize it
    // to a computed rgb color before handing it to xterm.
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.appendChild(probe);
    const normalized = getComputedStyle(probe).color;
    probe.remove();
    return normalized || fallback;
  };
  return {
    background: color("--background", "#181818"),
    foreground: color("--foreground", "#cccccc"),
    cursor: color("--foreground", "#ffffff"),
    selectionBackground: color("--accent", "#264f78"),
  };
}
