import { useEffect } from "react";
import mcScopedStyles from "../components/mission-control/mcSourceStyles.css?raw";

const MC_STYLE_ID = "mc-source-style-port";

export function useMCData(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let styleTag = document.getElementById(MC_STYLE_ID) as HTMLStyleElement | null;

    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = MC_STYLE_ID;
      document.head.appendChild(styleTag);
    }

    styleTag.textContent = mcScopedStyles;

    // The tag is intentionally left in place on unmount. The rules are all
    // .mc-root-scoped, so they are inert without a board mounted; removing it
    // would strip styling from any other board instance that shares the tag
    // (the mount/unmount race that blanks the board after navigation).
  }, [enabled]);
}
