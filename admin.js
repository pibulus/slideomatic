const editor = document.getElementById("editor");
const reloadButton = document.getElementById("reload-button");
const downloadButton = document.getElementById("download-button");
const messageTemplate = document.getElementById("message-template");
const authScreen = document.getElementById("auth-screen");
const authForm = document.getElementById("auth-form");
const authPasswordInput = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");

const AUTH_TOKEN_KEY = "deck-admin-token";
const ADMIN_PASSWORD = "bonesoup"; // change to your secret

let slides = [];
let controlsBound = false;

init();

function init() {
  downloadButton.disabled = true;
  reloadButton.disabled = true;
  authForm.addEventListener("submit", handleAuthSubmit);

  if (hasValidToken()) {
    unlockEditor();
  } else {
    showAuthScreen();
  }
}

function bindControls() {
  if (controlsBound) return;
  reloadButton.addEventListener("click", () => loadSlides(true));
  downloadButton.addEventListener("click", downloadSlides);
  controlsBound = true;
}

async function loadSlides(force = false) {
  editor.innerHTML = "<p>Loading slides…</p>";
  downloadButton.disabled = true;
  reloadButton.disabled = true;

  try {
    const url = force ? `slides.json?ts=${Date.now()}` : "slides.json";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load slides.json (status ${response.status})`);
    }
    slides = await response.json();
    renderSlides();
  } catch (error) {
    console.error(error);
    showMessage("Unable to load slides", error.message ?? String(error));
  } finally {
    downloadButton.disabled = false;
    reloadButton.disabled = false;
  }
}

function handleAuthSubmit(event) {
  event.preventDefault();
  const input = authPasswordInput.value.trim();
  if (verifyPassword(input)) {
    storeToken(input);
    authPasswordInput.value = "";
    authError.textContent = "";
    hideAuthScreen();
    unlockEditor();
  } else {
    authError.textContent = "Incorrect password.";
    authPasswordInput.select();
  }
}

function unlockEditor() {
  hideAuthScreen();
  bindControls();
  loadSlides();
}

function showAuthScreen() {
  authError.textContent = "";
  authScreen.hidden = false;
  authScreen.setAttribute("aria-hidden", "false");
  setTimeout(() => authPasswordInput.focus(), 0);
}

function hideAuthScreen() {
  authScreen.hidden = true;
  authScreen.setAttribute("aria-hidden", "true");
}

function generateToken(input) {
  return btoa(Array.from(input).reverse().join(""));
}

function storeToken(password) {
  localStorage.setItem(AUTH_TOKEN_KEY, generateToken(password));
}

function hasValidToken() {
  const stored = localStorage.getItem(AUTH_TOKEN_KEY);
  return stored != null && stored === generateToken(ADMIN_PASSWORD);
}

function verifyPassword(input) {
  return input === ADMIN_PASSWORD;
}

function renderSlides() {
  if (!Array.isArray(slides) || slides.length === 0) {
    showMessage("No slides", "Add slide data to slides.json to begin editing.");
    return;
  }

  editor.innerHTML = "";

  slides.forEach((slide, index) => {
    const card = document.createElement("details");
    card.className = "slide-card";
    card.open = index === 0;

    const summary = document.createElement("summary");
    summary.textContent = slideSummary(slide, index);
    card.appendChild(summary);

    const body = document.createElement("div");
    body.className = "slide-card__body";
    renderObjectFields(slide, [index], body, () => {
      summary.textContent = slideSummary(slides[index], index);
    });

    card.appendChild(body);
    editor.appendChild(card);
  });
}

function slideSummary(slide, index) {
  return (
    slide.badge ||
    slide.headline ||
    slide.title ||
    `Slide ${index + 1}`
  );
}

function renderObjectFields(object, path, container, onChange) {
  Object.entries(object).forEach(([key, value]) => {
    const fieldPath = [...path, key];
    const field = createField(key, value, fieldPath, onChange);
    container.appendChild(field);
  });
}

function createField(key, value, path, onChange) {
  const fieldWrapper = document.createElement("div");
  fieldWrapper.className = "field";

  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) {
      const label = createLabel(key);
      const textarea = document.createElement("textarea");
      textarea.value = value.join("\n");
      textarea.addEventListener("input", (event) => {
        const lines = event.target.value.split(/\r?\n/);
        setValueAtPath(slides, path, lines);
        onChange?.();
      });
      fieldWrapper.append(label, textarea);
      return fieldWrapper;
    }

    const listContainer = document.createElement("div");
    listContainer.className = "field";
    const label = createLabel(key);
    listContainer.appendChild(label);

    value.forEach((item, index) => {
      const itemWrapper = document.createElement("fieldset");
      itemWrapper.className = "nested array-item";
      const legend = document.createElement("legend");
      legend.textContent = `${key}[${index}]`;
      itemWrapper.appendChild(legend);

      if (item && typeof item === "object") {
        renderObjectFields(item, [...path, index], itemWrapper, onChange);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = JSON.stringify(item, null, 2);
        textarea.addEventListener("change", (event) => {
          try {
            const nextValue = JSON.parse(event.target.value);
            setValueAtPath(slides, [...path, index], nextValue);
            textarea.setCustomValidity("");
            onChange?.();
          } catch (error) {
            console.error(error);
            textarea.setCustomValidity("Invalid JSON");
            textarea.reportValidity();
          }
        });
        itemWrapper.appendChild(textarea);
      }

      listContainer.appendChild(itemWrapper);
    });

    return listContainer;
  }

  if (value && typeof value === "object") {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "nested";
    const legend = document.createElement("legend");
    legend.textContent = key;
    fieldset.appendChild(legend);
    renderObjectFields(value, path, fieldset, onChange);
    return fieldset;
  }

  if (typeof value === "boolean") {
    const label = createLabel(key);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = value;
    checkbox.addEventListener("change", (event) => {
      setValueAtPath(slides, path, event.target.checked);
      onChange?.();
    });
    fieldWrapper.append(label, checkbox);
    return fieldWrapper;
  }

  const label = createLabel(key);
  const input = document.createElement("input");
  input.type = typeof value === "number" ? "number" : "text";
  input.value = value ?? "";
  input.addEventListener("input", (event) => {
    let nextValue = event.target.value;
    if (typeof value === "number") {
      const parsed = Number(nextValue);
      nextValue = Number.isNaN(parsed) ? 0 : parsed;
    }
    setValueAtPath(slides, path, nextValue);
    onChange?.();
  });
  fieldWrapper.append(label, input);
  return fieldWrapper;
}

function createLabel(key) {
  const label = document.createElement("label");
  label.textContent = key;
  return label;
}

function setValueAtPath(target, path, newValue) {
  let pointer = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    pointer = pointer[path[i]];
  }
  pointer[path[path.length - 1]] = newValue;
}

function downloadSlides() {
  const blob = new Blob([JSON.stringify(slides, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "slides.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function showMessage(title, message) {
  const templateContent = messageTemplate.content.cloneNode(true);
  const section = templateContent.querySelector(".message");
  section.querySelector("h2").textContent = title;
  section.querySelector("p").textContent = message;
  editor.innerHTML = "";
  editor.appendChild(section);
}
