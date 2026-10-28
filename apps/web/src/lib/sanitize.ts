/**
 * DOMPurify options for agent-rendered markdown in the smart wallet. On top of DOMPurify's defaults
 * (no script, no event handlers): no form controls (a fake "confirm" form or button inside a chat
 * bubble) and no inline style (overlays that cover the real verdict or send button).
 */
export const SANITIZE_CONFIG = {
  FORBID_TAGS: ["form", "input", "button", "textarea", "select"],
  FORBID_ATTR: ["style"],
};
