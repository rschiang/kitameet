/**
 * 右側工具列與單開式彈出面板。
 * 同時只有一個面板開啟；Escape 與面板外的點擊都會關閉並還原焦點。
 */
export interface PopoverSpec {
  id: string;
  label: string;
  icon: SVGSVGElement;
  content: HTMLElement;
}

export interface PopoverHandle {
  /** 控制項不在預設狀態時於按鈕角落顯示標記。 */
  setMarked(marked: boolean): void;
  close(): void;
}

export interface Toolbar {
  element: HTMLElement;
  add(spec: PopoverSpec): PopoverHandle;
}

/** 按鈕 40 px、間距 8 px，與 CSS 一致；不做版面量測。 */
const BUTTON_PITCH = 48;
const TOOLBAR_TOP = 16;

export function createToolbar(): Toolbar {
  const element = document.createElement("div");
  element.id = "toolbar";

  interface Entry {
    button: HTMLButtonElement;
    popover: HTMLElement;
  }
  const entries: Entry[] = [];
  let open: Entry | undefined;

  function close(restoreFocus: boolean): void {
    if (!open) return;
    const entry = open;
    open = undefined;
    entry.popover.hidden = true;
    entry.button.setAttribute("aria-expanded", "false");
    if (restoreFocus) entry.button.focus();
  }

  function show(entry: Entry): void {
    if (open === entry) {
      close(true);
      return;
    }
    close(false);
    open = entry;
    entry.popover.hidden = false;
    entry.button.setAttribute("aria-expanded", "true");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      close(true);
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (!open) return;
    const node = event.target as Node;
    if (element.contains(node) || open.popover.contains(node)) return;
    close(false);
  });

  return {
    element,
    add(spec) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tool";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", `pop-${spec.id}`);
      button.setAttribute("aria-label", spec.label);
      button.title = spec.label;
      button.append(spec.icon);

      const popover = document.createElement("div");
      popover.className = "popover";
      popover.id = `pop-${spec.id}`;
      popover.hidden = true;
      popover.style.top = `${TOOLBAR_TOP + entries.length * BUTTON_PITCH}px`;

      const header = document.createElement("header");
      const heading = document.createElement("h2");
      heading.textContent = spec.label;
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "icon-close";
      closeButton.setAttribute("aria-label", "關閉");
      closeButton.textContent = "×";
      header.append(heading, closeButton);
      popover.append(header, spec.content);

      const entry: Entry = { button, popover };
      entries.push(entry);
      element.append(button);
      document.body.append(popover);

      button.addEventListener("click", () => show(entry));
      closeButton.addEventListener("click", () => close(true));

      return {
        setMarked(marked) {
          if (marked) button.dataset.marked = "true";
          else delete button.dataset.marked;
        },
        close: () => {
          if (open === entry) close(false);
        },
      };
    },
  };
}
