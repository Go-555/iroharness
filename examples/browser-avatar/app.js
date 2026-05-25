const avatar = document.querySelector("#avatar");
const speech = document.querySelector("#speech");
const mode = document.querySelector("#mode");
const events = document.querySelector("#events");
const form = document.querySelector("#turn-form");
const text = document.querySelector("#text");
const modality = document.querySelector("#modality");

const appendEvent = (label, value) => {
  const row = document.createElement("div");
  row.className = "event";
  row.textContent = `${new Date().toLocaleTimeString()} ${label} ${JSON.stringify(value)}`;
  events.prepend(row);
};

const renderState = (state) => {
  avatar.dataset.mode = state.mode;
  mode.textContent = `${state.mode} / ${state.emotion}`;
  if (state.speechText) {
    speech.textContent = state.speechText;
  }
  if (state.mode === "idle" && !state.speechText) {
    speech.textContent = "IroHarness";
  }
};

const connectEvents = () => {
  const source = new EventSource("/events");
  source.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    renderState(payload.state);
    appendEvent("state", payload.state);
  });
  source.addEventListener("speech", (event) => {
    const payload = JSON.parse(event.data);
    speech.textContent = payload.text;
    appendEvent("speech", { text: payload.text, brainId: payload.brainId });
  });
  source.addEventListener("task", (event) => {
    const payload = JSON.parse(event.data);
    appendEvent("task", {
      status: payload.status,
      ticketId: payload.ticketId,
      harnessId: payload.harnessId
    });
  });
  source.onerror = () => appendEvent("stream", "reconnecting");
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = text.value.trim();
  if (!value) {
    return;
  }
  await fetch("/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: value,
      modality: modality.value,
      source: "browser"
    })
  });
  text.value = "";
});

const loadInitialState = async () => {
  const response = await fetch("/state");
  renderState(await response.json());
};

await loadInitialState();
connectEvents();
