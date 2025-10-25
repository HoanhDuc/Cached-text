// === Persistent Inline Text Editor (SPA & Page-Specific Cache) ===

// Track editing state
let editingEnabled = true;

// Classes to prevent actions
const PREVENTED_CLASSES = ["_e9h"];

// --- Current PAGE_KEY ---
let currentPageKey = location.origin + location.pathname;

// --- Edited elements per PAGE_KEY ---
const editedElementsMap = {}; // { [PAGE_KEY]: Set<key> }

function getEditedElementsForPage() {
  if (!editedElementsMap[currentPageKey])
    editedElementsMap[currentPageKey] = new Set();
  return editedElementsMap[currentPageKey];
}

// ---- Check if editing is enabled ----
async function isEditingEnabled() {
  const data = await chrome.storage.local.get("editingEnabled");
  return data.editingEnabled !== false;
}

// ---- Check if element has prevented classes ----
async function hasPreventedClass(element) {
  if (await isEditingEnabled()) return false;
  return PREVENTED_CLASSES.some((cls) => element.classList.contains(cls));
}

// ---- Prevent actions (allow selection) ----
async function preventActionsOnClass() {
  if (await isEditingEnabled()) return;
  PREVENTED_CLASSES.forEach((cls) => {
    document.querySelectorAll(`.${cls}`).forEach((el) => {
      ["click", "dblclick", "contextmenu"].forEach((evt) => {
        el.addEventListener(
          evt,
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
          },
          true
        );
      });
      el.style.userSelect = "text";
      el.style.cursor = "text";
    });
  });
}

// ---- Storage helpers ----
async function getSavedEdits() {
  const data = await chrome.storage.local.get(currentPageKey);
  return data[currentPageKey] || {};
}

async function saveEdit(el) {
  const key = getKey(el);
  const text = el.textContent.trim();
  const edits = await getSavedEdits();
  edits[key] = text;
  await chrome.storage.local.set({ [currentPageKey]: edits });
}

// ---- Generate stable key for element ----
function getKey(el) {
  const path = [];
  let node = el;
  while (node && node.parentNode && node !== document.body) {
    const index = Array.from(node.parentNode.children).indexOf(node);
    path.unshift(`${node.tagName}:${index}`);
    node = node.parentNode;
  }
  return path.join(">");
}

// ---- Apply saved edits safely ----
async function applyEdits() {
  const edits = await getSavedEdits();
  if (!Object.keys(edits).length) return;

  for (const [key, newText] of Object.entries(edits)) {
    const el = getElementByKey(key);
    if (!el) continue;
    const currentText = el.textContent.trim();
    const isBeingEdited = el.dataset.isEditing === "true";
    if (currentText !== newText && !isBeingEdited) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      if (textNodes.length > 0) textNodes[0].textContent = newText;
    }
  }
}

// ---- Retrieve element by key ----
function getElementByKey(key) {
  try {
    const parts = key.split(">");
    let node = document.body;
    for (const p of parts) {
      const [, index] = p.split(":");
      const childIndex = parseInt(index, 10);
      if (isNaN(childIndex) || !node.children[childIndex]) return null;
      node = node.children[childIndex];
    }
    return node;
  } catch {
    return null;
  }
}

// ---- Enable editing on elements ----
async function enableEditing() {
  if (!(await isEditingEnabled())) return;

  const selectors = ["div._1b33 span"];
  selectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach(async (el) => {
      if (await hasPreventedClass(el)) return;
      if (el.dataset.editReady || !el.textContent.trim()) return;
      if (el.children.length > 0) return;
      if (el.id === "editableSaveBtn" || el.id.startsWith("editable")) return;

      el.dataset.editReady = "true";
      el.contentEditable = "true";
      el.style.caretColor = "#000";
      el.style.userSelect = "text";
      el.style.cursor = "text";

      el.addEventListener("focus", () => (el.dataset.isEditing = "true"));
      el.addEventListener("blur", () => (el.dataset.isEditing = "false"));

      el.addEventListener("input", async () => {
        el.dataset.isEditing = "true";
        const editedSet = getEditedElementsForPage();
        editedSet.add(getKey(el));
        await saveEdit(el);
      });

      // Prevent double-click popups
      el.addEventListener(
        "dblclick",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          return false;
        },
        true
      );

      // Stop propagation of events that could interfere
      ["click", "focus", "keydown", "keypress", "keyup"].forEach((evt) =>
        el.addEventListener(evt, (e) => e.stopPropagation(), true)
      );
    });
  });
}

// ---- Chrome message listener ----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getEditedElements") {
    const editedData = {};
    const editedSet = getEditedElementsForPage();
    editedSet.forEach((key) => {
      const el = getElementByKey(key);
      if (el)
        editedData[key] = { textContent: el.textContent.trim(), element: el };
    });
    sendResponse({ editedElements: editedData });
  } else if (request.action === "clearEditedElements") {
    getEditedElementsForPage().clear();
    sendResponse({ success: true });
  } else if (request.action === "setEditingState") {
    editingEnabled = request.enabled;
    (async () => {
      if (editingEnabled) {
        await enableEditing();
      } else {
        document.querySelectorAll('[contenteditable="true"]').forEach((el) => {
          el.contentEditable = "false";
          el.dataset.editReady = "false";
        });
      }
      sendResponse({ success: true });
    })();
    return true;
  }
});

// ---- Observe dynamic DOM changes ----
function startObservers() {
  let applying = false;
  const observer = new MutationObserver(async () => {
    if (applying) return;
    applying = true;
    await applyEdits();
    await enableEditing();
    await preventActionsOnClass();
    applying = false;
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---- Observe SPA path changes ----
function startPathObserver() {
  let lastPath = currentPageKey;
  const observer = new MutationObserver(async () => {
    const newPath = location.origin + location.pathname;
    if (newPath !== lastPath) {
      console.log("🛑 Path changed from", lastPath, "to", newPath);

      lastPath = newPath;
      currentPageKey = newPath;
      getEditedElementsForPage().clear();
      await applyEdits();
      await enableEditing();
      await preventActionsOnClass();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ---- Prevent scroll when hovering/focus on div._2ut_ ----
function preventScrollOnDiv2ut() {
  // Wheel / mouse scroll
  document.addEventListener(
    "wheel",
    (e) => {
      const target = e.target.closest("div._2ut_");
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    },
    { passive: false }
  );

  // Touch move (mobile)
  document.addEventListener(
    "touchmove",
    (e) => {
      const target = e.target.closest("div._2ut_");
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    },
    { passive: false }
  );

  // Key scroll
  document.addEventListener("keydown", (e) => {
    const target = document.activeElement.closest
      ? document.activeElement.closest("div._2ut_")
      : null;
    if (target) {
      const keys = [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        " ",
        "Home",
        "End",
      ];
      if (keys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  });
}

// ---- Wait for target elements ----
function waitForTarget(callback) {
  const timer = setInterval(() => {
    if (document.querySelector("div._1b33 span")) {
      clearInterval(timer);
      callback();
    }
  }, 500);
}

// ---- Init ----
waitForTarget(async () => {
  console.log("🔹 Inline editor initialized for", currentPageKey);
  getEditedElementsForPage().clear();
  await enableEditing();
  await applyEdits();
  await preventActionsOnClass();
  startObservers();
  startPathObserver();
  preventScrollOnDiv2ut();
});
