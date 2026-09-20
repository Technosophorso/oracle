const state = {
  currentTopic: null,
  pollHandle: null,
  lastListingTxId: null,
};

function el(id) {
  return document.getElementById(id);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
  return body;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function shortKey(k) {
  return k ? `${k.slice(0, 8)}…` : "?";
}

// --- Tabs -------------------------------------------------------------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    el(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// --- Identity -----------------------------------------------------------

async function loadIdentity() {
  try {
    const info = await api("/api/identity");
    el("identity-bar").textContent = `${info.npub} · ${info.relays.length} relay(s) · gateway: ${info.gateway}`;
  } catch (err) {
    el("identity-bar").textContent = `error loading identity: ${err.message}`;
  }
}

// --- Chats ----------------------------------------------------------------

async function refreshTopics() {
  const list = el("topics");
  list.innerHTML = "<li class='muted'>loading…</li>";
  try {
    const topics = await api("/api/coordination/topics?sinceMinutes=1440&limit=500");
    list.innerHTML = "";
    if (topics.length === 0) {
      list.innerHTML = "<li class='muted'>no recent activity seen</li>";
      return;
    }
    for (const t of topics) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(t.topic)}</span><span class="count">${t.count}</span>`;
      li.addEventListener("click", () => selectTopic(t.topic));
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = `<li class='muted'>error: ${escapeHtml(err.message)}</li>`;
  }
}

function selectTopic(topic) {
  state.currentTopic = topic;
  el("current-topic").textContent = topic;
  loadMessages();
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = setInterval(loadMessages, 3000);
}

async function loadMessages() {
  if (!state.currentTopic) return;
  try {
    const messages = await api(
      `/api/coordination/subchat?topic=${encodeURIComponent(state.currentTopic)}&sinceMinutes=1440&limit=200`,
    );
    const pane = el("messages");
    const wasAtBottom = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 20;
    pane.innerHTML = messages
      .map((m) => {
        const time = new Date(m.createdAt * 1000).toLocaleTimeString();
        const body =
          m.kind === "text"
            ? escapeHtml(m.content)
            : `<span class="act-name">${escapeHtml(m.act.act)}</span>\n${escapeHtml(JSON.stringify(m.act, null, 2))}`;
        return `<div class="msg ${m.kind}"><div class="meta"><span class="pubkey">${shortKey(m.pubkey)}</span> · ${time}</div><div class="content">${body}</div></div>`;
      })
      .join("");
    if (wasAtBottom) pane.scrollTop = pane.scrollHeight;
  } catch (err) {
    el("messages").innerHTML = `<div class="muted">error: ${escapeHtml(err.message)}</div>`;
  }
}

el("jump-topic-btn").addEventListener("click", () => {
  const topic = el("new-topic-input").value.trim();
  if (topic) selectTopic(topic);
});
el("refresh-topics-btn").addEventListener("click", refreshTopics);

const ACT_FIELD_SPECS = {
  text: [],
  "task-announce": [["task", "task"], ["deadline", "deadline (optional, ISO date)"]],
  bid: [["taskId", "taskId (event id being bid on)"], ["proposal", "proposal"]],
  award: [["taskId", "taskId"], ["winner", "winner pubkey"]],
  propose: [["content", "content"]],
  accept: [["refId", "refId"]],
  reject: [["refId", "refId"], ["reason", "reason (optional)"]],
  inform: [["content", "content"]],
};

function renderActFields() {
  const type = el("act-type").value;
  const container = el("act-fields");
  container.innerHTML = "";
  el("text-input").style.display = type === "text" ? "" : "none";
  for (const [key, placeholder] of ACT_FIELD_SPECS[type]) {
    const input = document.createElement("input");
    input.placeholder = placeholder;
    input.dataset.field = key;
    container.appendChild(input);
  }
}
el("act-type").addEventListener("change", renderActFields);
renderActFields();

el("send-btn").addEventListener("click", async () => {
  if (!state.currentTopic) return alert("Select or jump to a topic first.");
  const type = el("act-type").value;
  try {
    if (type === "text") {
      const content = el("text-input").value.trim();
      if (!content) return;
      await api("/api/coordination/subchat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: state.currentTopic, content }),
      });
      el("text-input").value = "";
    } else {
      const fields = {};
      document.querySelectorAll("#act-fields input").forEach((i) => {
        if (i.value.trim()) fields[i.dataset.field] = i.value.trim();
      });
      await api("/api/coordination/act", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: state.currentTopic, message: { act: type, ...fields } }),
      });
      document.querySelectorAll("#act-fields input").forEach((i) => (i.value = ""));
    }
    loadMessages();
  } catch (err) {
    alert(`Failed to send: ${err.message}`);
  }
});

// --- Registry ---------------------------------------------------------

el("search-btn").addEventListener("click", async () => {
  const query = el("search-query").value;
  const kind = el("search-kind").value;
  const capability = el("search-capability").value;
  const params = new URLSearchParams({ query });
  if (kind) params.set("kind", kind);
  if (capability) params.set("capability", capability);
  const resultsEl = el("search-results");
  resultsEl.innerHTML = "<li class='muted'>searching…</li>";
  try {
    const { results, totalIndexed } = await api(`/api/registry/search?${params}`);
    resultsEl.innerHTML = "";
    if (totalIndexed === 0) {
      resultsEl.innerHTML = "<li class='muted'>Local index is empty — click \"Update local index\" first.</li>";
      return;
    }
    if (results.length === 0) {
      resultsEl.innerHTML = "<li class='muted'>No matches.</li>";
      return;
    }
    for (const r of results) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(r.name)}</strong> <span class="tag">${r.kind}</span><br>
        ${escapeHtml(r.description)}<br>
        ${r.capabilities.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join("")}<br>
        <span class="txid clickable">${r.txId}</span>`;
      li.querySelector(".txid").addEventListener("click", () => openListing(r.txId));
      resultsEl.appendChild(li);
    }
  } catch (err) {
    resultsEl.innerHTML = `<li class='muted'>error: ${escapeHtml(err.message)}</li>`;
  }
});

async function runBuildIndex(rebuild) {
  el("index-status").textContent = rebuild ? "rebuilding from scratch…" : "updating…";
  try {
    const result = await api("/api/registry/build-index", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rebuild }),
    });
    el("index-status").textContent = `+${result.added} new, ${result.totalRecords} total (${result.gateway})`;
  } catch (err) {
    el("index-status").textContent = `error: ${err.message}`;
  }
}
el("build-index-btn").addEventListener("click", () => runBuildIndex(false));
el("rebuild-index-btn").addEventListener("click", () => runBuildIndex(true));

el("publish-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const capabilities = el("pub-capabilities").value.split(",").map((s) => s.trim()).filter(Boolean);
  let interfaceSpec = {};
  const rawSpec = el("pub-spec").value.trim();
  if (rawSpec) {
    try {
      interfaceSpec = JSON.parse(rawSpec);
    } catch {
      return alert("Interface spec is not valid JSON.");
    }
  }
  const payload = {
    kind: el("pub-kind").value,
    name: el("pub-name").value.trim(),
    description: el("pub-description").value.trim(),
    capabilities,
    interfaceTransport: el("pub-transport").value.trim(),
    interfaceSpec,
  };
  if (!confirm(`Publish "${payload.name}" permanently and publicly? This cannot be undone.`)) return;
  el("publish-result").textContent = "publishing…";
  try {
    const result = await api("/api/registry/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    el("publish-result").textContent = `Published: ${result.txId}`;
  } catch (err) {
    el("publish-result").textContent = `Error: ${err.message}`;
  }
});

// --- Listing detail -----------------------------------------------------

function openListing(txId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('[data-tab="listing"]').classList.add("active");
  el("tab-listing").classList.add("active");
  el("listing-txid-input").value = txId;
  loadListing(txId);
}

async function loadListing(txId) {
  const detail = el("listing-detail");
  detail.innerHTML = "<p class='muted'>loading…</p>";
  try {
    const { listing, signatureValid } = await api(`/api/registry/listing/${encodeURIComponent(txId)}`);
    state.lastListingTxId = txId;
    detail.innerHTML = `
      <div class="listing-card">
        <h3>${escapeHtml(listing.name)} <span class="tag">${listing.kind}</span></h3>
        <p>${escapeHtml(listing.description)}</p>
        <p>${listing.capabilities.map((c) => `<span class="tag">${escapeHtml(c)}</span>`).join("")}</p>
        <p class="muted">publisher: <span class="txid">${listing.publisher}</span></p>
        <p class="muted">signature: <span class="${signatureValid ? "ok" : "bad"}">${signatureValid ? "valid" : "INVALID"}</span></p>
        <p class="muted">tx: <span class="txid">${txId}</span></p>
        <pre class="result">${escapeHtml(JSON.stringify(listing.interface, null, 2))}</pre>
        <div class="row">
          <button id="verify-btn">Verify tool</button>
          <button id="score-btn">Check trust score</button>
        </div>
        <div id="verify-result"></div>
        <div id="score-result"></div>
        <h4>Leave a review</h4>
        <div class="row">
          <select id="review-rating">
            <option value="1">👍 good</option>
            <option value="0">😐 neutral</option>
            <option value="-1">👎 bad</option>
          </select>
          <input id="review-comment" placeholder="comment (optional)" />
          <button id="review-btn">Submit review</button>
        </div>
        <div id="review-result" class="muted"></div>
      </div>
    `;

    el("verify-btn").addEventListener("click", async () => {
      const out = el("verify-result");
      out.innerHTML = "<p class='muted'>checking…</p>";
      try {
        const { verification } = await api(`/api/verification/check/${encodeURIComponent(txId)}`);
        out.innerHTML = `<pre class="result">${escapeHtml(JSON.stringify(verification, null, 2))}</pre>`;
      } catch (err) {
        out.innerHTML = `<p class="bad">${escapeHtml(err.message)}</p>`;
      }
    });

    el("score-btn").addEventListener("click", async () => {
      const out = el("score-result");
      out.innerHTML = "<p class='muted'>computing…</p>";
      try {
        const score = await api(`/api/trust/score/${encodeURIComponent(txId)}`);
        out.innerHTML = `
          <p>Score: <strong>${score.score.toFixed(3)}</strong> (weight ${score.totalWeight.toFixed(3)}, ${score.reviewCount} review(s))</p>
          <pre class="result">${escapeHtml(JSON.stringify(score.reviews, null, 2))}</pre>
        `;
      } catch (err) {
        out.innerHTML = `<p class="bad">${escapeHtml(err.message)}</p>`;
      }
    });

    el("review-btn").addEventListener("click", async () => {
      const rating = Number(el("review-rating").value);
      const comment = el("review-comment").value.trim() || undefined;
      const out = el("review-result");
      try {
        await api("/api/trust/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingTxId: txId, rating, comment }),
        });
        out.textContent = "Review published.";
      } catch (err) {
        out.textContent = `Error: ${err.message}`;
      }
    });
  } catch (err) {
    detail.innerHTML = `<p class="bad">${escapeHtml(err.message)}</p>`;
  }
}

el("load-listing-btn").addEventListener("click", () => {
  const txId = el("listing-txid-input").value.trim();
  if (txId) loadListing(txId);
});

// --- Init ---------------------------------------------------------------

loadIdentity();
refreshTopics();
