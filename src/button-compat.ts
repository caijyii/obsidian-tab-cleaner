import { requireApiVersion, type ButtonComponent } from "obsidian";

/** Preserve the existing destructive primary style on both supported API generations. */
export function setDestructiveButton(button: ButtonComponent): ButtonComponent {
  if (requireApiVersion("1.13.0") && typeof button.setDestructive === "function") return button.setDestructive().setCta();
  // Obsidian before 1.13.0 has no setDestructive; its native destructive style is mod-warning.
  button.buttonEl.addClass("mod-warning");
  return button;
}
