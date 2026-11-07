/* Council thread. Reads public GitHub issues. Writes only to api.github.com. */
(function () {
  'use strict';

  var REFRESH_MS = Number(document.body.dataset.refreshMs || '20000');
  var STATUS_ORDER = [
    'status:pending',
    'status:approved',
    'status:declined',
    'status:revised',
    'status:working',
    'status:done'
  ];
  var CACHE_KEY = 'council.etagCache.v1';
  var memoryCache = new Map();

  var state = {
    config: null,
    issues: [],
    comments: {},
    token: null,
    login: null,
    connectOpen: false,
    signature: '',
    inFlight: false,
    busy: null,
    errors: {},
    openReasons: {},
    drafts: {}
  };

  function tokenKey() {
    return 'council.githubToken.v1:' + state.config.repo;
  }

  function tz() {
    return (state.config && state.config.timezone) || 'America/New_York';
  }

  function branch() {
    return (state.config && state.config.default_branch) || 'main';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseHeader(body) {
    var result = { agent: null, niche: null, revisionOf: null, sample: false };
    if (!body) return result;
    var match = String(body).match(/<!--\s*council\b([\s\S]*?)-->/i);
    if (!match) return result;
    match[1].split(/\r?\n/).forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx === -1) return;
      var key = line.slice(0, idx).trim().toLowerCase();
      var value = line.slice(idx + 1).trim();
      if (key === 'agent') result.agent = value || null;
      else if (key === 'niche') result.niche = value || null;
      else if (key === 'revision of' || key === 'revision_of' || key === 'revision-of') {
        var num = value.match(/\d+/);
        result.revisionOf = num ? Number(num[0]) : null;
      } else if (key === 'sample') result.sample = /^(true|yes|1)$/i.test(value);
    });
    return result;
  }

  function humanText(body) {
    if (!body) return '';
    return String(body).replace(/<!--\s*council\b[\s\S]*?-->/i, '').trim();
  }

  function labelNames(labels) {
    return (labels || []).map(function (label) {
      return typeof label === 'string' ? label : label && label.name;
    }).filter(Boolean);
  }

  function orderLabels(names) {
    var set = {};
    names.forEach(function (name) { if (name) set[name] = true; });
    var others = Object.keys(set).filter(function (name) {
      return name.indexOf('status:') !== 0;
    }).sort();
    var statuses = STATUS_ORDER.filter(function (name) { return set[name]; });
    var extra = Object.keys(set).filter(function (name) {
      return name.indexOf('status:') === 0 && STATUS_ORDER.indexOf(name) === -1;
    }).sort();
    return others.concat(statuses, extra);
  }

  function transitionLabels(current, action) {
    var others = labelNames(current).filter(function (name) {
      return name.indexOf('status:') !== 0;
    });
    var statuses;
    if (action === 'approve') statuses = ['status:approved', 'status:working'];
    else if (action === 'decline') statuses = ['status:declined'];
    else if (action === 'revised') statuses = ['status:declined', 'status:revised'];
    else throw new Error('unknown label action ' + action);
    return orderLabels(others.concat(statuses));
  }

  function hasLabel(issue, name) {
    return labelNames(issue.labels).indexOf(name) !== -1;
  }

  function agentSlugFromLabels(labels) {
    var names = labelNames(labels);
    for (var i = 0; i < names.length; i++) {
      if (names[i].indexOf('agent:') === 0 && names[i].length > 6) return names[i].slice(6);
    }
    return null;
  }

  function agentForIssue(issue) {
    var header = parseHeader(issue.body || '');
    var slug = header.agent || agentSlugFromLabels(issue.labels);
    var found = null;
    (state.config.agents || []).forEach(function (agent) {
      if (agent.slug === slug) found = agent;
    });
    return {
      slug: slug,
      name: found ? found.name : (slug || 'Agent'),
      number: found ? found.number : null
    };
  }

  function buildChains(issues) {
    var parents = new Map();
    issues.forEach(function (issue) {
      var parent = parseHeader(issue.body || '').revisionOf;
      if (parent === issue.number || parent === 0) parent = null;
      parents.set(issue.number, parent);
    });
    function pathOf(number) {
      var path = [];
      var seen = new Set();
      var current = number;
      while (current != null && !seen.has(current)) {
        seen.add(current);
        path.push(current);
        var parent = parents.get(current);
        if (parent == null || !parents.has(parent)) break;
        current = parent;
      }
      path.reverse();
      return path;
    }
    var children = new Map();
    parents.forEach(function (parent, number) {
      if (parent != null && parents.has(parent)) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(number);
      }
    });
    children.forEach(function (kids) { kids.sort(function (a, b) { return a - b; }); });
    var chainFor = new Map();
    parents.forEach(function (_, number) { chainFor.set(number, pathOf(number)); });
    return { parents: parents, children: children, chainFor: chainFor };
  }

  function chainPaths(group, chains) {
    var numbers = {};
    group.forEach(function (issue) { numbers[issue.number] = true; });
    var leaves = group.filter(function (issue) {
      var kids = chains.children.get(issue.number) || [];
      return !kids.some(function (kid) { return numbers[kid]; });
    });
    var paths = leaves.map(function (issue) {
      return chains.chainFor.get(issue.number) || [issue.number];
    });
    paths.sort(function (a, b) { return a[a.length - 1] - b[b.length - 1]; });
    return paths;
  }

  function threadsOf(issues) {
    var chains = buildChains(issues);
    var groups = new Map();
    issues.forEach(function (issue) {
      var chain = chains.chainFor.get(issue.number) || [issue.number];
      var root = chain[0];
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(issue);
    });
    var threads = [];
    groups.forEach(function (group, root) {
      group.sort(function (a, b) {
        var ca = (chains.chainFor.get(a.number) || []).length;
        var cb = (chains.chainFor.get(b.number) || []).length;
        return ca - cb || a.number - b.number;
      });
      var updated = 0;
      group.forEach(function (issue) {
        var t = Date.parse(issue.updated_at || issue.created_at || 0);
        if (t > updated) updated = t;
      });
      threads.push({
        root: root,
        issues: group,
        updated: updated,
        chains: chains,
        paths: chainPaths(group, chains)
      });
    });
    threads.sort(function (a, b) { return b.updated - a.updated || b.root - a.root; });
    return threads;
  }

  function isPending(issue) {
    var names = labelNames(issue.labels);
    var statuses = names.filter(function (name) { return name.indexOf('status:') === 0; });
    if (!statuses.length) return true;
    if (statuses.indexOf('status:approved') !== -1) return false;
    if (statuses.indexOf('status:working') !== -1) return false;
    if (statuses.indexOf('status:done') !== -1) return false;
    if (statuses.indexOf('status:revised') !== -1) return false;
    return statuses.indexOf('status:pending') !== -1 || statuses.indexOf('status:declined') !== -1;
  }

  function formatTime(iso) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz(),
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(new Date(iso));
  }

  function issueUrl(number) {
    return 'https://github.com/' + state.config.repo + '/issues/' + number;
  }

  function readCache() {
    try {
      var raw = sessionStorage.getItem(CACHE_KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      Object.keys(obj).forEach(function (key) { memoryCache.set(key, obj[key]); });
    } catch (err) { /* private mode */ }
  }

  function writeCache() {
    try {
      var obj = {};
      memoryCache.forEach(function (value, key) { obj[key] = value; });
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch (err) { /* ignore quota */ }
  }

  function nextLink(header) {
    if (!header) return null;
    var match = header.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : null;
  }

  function githubErrorMessage(status, text) {
    var message = '';
    try { message = JSON.parse(text).message || ''; } catch (err) { message = text || ''; }
    if (status === 403 && /rate limit/i.test(message)) {
      return 'GitHub rate limit reached for unsigned reads. Wait and tap Refresh. A 304 does not count against the limit.';
    }
    if (status === 404) return 'GitHub returned 404. The repo must be public for unsigned reads.';
    return message || ('GitHub error ' + status);
  }

  function apiGet(url) {
    var headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    var hit = memoryCache.get(url);
    if (hit && hit.etag) headers['If-None-Match'] = hit.etag;
    return fetch(url, { headers: headers, cache: 'no-store' }).then(function (res) {
      if (res.status === 304) {
        if (!hit) throw new Error('GitHub returned 304 but this browser has no cached copy.');
        return { data: hit.data, link: hit.link || null, notModified: true };
      }
      if (!res.ok) {
        return res.text().then(function (text) {
          throw new Error(githubErrorMessage(res.status, text));
        });
      }
      return res.json().then(function (data) {
        var etag = res.headers.get('ETag');
        var link = res.headers.get('Link');
        if (etag) {
          memoryCache.set(url, { etag: etag, data: data, link: link });
          writeCache();
        }
        return { data: data, link: link, notModified: false };
      });
    });
  }

  function issuesUrl() {
    var url = new URL('https://api.github.com/repos/' + state.config.repo + '/issues');
    url.searchParams.set('state', 'all');
    url.searchParams.set('labels', 'pitch');
    url.searchParams.set('per_page', '100');
    return url.toString();
  }

  function commentsUrl(number) {
    var url = new URL('https://api.github.com/repos/' + state.config.repo + '/issues/' + number + '/comments');
    url.searchParams.set('per_page', '100');
    return url.toString();
  }

  function loadPages(firstUrl) {
    var all = [];
    var seen = {};
    function step(url) {
      if (!url || seen[url]) return Promise.resolve(all);
      seen[url] = true;
      return apiGet(url).then(function (page) {
        if (page.notModified && url === firstUrl && state.issues.length && firstUrl === issuesUrl()) {
          return { notModified: true, data: null };
        }
        all = all.concat(page.data || []);
        return step(nextLink(page.link));
      });
    }
    return step(firstUrl).then(function (result) {
      if (result && result.notModified) return result;
      return { notModified: false, data: all };
    });
  }

  function loadComments(number) {
    return loadPages(commentsUrl(number)).then(function (result) {
      var list = result.data || [];
      list.sort(function (a, b) {
        return String(a.created_at).localeCompare(String(b.created_at)) || (a.id - b.id);
      });
      return list;
    });
  }

  function mapPool(items, limit, fn) {
    var out = new Array(items.length);
    var cursor = 0;
    function worker() {
      if (cursor >= items.length) return Promise.resolve();
      var index = cursor++;
      return fn(items[index], index).then(function (value) {
        out[index] = value;
        return worker();
      });
    }
    var workers = [];
    var count = Math.min(limit, items.length);
    for (var i = 0; i < count; i++) workers.push(worker());
    return Promise.all(workers).then(function () { return out; });
  }

  function apiSend(method, path, body) {
    if (!state.token) return Promise.reject(new Error('Connect GitHub first.'));
    return fetch('https://api.github.com' + path, {
      method: method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer ' + state.token
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) { data = { message: text }; }
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error('GitHub rejected this token. Disconnect and paste a new one.');
          }
          throw new Error((data && data.message) || ('GitHub error ' + res.status));
        }
        return data;
      });
    });
  }

  function signature() {
    return JSON.stringify(state.issues.map(function (issue) {
      var comments = state.comments[issue.number] || [];
      return [
        issue.number,
        issue.updated_at,
        labelNames(issue.labels).join(','),
        comments.map(function (comment) { return comment.id + ':' + (comment.updated_at || comment.created_at); }).join(',')
      ];
    }));
  }

  function captureDrafts() {
    document.querySelectorAll('textarea[data-draft]').forEach(function (box) {
      state.drafts[box.getAttribute('data-draft')] = box.value;
    });
    var active = document.activeElement;
    return active && active.id ? active.id : null;
  }

  function chipHtml(issue) {
    var names = labelNames(issue.labels);
    var header = parseHeader(issue.body || '');
    var chips = [];
    if (names.indexOf('sample') !== -1 || header.sample) chips.push('sample');
    STATUS_ORDER.forEach(function (status) {
      if (names.indexOf(status) !== -1) chips.push(status.split(':')[1]);
    });
    return '<div class="chips" data-testid="statuses-' + issue.number + '">' +
      chips.map(function (chip) {
        return '<span class="chip ' + escapeHtml(chip) + '">' + escapeHtml(chip) + '</span>';
      }).join('') + '</div>';
  }

  function messageHtml(from, title, timeIso, timeId, body, testId) {
    var testAttr = testId ? ' data-testid="' + testId + '"' : '';
    return '<div class="msg ' + from + '" data-from="' + from + '"' + testAttr + '>' +
      '<div class="meta"><b>' + escapeHtml(title) + '</b>' +
      '<time data-testid="' + timeId + '" data-timezone="' + escapeHtml(tz()) + '" datetime="' + escapeHtml(timeIso) + '">' +
      escapeHtml(formatTime(timeIso)) + '</time></div>' +
      '<div class="body">' + escapeHtml(body) + '</div></div>';
  }

  function actionsHtml(issue) {
    if (!isPending(issue)) return '';
    var number = issue.number;
    var href = issueUrl(number);
    if (!state.token) {
      return '<p class="fallback" data-testid="fallback-' + number + '">No token in this browser. These buttons open the issue on GitHub. Comment as @' +
        escapeHtml(state.config.owner) + ', with the first line <code>/approve</code> or <code>/decline</code> and an optional reason. Only the repo owner\'s comment starts the agent.</p>' +
        '<div class="actions">' +
        '<a class="approve btn" data-testid="approve-' + number + '" data-approve="' + number + '" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">Approve</a>' +
        '<a class="decline btn" data-testid="decline-' + number + '" data-decline="' + number + '" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">Decline</a>' +
        '</div>';
    }
    var open = state.openReasons[String(number)] ? '' : ' hidden';
    var draft = state.drafts[String(number)] || '';
    var err = state.errors[number];
    var disabled = state.busy === number ? ' disabled' : '';
    return '<div class="actions">' +
      '<button type="button" class="approve" data-testid="approve-' + number + '" data-approve="' + number + '"' + disabled + '>Approve</button>' +
      '<button type="button" class="decline" data-testid="decline-' + number + '" data-decline="' + number + '"' + disabled + '>Decline</button>' +
      '</div>' +
      '<form class="reason" data-testid="reason-' + number + '" data-decline-form="' + number + '"' + open + '>' +
      '<label for="reason-input-' + number + '">Reason (optional)</label>' +
      '<textarea id="reason-input-' + number + '" data-testid="decline-reason-' + number + '" data-draft="' + number + '">' + escapeHtml(draft) + '</textarea>' +
      '<button type="submit" data-testid="decline-send-' + number + '"' + disabled + '>Send decline</button>' +
      '<button type="button" class="ghost" data-cancel="' + number + '">Cancel</button>' +
      '</form>' +
      (err ? '<p class="form-error" data-testid="action-error-' + number + '">' + escapeHtml(err) + '</p>' : '');
  }

  function render() {
    var focusId = captureDrafts();
    var root = document.getElementById('threads');
    var issues = state.issues.filter(function (issue) {
      return !issue.pull_request && labelNames(issue.labels).indexOf('pitch') !== -1;
    });
    if (!issues.length) {
      root.innerHTML = '<p class="empty" data-testid="empty">No pitches yet. After this is on main, run Actions → Post sample pitch.</p>';
      return;
    }
    var anySample = issues.some(function (issue) {
      return hasLabel(issue, 'sample') || parseHeader(issue.body || '').sample;
    });
    var html = '';
    if (anySample) {
      html += '<p class="banner" data-testid="sample-banner">SAMPLE / stub pitches are not research. Approving one only runs the stub in this repo.</p>';
    }
    html += '<p class="rules">One niche, this repo only. Decline posts a revised pitch. Approve writes council/tasks/&lt;issue&gt;.md on ' + escapeHtml(branch()) + '.</p>';
    threadsOf(issues).forEach(function (thread) {
      var rootIssue = thread.issues[0];
      var agent = agentForIssue(rootIssue);
      var chainBits = thread.paths.map(function (path) {
        return path.map(function (number) {
          return '<a href="' + escapeHtml(issueUrl(number)) + '">#' + number + '</a>';
        }).join(' → ');
      }).join('<br>');
      var showChain = thread.paths.some(function (path) { return path.length > 1; });
      html += '<section class="thread" data-testid="thread-' + thread.root + '">';
      html += '<h2>' + escapeHtml(agent.name) + '</h2>';
      if (showChain) {
        html += '<p class="chain" data-testid="chain-' + thread.root + '">Revision chain: ' + chainBits + '</p>';
      }
      thread.issues.forEach(function (issue) {
        var who = agentForIssue(issue);
        var header = parseHeader(issue.body || '');
        var comments = state.comments[issue.number] || [];
        html += '<article class="pitch" data-testid="pitch-' + issue.number + '">';
        html += '<p class="gh-link"><a href="' + escapeHtml(issue.html_url || issueUrl(issue.number)) + '" target="_blank" rel="noopener noreferrer">#' + issue.number + ' on GitHub</a></p>';
        if (header.revisionOf) {
          html += '<p class="revises">Revises <a href="' + escapeHtml(issueUrl(header.revisionOf)) + '">#' + header.revisionOf + '</a></p>';
        }
        html += messageHtml('agent', who.name, issue.created_at, 'time-' + issue.number, humanText(issue.body || ''));
        html += chipHtml(issue);
        if (hasLabel(issue, 'status:working') || hasLabel(issue, 'status:approved')) {
          var taskHref = 'https://github.com/' + state.config.repo + '/blob/' + branch() + '/council/tasks/' + issue.number + '.md';
          html += '<p class="gh-link"><a href="' + escapeHtml(taskHref) + '">Task file</a></p>';
        }
        comments.forEach(function (comment) {
          var login = (comment.user && comment.user.login) || 'unknown';
          var from = login === state.config.owner ? 'owner' : 'agent';
          var title = login === state.config.owner ? 'Joey' : login;
          html += messageHtml(from, title, comment.created_at, 'time-comment-' + comment.id, comment.body || '', 'comment-' + comment.id);
        });
        html += actionsHtml(issue);
        html += '</article>';
      });
      html += '</section>';
    });
    root.innerHTML = html;
    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) el.focus();
    }
  }

  function setStatus(text, mode) {
    var node = document.getElementById('status');
    node.textContent = text;
    if (mode) node.setAttribute('data-fetch', mode);
  }

  function applyLocalUpdate(number, issue, comment) {
    var idx = -1;
    state.issues.forEach(function (item, i) { if (item.number === number) idx = i; });
    if (idx >= 0 && issue) {
      var labels = issue.labels || state.issues[idx].labels;
      state.issues[idx] = Object.assign({}, state.issues[idx], issue, {
        labels: (labels || []).map(function (label) {
          return typeof label === 'string' ? { name: label } : label;
        })
      });
    }
    if (comment) {
      if (!state.comments[number]) state.comments[number] = [];
      state.comments[number].push(comment);
    }
    delete state.errors[number];
    state.signature = signature();
    render();
  }

  function runCommand(number, action, commentBody) {
    var issue = null;
    state.issues.forEach(function (item) { if (item.number === number) issue = item; });
    if (!issue || !state.token) return Promise.resolve();
    state.busy = number;
    delete state.errors[number];
    render();
    var path = '/repos/' + state.config.repo + '/issues/' + number;
    return apiSend('POST', path + '/comments', { body: commentBody }).then(function (comment) {
      var labels = transitionLabels(issue.labels, action);
      return apiSend('PATCH', path, { labels: labels }).then(function (updated) {
        state.busy = null;
        if (action === 'decline') delete state.openReasons[String(number)];
        applyLocalUpdate(number, updated, comment);
      });
    }).catch(function (err) {
      state.busy = null;
      state.errors[number] = err.message || String(err);
      render();
    });
  }

  function onThreadClick(event) {
    var cancel = event.target.closest('[data-cancel]');
    if (cancel) {
      delete state.openReasons[cancel.getAttribute('data-cancel')];
      render();
      return;
    }
    var decline = event.target.closest('[data-decline]');
    if (decline && decline.tagName === 'BUTTON') {
      state.openReasons[decline.getAttribute('data-decline')] = true;
      render();
      var box = document.getElementById('reason-input-' + decline.getAttribute('data-decline'));
      if (box) box.focus();
      return;
    }
    var approve = event.target.closest('[data-approve]');
    if (approve && approve.tagName === 'BUTTON') {
      event.preventDefault();
      runCommand(Number(approve.getAttribute('data-approve')), 'approve', '/approve');
    }
  }

  function onThreadSubmit(event) {
    var form = event.target.closest('form[data-decline-form]');
    if (!form) return;
    event.preventDefault();
    var number = Number(form.getAttribute('data-decline-form'));
    var box = form.querySelector('textarea');
    var reason = box ? box.value.trim() : '';
    state.drafts[String(number)] = reason;
    var body = reason ? '/decline ' + reason : '/decline';
    runCommand(number, 'decline', body);
  }

  function updateAuthUi() {
    var connected = Boolean(state.token);
    document.getElementById('disconnect').hidden = !connected;
    document.getElementById('connect-toggle').hidden = connected;
    document.getElementById('connect-panel').hidden = connected || !state.connectOpen;
    var who = document.getElementById('who');
    who.hidden = !connected;
    who.textContent = connected ? 'Connected as @' + state.login + '. The token stays in this browser\'s localStorage and is sent only to api.github.com.' : '';
  }

  function saveToken() {
    var input = document.getElementById('token');
    var error = document.getElementById('connect-error');
    var token = input.value.trim();
    if (!token) {
      error.hidden = false;
      error.textContent = 'Paste a token first.';
      return;
    }
    error.hidden = true;
    fetch('https://api.github.com/user', {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: 'Bearer ' + token
      }
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = {};
        try { data = text ? JSON.parse(text) : {}; } catch (err) { data = {}; }
        if (!res.ok) throw new Error(data.message || 'GitHub rejected this token.');
        if (data.login !== state.config.owner) {
          throw new Error('This token is for @' + data.login + '. Approve and decline only run as @' + state.config.owner + '.');
        }
        state.token = token;
        state.login = data.login;
        localStorage.setItem(tokenKey(), token);
        input.value = '';
        state.connectOpen = false;
        updateAuthUi();
        render();
      });
    }).catch(function (err) {
      error.hidden = false;
      error.textContent = err.message || String(err);
    });
  }

  function disconnect() {
    state.token = null;
    state.login = null;
    state.connectOpen = false;
    localStorage.removeItem(tokenKey());
    var input = document.getElementById('token');
    if (input) input.value = '';
    updateAuthUi();
    render();
  }

  function refresh() {
    if (state.inFlight || !state.config || state.busy) return Promise.resolve();
    state.inFlight = true;
    var listUrl = issuesUrl();
    var mode = '200';
    return loadPages(listUrl).then(function (result) {
      if (result.notModified) {
        mode = '304';
        return null;
      }
      var issues = (result.data || []).filter(function (issue) {
        return !issue.pull_request && labelNames(issue.labels).indexOf('pitch') !== -1;
      });
      return mapPool(issues, 6, function (issue) {
        return loadComments(issue.number);
      }).then(function (lists) {
        var comments = {};
        issues.forEach(function (issue, index) { comments[issue.number] = lists[index]; });
        state.issues = issues;
        state.comments = comments;
      });
    }).then(function () {
      var sig = signature();
      var changed = sig !== state.signature;
      state.signature = sig;
      if (changed) render();
      setStatus('Updated ' + formatTime(new Date().toISOString()) + ' · refreshes every ' + (REFRESH_MS / 1000) + 's', mode);
    }).catch(function (err) {
      setStatus(err.message || String(err), 'error');
      if (!state.issues.length) {
        document.getElementById('threads').innerHTML = '<p class="error" data-testid="error" role="alert">' + escapeHtml(err.message || String(err)) + '</p>';
      }
    }).then(function () {
      state.inFlight = false;
    });
  }

  function bind() {
    document.getElementById('threads').addEventListener('click', onThreadClick);
    document.getElementById('threads').addEventListener('submit', onThreadSubmit);
    document.getElementById('refresh').addEventListener('click', function () { refresh(); });
    document.getElementById('connect-toggle').addEventListener('click', function () {
      state.connectOpen = true;
      updateAuthUi();
      var input = document.getElementById('token');
      if (input) input.focus();
    });
    document.getElementById('disconnect').addEventListener('click', disconnect);
    document.getElementById('save-token').addEventListener('click', saveToken);
  }

  function boot() {
    readCache();
    bind();
    setInterval(function () { refresh(); }, REFRESH_MS);
    fetch(new URL('config.json', window.location.href), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load council/config.json');
      return res.json();
    }).then(function (config) {
      state.config = config;
      var repoName = document.querySelector('[data-testid="repo-name"]');
      if (repoName) repoName.textContent = config.repo;
      var saved = localStorage.getItem(tokenKey());
      if (saved) {
        state.token = saved;
        state.login = config.owner;
        updateAuthUi();
      }
      return refresh();
    }).catch(function (err) {
      setStatus(err.message || String(err));
    });
  }

  boot();
})();
