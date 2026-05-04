import { useEffect } from "react";
import mcScopedStyles from "../components/mission-control/mcSourceStyles.css?raw";

const MC_STYLE_ID = "mc-source-style-port";

export function useMCData(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let styleTag = document.getElementById(MC_STYLE_ID) as HTMLStyleElement | null;
    let createdStyleTag = false;

    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = MC_STYLE_ID;
      document.head.appendChild(styleTag);
      createdStyleTag = true;
    }

    styleTag.textContent = mcScopedStyles;

    return () => {
      if (createdStyleTag) {
        styleTag?.remove();
      }
    };
  }, [enabled]);
}
