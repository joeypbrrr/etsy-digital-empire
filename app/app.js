const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function safeUrl(u) {
  try {
    const url = new URL(u, location.href);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch (e) { /* ignore */ }
  return '';
}

const money = (n) => '$' + Number(n).toFixed(2);
const pct = (n) => Number(n).toFixed(1) + '%';

function combinedOf(p) {
  return Number(p.margin_score) + Number(p.validation_score);
}

function rankProducts(products) {
  return [...products].sort((a, b) =>
    combinedOf(b) - combinedOf(a) ||
    Number(b.validation_score) - Number(a.validation_score) ||
    Number(a.rank) - Number(b.rank)
  );
}

const PARTS = [
  ['demand', 'Demand', 15],
  ['proven_sales', 'Proven sales', 15],
  ['competition_gap', 'Competition gap', 10],
  ['repeat', 'Repeat', 10],
];

let preview = null;
let ranked = [];

function render(data, products) {
  preview = data;
  const byName = Object.fromEntries(data.agents.map((a) => [a.id, a]));
  const proposerByProduct = Object.fromEntries(data.proposers.map((p) => [p.product, p]));
  ranked = rankProducts(products);

  document.getElementById('steps').innerHTML = data.workflow.map((s) =>
    `<li class="glass"><b>${esc(s.step)}</b><strong>${esc(s.name)}</strong><span>${esc(s.text)}</span><em>${esc(s.who)}</em></li>`
  ).join('');

  document.getElementById('shops-note').textContent = data.shops_note;
  document.getElementById('shop-list').innerHTML = data.shops.map((s) => {
    const href = safeUrl(s.url);
    const rating = typeof s.rating === 'number' ? ` · ${s.rating} rating` : '';
    return `<a class="shop glass" href="${esc(href)}" target="_blank" rel="noopener noreferrer"><p class="go">Etsy shop</p><h3>${esc(s.name)}</h3><p>${esc(s.sales_label)}${esc(rating)}</p></a>`;
  }).join('');

  document.getElementById('board-rows').innerHTML = ranked.map((p, i) => {
    const who = proposerByProduct[p.product];
    const agent = who ? byName[who.agent_id] : null;
    const parts = p.validation_breakdown || {};
    const partHtml = PARTS.map(([key, label, max]) =>
      `<div><dt>${label}</dt><dd>${esc(parts[key])}<span>/${max}</span></dd></div>`
    ).join('');
    const evidence = Array.isArray(p.evidence) ? p.evidence : [];
    const links = evidence.map((e) => {
      const href = safeUrl(e.url);
      return `<li><a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(e.label)}</a></li>`;
    }).join('');
    const repeat = p.repeat_buyer
      ? '<span class="tag repeat">Repeat buyer</span>'
      : '<span class="tag once">Not a repeat buyer</span>';
    const n = i + 1;
    return `<article class="rank-row glass" id="pick-${n}" data-rank="${n}" data-file-rank="${esc(p.rank)}" data-combined="${combinedOf(p)}" data-margin="${esc(p.margin_score)}" data-validation="${esc(p.validation_score)}" data-margin-pct="${esc(p.margin_pct)}" data-net="${esc(p.net_per_sale_usd)}" data-product="${esc(p.product)}" data-proposer="${esc(agent ? agent.name : '')}">
      <div class="rank">${String(n).padStart(2, '0')}</div>
      <div class="pmain">
        <div class="ph"><h3>${esc(p.product)}</h3>${repeat}</div>
        <p class="meta">${esc(p.category || '')}${agent ? ` · Proposed by <a href="#${esc(agent.id)}">${esc(agent.name)}</a>` : ''}</p>
        ${who ? `<p class="because">Studio role, not a tracker field. ${esc(who.because)}</p>` : ''}
        <dl class="bits">
          <div><dt>Margin</dt><dd>${pct(p.margin_pct)}</dd></div>
          <div><dt>Net per sale</dt><dd>${money(p.net_per_sale_usd)}</dd></div>
          <div><dt>Typical price</dt><dd>${money(p.typical_price_usd)}</dd></div>
        </dl>
        <dl class="parts">
          <div><dt>Margin score</dt><dd>${esc(p.margin_score)}<span>/50</span></dd></div>
          <div><dt>Validation score</dt><dd>${esc(p.validation_score)}<span>/50</span></dd></div>
          ${partHtml}
        </dl>
        <p class="why"><b>Why</b> ${esc(p.why)}</p>
        <p class="risks"><b>Risks</b> ${esc(p.risks)}</p>
        <ul class="evidence">${links}</ul>
      </div>
      <div class="combined">${combinedOf(p)}<small>combined</small></div>
    </article>`;
  }).join('');

  const owned = {};
  for (const p of ranked) {
    const who = proposerByProduct[p.product];
    if (!who) continue;
    (owned[who.agent_id] || (owned[who.agent_id] = [])).push(p);
  }

  document.getElementById('agent-list').innerHTML = data.agents.map((a) => {
    const picks = owned[a.id] || [];
    const pickHtml = picks.length
      ? `<h4>On the research board</h4><ul class="research-links">${picks.map((p) => {
          const n = ranked.indexOf(p) + 1;
          return `<li><a href="#pick-${n}">${esc(p.product)}</a></li>`;
        }).join('')}</ul>`
      : '';
    return `<article class="agent glass" id="${esc(a.id)}" data-agent-section="${esc(a.id)}">
      <span class="tag sample">Sample</span>
      <h3>${esc(a.name)}</h3>
      <p class="role-meta">${esc(a.phase)} · <code>${esc(a.folder)}</code></p>
      <h4>Current task</h4>
      <p>${esc(a.task)}</p>
      <h4>Ideas</h4>
      <ul>${a.ideas.map((idea) => `<li>${esc(idea)}</li>`).join('')}</ul>
      <h4>Findings</h4>
      <ul>${a.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      ${pickHtml}
      <button type="button" data-focus-agent="${esc(a.id)}">Show in the studio</button>
    </article>`;
  }).join('');

  window.__rankedPreview = ranked.map((p, i) => ({
    rank: i + 1,
    product: p.product,
    combined: combinedOf(p),
    margin_score: p.margin_score,
    validation_score: p.validation_score,
    margin_pct: p.margin_pct,
    net_per_sale_usd: p.net_per_sale_usd,
    repeat_buyer: p.repeat_buyer,
    why: p.why,
    risks: p.risks,
    evidence: p.evidence,
    proposer: (proposerByProduct[p.product] && byName[proposerByProduct[p.product].agent_id].name) || '',
  }));
}

function showCard(id) {
  const card = document.getElementById('agent-card');
  const a = preview?.agents.find((x) => x.id === id);
  if (!card || !a) return;
  const picks = (window.__rankedPreview || []).filter((p) => {
    const who = preview.proposers.find((x) => x.product === p.product);
    return who && who.agent_id === id;
  });
  const pickLine = picks.length
    ? `<p><b>Board</b> ${esc(picks.map((p) => p.product).join('; '))}</p>`
    : '';
  card.hidden = false;
  card.innerHTML = `<button class="x" type="button" aria-label="Close">×</button><span class="eyebrow">${esc(a.phase)} · sample card</span><h3>${esc(a.name)}</h3><p><b>Task</b> ${esc(a.task)}</p><p><b>Idea</b> ${esc(a.ideas[0] || '')}</p><p><b>Finding</b> ${esc(a.findings[0] || '')}</p>${pickLine}`;
  card.querySelector('.x').onclick = () => {
    card.hidden = true;
    window.highlightAgent?.(null);
  };
  document.querySelectorAll('[data-agent-section]').forEach((el) => {
    el.classList.toggle('is-selected', el.dataset.agentSection === id);
  });
}

window.selectAgent = (id) => {
  window.__selectedAgent = id;
  showCard(id);
  window.highlightAgent?.(id);
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-focus-agent]');
  if (!btn) return;
  const id = btn.dataset.focusAgent;
  window.selectAgent(id);
  const wrap = document.querySelector('.scene-wrap');
  if (!wrap || wrap.classList.contains('no3d')) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (document.body.dataset.view !== 'interior') {
    document.querySelector('[data-view="interior"]')?.click();
    setTimeout(() => window.highlightAgent?.(id), 450);
  }
});

Promise.all([
  fetch('data/preview.json').then((r) => { if (!r.ok) throw new Error('preview'); return r.json(); }),
  fetch('data/top10.json').then((r) => { if (!r.ok) throw new Error('top10'); return r.json(); }),
]).then(([data, products]) => {
  render(data, products);
}).catch(() => {
  const board = document.getElementById('board-rows');
  if (board) board.innerHTML = '<p class="snapshot glass">The research file or the preview file did not load.</p>';
});
