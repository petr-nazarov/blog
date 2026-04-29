function initSearch(): void {
  const modal = document.getElementById("search-modal");
  const backdrop = document.getElementById("search-backdrop");
  const searchContainer = document.getElementById("search");

  if (!modal || !backdrop || !searchContainer) return;

  let selectedIndex = -1;

  function getResultLinks(): NodeListOf<HTMLAnchorElement> {
    return searchContainer!.querySelectorAll<HTMLAnchorElement>(".pagefind-ui__result-link");
  }

  function updateSelection(): void {
    const links = getResultLinks();
    links.forEach((link, i) => {
      if (i === selectedIndex) {
        link.classList.add("search-selected");
        link.scrollIntoView({ block: "nearest" });
      } else {
        link.classList.remove("search-selected");
      }
    });
  }

  function getQuery(): string {
    const input = modal!.querySelector<HTMLInputElement>(".pagefind-ui__search-input");
    return input?.value?.trim() ?? "";
  }

  function rewriteLinks(): void {
    const query = getQuery();
    if (!query) return;
    const links = getResultLinks();
    links.forEach((link) => {
      try {
        const url = new URL(link.href);
        url.searchParams.set("highlight", query);
        link.href = url.toString();
      } catch {
        // skip malformed URLs
      }
    });
  }

  const observer = new MutationObserver(() => {
    selectedIndex = -1;
    updateSelection();
    rewriteLinks();
  });
  observer.observe(searchContainer, { childList: true, subtree: true });

  function open(): void {
    modal!.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    selectedIndex = -1;
    const input = modal!.querySelector<HTMLInputElement>(".pagefind-ui__search-input");
    if (input) {
      input.value = "";
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function close(): void {
    modal!.classList.add("hidden");
    document.body.style.overflow = "";
    selectedIndex = -1;
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (target instanceof HTMLElement) {
      return (
        target.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      );
    }
    return false;
  }

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (((e.metaKey || e.ctrlKey) && e.key === "k") || (e.key === "/" && !isEditableTarget(e.target))) {
      e.preventDefault();
      if (modal!.classList.contains("hidden")) {
        open();
      } else {
        close();
      }
    }
    if (e.key === "Escape" && !modal!.classList.contains("hidden")) {
      e.preventDefault();
      close();
    }
  });

  searchContainer.addEventListener("keydown", (e: KeyboardEvent) => {
    const links = getResultLinks();
    if (links.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, links.length - 1);
      updateSelection();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      updateSelection();
    } else if (e.key === "Enter" && selectedIndex >= 0 && links[selectedIndex]) {
      e.preventDefault();
      window.location.href = links[selectedIndex].href;
    }
  });

  searchContainer.addEventListener("input", () => {
    selectedIndex = -1;
  });

  backdrop.addEventListener("click", close);

  document.getElementById("search-trigger")?.addEventListener("click", open);
}

initSearch();
document.addEventListener("astro:after-swap", initSearch);
