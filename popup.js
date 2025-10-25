// Popup script for save and clear functionality

// Get current tab to communicate with content script
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Get PAGE_KEY from current tab URL (same format as content script)
async function getPageKey() {
  const tab = await getCurrentTab();
  const url = new URL(tab.url);
  return url.origin + url.pathname;
}

// Get saved edits from storage
async function getSavedEdits() {
  const pageKey = await getPageKey();
  const data = await chrome.storage.local.get(pageKey);
  return data[pageKey] || {};
}

// Save edits to storage
async function saveEdits(edits) {
  const pageKey = await getPageKey();
  await chrome.storage.local.set({ [pageKey]: edits });
}

// Show status message
function showStatus(message, isSuccess = true) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.style.color = isSuccess ? "#28a745" : "#dc3545";

  setTimeout(() => {
    statusEl.textContent = "";
  }, 2000);
}

// Get editing state from storage
async function getEditingState() {
  const data = await chrome.storage.local.get("editingEnabled");
  return data.editingEnabled !== false; // Default to true if not set
}

// Save editing state to storage
async function setEditingState(enabled) {
  await chrome.storage.local.set({ editingEnabled: enabled });
}

// Update toggle button appearance
function updateToggleButton(enabled) {
  const toggleBtn = document.getElementById("toggleBtn");
  if (enabled) {
    toggleBtn.textContent = "🔒 Tắt chỉnh sửa";
    toggleBtn.classList.remove("disabled");
  } else {
    toggleBtn.textContent = "✏️ Bật chỉnh sửa";
    toggleBtn.classList.add("disabled");
  }
}

// Initialize toggle button
async function initToggleButton() {
  const enabled = await getEditingState();
  updateToggleButton(enabled);
}

// Save button functionality
document.getElementById("saveBtn").addEventListener("click", async () => {
  try {
    const tab = await getCurrentTab();
    console.log("Current tab:", tab.url);

    // Send message to content script to get edited elements
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "getEditedElements",
    });

    console.log("Response from content script:", response);

    if (response && response.editedElements) {
      const previous = await getSavedEdits();
      const allEdits = { ...previous };
      let count = 0;

      // Get current text content for each edited element
      for (const [key, elementInfo] of Object.entries(
        response.editedElements
      )) {
        const currentText = elementInfo.textContent;
        if (currentText && currentText.trim()) {
          allEdits[key] = currentText.trim();
          count++;
        }
      }

      console.log("Saving edits:", allEdits);
      await saveEdits(allEdits);

      // Clear edited elements in content script
      chrome.tabs.sendMessage(tab.id, { action: "clearEditedElements" });

      showStatus(`✅ Saved ${count} edits!`);

      // Update button text temporarily
      const saveBtn = document.getElementById("saveBtn");
      const originalText = saveBtn.textContent;
      saveBtn.textContent = "✅ Saved!";
      saveBtn.style.background = "#28a745";

      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.background = "#1877F2";
      }, 1500);
    } else {
      showStatus("No edits to save", false);
    }
  } catch (error) {
    console.error("Save error:", error);
    showStatus("Error saving edits", false);
  }
});

// Toggle button functionality
document.getElementById("toggleBtn").addEventListener("click", async () => {
  try {
    const tab = await getCurrentTab();
    const currentState = await getEditingState();
    const newState = !currentState;

    await setEditingState(newState);
    updateToggleButton(newState);

    // Send message to content script to update editing state
    chrome.tabs.sendMessage(tab.id, {
      action: "setEditingState",
      enabled: newState,
    });

    showStatus(newState ? "✅ Đã bật!" : "🔒 Đã tắt!");
  } catch (error) {
    console.error("Toggle error:", error);
    showStatus("Error toggling editing state", false);
  }
});

// Clear button functionality
document.getElementById("clearBtn").addEventListener("click", async () => {
  try {
    const tab = await getCurrentTab();
    const pageKey = await getPageKey();

    // Clear storage for current page
    await chrome.storage.local.remove(pageKey);

    // Clear edited elements in content script
    chrome.tabs.sendMessage(tab.id, { action: "clearEditedElements" });

    showStatus("✅ Cleared all edits!");

    // Update button text temporarily
    const clearBtn = document.getElementById("clearBtn");
    const originalText = clearBtn.textContent;
    clearBtn.textContent = "✅ Cleared!";
    clearBtn.style.background = "#28a745";

    setTimeout(() => {
      clearBtn.textContent = originalText;
      clearBtn.style.background = "#dc3545";
    }, 1500);
  } catch (error) {
    console.error("Clear error:", error);
    showStatus("Error clearing edits", false);
  }
});

// Initialize popup
initToggleButton();
