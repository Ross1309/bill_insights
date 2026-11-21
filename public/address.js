// The address box (Home, My members, Members tab): its markup and suggestions while
// typing (/api/address-suggest, Geoapify). The lookup itself is findAndRemember in members.js.

import { escapeHtml as esc } from "./util.js";

export const ADDRESS_NOTE = "Sent to the U.S. Census Bureau (and, for suggestions or addresses it can't find, Geoapify) to find your district; not stored by us. Your members are remembered in this browser only.";

// The input with its suggestion list. `cls` = the input's classes.
export function addressInputHtml({ id, cls, placeholder = "Street address, city, state, or ZIP code" }) {
  return `
    <div class="relative flex-1 min-w-0">
      <input id="${esc(id)}" data-address type="text" autocomplete="street-address" maxlength="200" required
        placeholder="${esc(placeholder)}" role="combobox" aria-autocomplete="list" aria-expanded="false"
        aria-controls="${esc(id)}-list" class="${esc(cls)}" />
      <div id="${esc(id)}-list" data-address-list class="hidden absolute left-0 right-0 top-full mt-1 z-30 bg-surface border border-gray-300 rounded-lg shadow-lg overflow-hidden">
        <ul role="listbox" aria-label="Address suggestions"></ul>
        <p class="px-3 py-1 text-[10px] text-gray-500 border-t border-gray-200">Powered by <a href="https://www.geoapify.com/" class="underline" target="_blank" rel="noopener">Geoapify</a> · © <a href="https://www.openstreetmap.org/copyright" class="underline" target="_blank" rel="noopener">OpenStreetMap contributors</a></p>
      </div>
    </div>`;
}

// --- Suggestions --------------------------------------------------------------------

const cache = new Map();
let timer = null, inflight = null;

const wanted = text => text.length >= 5 && /\d/.test(text) && /[a-z]{2}/i.test(text) && !/^\s*\d{5}(-\d{4})?\s*$/.test(text);

async function fetchSuggestions(text) {
  if (cache.has(text)) return cache.get(text);
  inflight?.abort();
  inflight = new AbortController();
  const res = await fetch("/api/address-suggest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: inflight.signal,
  });
  const { suggestions = [] } = res.ok ? await res.json() : {};
  cache.set(text, suggestions);
  return suggestions;
}

const listOf = input => document.getElementById(input.getAttribute("aria-controls"));

function close(input) {
  const box = listOf(input);
  if (!box) return;
  box.classList.add("hidden");
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
}

function show(input, suggestions) {
  const box = listOf(input);
  if (!box) return;
  if (!suggestions.length || document.activeElement !== input) { close(input); return; }
  box.querySelector("ul").innerHTML = suggestions.map((s, i) => `
    <li id="${esc(input.id)}-opt-${i}" role="option" aria-selected="false" data-i="${i}"
      class="px-3 py-2 text-sm text-gray-800 cursor-pointer hover:bg-gray-200">${esc(s.label)}</li>`).join("");
  box._suggestions = suggestions;
  box.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
  input.removeAttribute("aria-activedescendant");
}

function move(input, step) {
  const box = listOf(input);
  const opts = [...box.querySelectorAll("[role=option]")];
  if (!opts.length) return;
  const cur = opts.findIndex(o => o.getAttribute("aria-selected") === "true");
  const next = (cur + step + opts.length) % opts.length;
  opts.forEach((o, i) => {
    o.setAttribute("aria-selected", String(i === next));
    o.classList.toggle("bg-gray-200", i === next);
  });
  input.setAttribute("aria-activedescendant", opts[next].id);
}

function choose(input, s) {
  input.value = s.label;
  // Remember where the picked address is: the lookup uses it if the Census can't match the text.
  input.dataset.pickLabel = s.label;
  input.dataset.pickLat = s.lat;
  input.dataset.pickLon = s.lon;
  close(input);
  input.form?.requestSubmit();
}

export function setupAddressSuggest() {
  document.addEventListener("input", ev => {
    const input = ev.target.closest?.("[data-address]");
    if (!input) return;
    clearTimeout(timer);
    const text = input.value.trim();
    if (!wanted(text)) { close(input); return; }
    timer = setTimeout(async () => {
      try {
        const suggestions = await fetchSuggestions(text);
        if (input.value.trim() === text) show(input, suggestions);
      } catch { /* aborted or offline: no suggestions */ }
    }, 300);
  });
  document.addEventListener("keydown", ev => {
    const input = ev.target.closest?.("[data-address]");
    if (!input || input.getAttribute("aria-expanded") !== "true") return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); move(input, ev.key === "ArrowDown" ? 1 : -1); }
    else if (ev.key === "Escape") { ev.preventDefault(); close(input); }
    else if (ev.key === "Enter") {
      const active = input.getAttribute("aria-activedescendant");
      const i = active ? Number(document.getElementById(active)?.dataset.i) : -1;
      const s = listOf(input)._suggestions?.[i];
      if (s) { ev.preventDefault(); choose(input, s); } else close(input);
    }
  });
  // mousedown, not click: the input keeps focus, so the list doesn't close first.
  document.addEventListener("mousedown", ev => {
    const opt = ev.target.closest?.("[data-address-list] [role=option]");
    if (opt) {
      ev.preventDefault();
      const box = opt.closest("[data-address-list]");
      const input = document.querySelector(`[aria-controls="${box.id}"]`);
      const s = box._suggestions?.[Number(opt.dataset.i)];
      if (input && s) choose(input, s);
      return;
    }
    document.querySelectorAll("[data-address][aria-expanded=true]").forEach(input => {
      if (!input.parentElement.contains(ev.target)) close(input);
    });
  });
  document.addEventListener("focusout", ev => {
    const input = ev.target.closest?.("[data-address]");
    // Focus moving into the list (its attribution links) keeps it open.
    if (input) setTimeout(() => { if (document.activeElement !== input && !listOf(input)?.contains(document.activeElement)) close(input); }, 150);
  });
}
