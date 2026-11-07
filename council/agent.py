#!/usr/bin/env python3
"""Stub council agent. Python standard library only.

Commands:
  labels                 Create the pitch, status, sample, and agent labels.
  pitch <agent-slug>     Open a SAMPLE pitch issue. Not research.
  revise <issue-number>  Read the decline reason and open a revised SAMPLE pitch.
  start <issue-number>   Comment "Starting work on this now" and write the task file.
  handle-comment         Used by the Council workflow. Reads GITHUB_EVENT_PATH.

Environment:
  GITHUB_TOKEN              sent only to api.github.com
  GITHUB_REPOSITORY         owner/name; falls back to council/config.json
  GITHUB_REPOSITORY_OWNER   who is allowed to approve or decline
  GITHUB_EVENT_PATH         workflow event payload for handle-comment
  COUNCIL_BRANCH            branch for council/tasks/<issue>.md (default main)

Sample pitches are labeled `sample`. This program does not post to Etsy,
spend money, or contact anyone.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

START_COMMENT = "Starting work on this now"

STATUS_ORDER = (
    "status:pending",
    "status:approved",
    "status:declined",
    "status:revised",
    "status:working",
    "status:done",
)

USAGE = """\
Usage:
  python3 council/agent.py labels
  python3 council/agent.py pitch <agent-slug>
  python3 council/agent.py revise <issue-number>
  python3 council/agent.py start <issue-number>
  python3 council/agent.py handle-comment
"""

_HEADER_RE = re.compile(r"<!--\s*council\b(.*?)-->", re.IGNORECASE | re.DOTALL)
_COMMAND_RE = re.compile(r"^/(approve|decline)\b[ \t]*([\s\S]*)$", re.IGNORECASE)
_SLUG_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_NEXT_LINK_RE = re.compile(r'<([^>]+)>;\s*rel="next"')


class GitHubError(RuntimeError):
    def __init__(self, status, body):
        self.status = status
        text = body if isinstance(body, str) else json.dumps(body)
        self.body = text[:800]
        super().__init__(f"{status}: {self.body[:500]}")


def parse_issue_ref(value):
    """Pull an issue number out of '#12', '12', or 'issue #12'. None if absent."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("none", "null", "-"):
        return None
    match = re.search(r"\d+", text)
    if not match:
        return None
    return int(match.group(0))


def parse_header(body):
    """Parse the machine-readable council header from an issue body.

    Recognized lines inside `<!-- council ... -->`:
      agent: <slug>
      niche: <text>
      revision of: #N     also revision_of / revision-of
      sample: true|false
    """
    result = {"agent": None, "niche": None, "revision_of": None, "sample": False}
    if not body:
        return result
    match = _HEADER_RE.search(body)
    if not match:
        return result
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower()
        value = value.strip()
        if key == "agent":
            result["agent"] = value or None
        elif key == "niche":
            result["niche"] = value or None
        elif key in ("revision of", "revision_of", "revision-of"):
            result["revision_of"] = parse_issue_ref(value)
        elif key == "sample":
            result["sample"] = value.lower() in ("true", "yes", "1")
    return result


def human_text(body):
    """Issue body with the council header comment removed."""
    if not body:
        return ""
    return _HEADER_RE.sub("", body).strip()


def render_header(agent, niche, revision_of=None, sample=False):
    lines = ["<!-- council", f"agent: {agent}", f"niche: {niche}"]
    if revision_of is not None:
        lines.append(f"revision of: #{int(revision_of)}")
    if sample:
        lines.append("sample: true")
    lines.append("-->")
    return "\n".join(lines)


def parse_command(body):
    """Return ('approve', '') or ('decline', reason), or None.

    The command must be the first text of the comment. `/approved` is not
    `/approve`. A decline reason may continue on later lines.
    """
    if body is None:
        return None
    text = str(body).strip()
    match = _COMMAND_RE.match(text)
    if not match:
        return None
    action = match.group(1).lower()
    rest = (match.group(2) or "").strip()
    if action == "approve":
        return ("approve", "")
    return ("decline", rest)


def label_names(labels):
    names = []
    for label in labels or []:
        if isinstance(label, str):
            names.append(label)
        elif isinstance(label, dict) and label.get("name"):
            names.append(label["name"])
    return names


def order_labels(names):
    unique = []
    seen = set()
    for name in names:
        if name and name not in seen:
            seen.add(name)
            unique.append(name)
    others = sorted(name for name in unique if not name.startswith("status:"))
    statuses = [name for name in STATUS_ORDER if name in seen]
    extra = sorted(
        name for name in unique if name.startswith("status:") and name not in STATUS_ORDER
    )
    return others + statuses + extra


def transition_labels(current, action):
    """Replace status labels. Other labels (pitch, agent, sample) stay."""
    others = [name for name in label_names(current) if not name.startswith("status:")]
    if action == "approve":
        statuses = ["status:approved", "status:working"]
    elif action == "decline":
        statuses = ["status:declined"]
    elif action == "revised":
        statuses = ["status:declined", "status:revised"]
    elif action == "pending":
        statuses = ["status:pending"]
    elif action == "done":
        statuses = ["status:done"]
    else:
        raise ValueError(f"unknown label action {action!r}")
    return order_labels(others + statuses)


def labels_for_pitch(slug, sample=False):
    names = ["pitch", f"agent:{slug}", "status:pending"]
    if sample:
        names.append("sample")
    return order_labels(names)


def agent_slug_from_labels(labels):
    for name in label_names(labels):
        if name.startswith("agent:") and len(name) > len("agent:"):
            return name.split(":", 1)[1]
    return None


def build_revision_chains(issues):
    """Link pitches through `revision_of`.

    Each item is a mapping with `number` and either `revision_of` or `body`.
    A parent that is not in the set starts a new root. Cycles stay finite:
    walking stops when a number repeats.
    """
    parents = {}
    for issue in issues:
        number = int(issue["number"])
        if "revision_of" in issue:
            parent = issue.get("revision_of")
        else:
            parent = parse_header(issue.get("body") or "").get("revision_of")
        if parent is not None and parent != "":
            parent = int(parent)
            if parent == number or parent <= 0:
                parent = None
        else:
            parent = None
        parents[number] = parent

    def path_of(number):
        path = []
        seen = set()
        current = number
        while current is not None and current not in seen:
            seen.add(current)
            path.append(current)
            parent = parents.get(current)
            if parent is None or parent not in parents:
                break
            current = parent
        path.reverse()
        return path

    children = {}
    for number, parent in parents.items():
        if parent is not None and parent in parents:
            children.setdefault(parent, []).append(number)
    for kids in children.values():
        kids.sort()

    roots = sorted(
        number
        for number, parent in parents.items()
        if parent is None or parent not in parents
    )
    return {
        "parent": parents,
        "children": children,
        "roots": roots,
        "chain_for": {number: path_of(number) for number in parents},
    }


def next_link(header):
    if not header:
        return None
    for part in header.split(","):
        match = _NEXT_LINK_RE.search(part.strip())
        if match:
            return match.group(1)
    return None


def decode_github_content(payload):
    if not payload:
        return ""
    content = payload.get("content") or ""
    if payload.get("encoding") == "base64":
        return base64.b64decode(content).decode()
    return content


def find_agent(config, slug):
    for agent in config.get("agents") or []:
        if agent.get("slug") == slug:
            return agent
    return None


def require_agent(config, slug):
    agent = find_agent(config, slug)
    if agent:
        return agent
    known = ", ".join(item.get("slug", "") for item in config.get("agents") or [])
    raise ValueError(f"Unknown agent {slug!r}. Known: {known}")


def validate_config(config):
    if not isinstance(config, dict):
        raise ValueError("config must be a JSON object")
    for key in ("repo", "owner", "niche", "agents"):
        if not config.get(key):
            raise ValueError(f"config missing {key}")
    if str(config["repo"]).count("/") != 1:
        raise ValueError("config.repo must be owner/name")
    agents = config["agents"]
    if not isinstance(agents, list):
        raise ValueError("config.agents must be a list")
    slugs = set()
    for agent in agents:
        if not isinstance(agent, dict):
            raise ValueError("each agent must be an object")
        for key in ("slug", "name", "folder", "task"):
            if not str(agent.get(key) or "").strip():
                raise ValueError(f"agent missing {key}")
        slug = agent["slug"]
        if not _SLUG_RE.fullmatch(slug):
            raise ValueError(f"bad slug {slug!r}")
        if slug in slugs:
            raise ValueError(f"duplicate slug {slug}")
        slugs.add(slug)
    config.setdefault("timezone", "America/New_York")
    config.setdefault("default_branch", "main")
    return config


def load_config(path=None):
    file = Path(path) if path else Path(__file__).with_name("config.json")
    with file.open(encoding="utf-8") as handle:
        data = json.load(handle)
    return validate_config(data)


def label_catalog(config):
    rows = [
        ("pitch", "8250DF", "Council pitch"),
        ("sample", "E4E669", "Sample stub. Not real research."),
        ("status:pending", "FBCA04", "Waiting for the owner"),
        ("status:approved", "0E8A16", "Owner approved this pitch"),
        ("status:declined", "D93F0B", "Owner declined this pitch"),
        ("status:revised", "C5DEF5", "A newer pitch revises this one"),
        ("status:working", "5319E7", "Agent has started"),
        ("status:done", "BFD4F2", "Owner marked the work finished"),
    ]
    for agent in config["agents"]:
        rows.append((f"agent:{agent['slug']}", "1D76DB", agent["name"][:100]))
    return rows


def render_sample_pitch(agent, config, revision_of=None, decline_reason=None):
    """Build a SAMPLE pitch. The text is a stub generated from config, not research."""
    niche = config["niche"]
    header = render_header(
        agent=agent["slug"],
        niche=niche,
        revision_of=revision_of,
        sample=True,
    )
    if revision_of is None:
        title = f"[SAMPLE] {agent['name']} pitch"
        reason_block = ""
    else:
        title = f"[SAMPLE] {agent['name']} revises #{int(revision_of)}"
        shown = (decline_reason or "").strip() or "No reason was given."
        reason_block = (
            f"This is a revision of #{int(revision_of)}.\n"
            f"The owner declined that pitch. Reason: {shown}\n"
            "This revision addresses that reason.\n\n"
        )
    text = (
        "SAMPLE / stub. Not research. No sources, prices, or demand figures. "
        "This is not a real recommendation. It does not post to Etsy, spend money, "
        "or contact anyone.\n\n"
        f"{reason_block}"
        f"Agent: {agent['name']}\n"
        f"Niche: {niche}\n"
        f"Task: {agent['task']}\n"
        f"Output folder: {agent['folder']}\n\n"
        "Ask: approve to start the stub, or decline with what should change.\n"
    )
    return title, header + "\n\n" + text


def task_path(number):
    number = int(number)
    if number <= 0:
        raise ValueError("issue number must be positive")
    return f"council/tasks/{number}.md"


def render_task_file(issue, config, started_at=None):
    number = int(issue["number"])
    header = parse_header(issue.get("body") or "")
    slug = header.get("agent") or agent_slug_from_labels(issue.get("labels")) or "unknown"
    agent = find_agent(config, slug)
    name = agent["name"] if agent else slug
    folder = agent["folder"] if agent else ""
    started = started_at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    human = human_text(issue.get("body") or "")
    return "\n".join(
        [
            f"# Task {number}",
            "",
            f"- Agent: {name} (`{slug}`)",
            f"- Niche: {config.get('niche', '')}",
            f"- Issue: https://github.com/{config['repo']}/issues/{number}",
            f"- Output folder: {folder}",
            f"- Started: {started}",
            "- Status: working",
            "",
            "## Pitch",
            "",
            human or "(empty pitch)",
            "",
            "## Stub",
            "",
            "This file was written by the council stub (`council/agent.py start`) when the pitch was approved.",
            "It is not research. It does not post to a marketplace, spend money, or contact anyone.",
            "",
        ]
    )


def latest_decline_reason(comments, owner=None):
    """Last /decline from `owner` (or from anyone, if owner is omitted)."""
    reason = None
    found = False
    ordered = sorted(
        comments or [],
        key=lambda comment: (comment.get("created_at") or "", comment.get("id") or 0),
    )
    for comment in ordered:
        login = ((comment.get("user") or {}).get("login")) or ""
        if owner and login != owner:
            continue
        parsed = parse_command(comment.get("body") or "")
        if parsed and parsed[0] == "decline":
            reason = parsed[1]
            found = True
    return reason if found else None


def ensure_labels(gh, config):
    for name, color, description in label_catalog(config):
        gh.ensure_label(name, color, description)
    print(f"labels ready ({len(label_catalog(config))})", flush=True)


def pitch(gh, config, slug):
    agent = require_agent(config, slug)
    ensure_labels(gh, config)
    title, body = render_sample_pitch(agent, config)
    created = gh.create_issue(title, body, labels_for_pitch(agent["slug"], sample=True))
    repo = getattr(gh, "repository", None) or config["repo"]
    url = created.get("html_url") or f"https://github.com/{repo}/issues/{created['number']}"
    print(url, flush=True)
    return created


def find_child_revision(gh, number):
    number = int(number)
    for issue in gh.list_issues("pitch"):
        if issue.get("pull_request"):
            continue
        header = parse_header(issue.get("body") or "")
        if header.get("revision_of") == number:
            return issue
    return None


def revise(gh, config, number, reason=None):
    number = int(number)
    issue = gh.get_issue(number)
    header = parse_header(issue.get("body") or "")
    slug = header.get("agent") or agent_slug_from_labels(issue.get("labels"))
    if not slug:
        raise ValueError(f"#{number} has no agent in the header or labels")
    agent = require_agent(config, slug)
    if reason is None:
        reason = latest_decline_reason(gh.list_comments(number), config.get("owner"))
    existing = find_child_revision(gh, number)
    if existing:
        print(f"#{number} already revised as #{existing['number']}", flush=True)
        parent = gh.get_issue(number)
        gh.set_labels(number, transition_labels(parent.get("labels"), "revised"))
        return existing
    ensure_labels(gh, config)
    title, body = render_sample_pitch(
        agent, config, revision_of=number, decline_reason=reason or ""
    )
    created = gh.create_issue(title, body, labels_for_pitch(agent["slug"], sample=True))
    parent = gh.get_issue(number)
    gh.set_labels(number, transition_labels(parent.get("labels"), "revised"))
    gh.add_comment(number, f"Revised pitch posted as #{created['number']}.")
    print(f"revised #{number} -> #{created['number']}", flush=True)
    return created


def start(gh, config, number):
    number = int(number)
    issue = gh.get_issue(number)
    comments = gh.list_comments(number)
    if any((comment.get("body") or "").strip() == START_COMMENT for comment in comments):
        print(f"#{number} already has the start comment", flush=True)
    else:
        gh.add_comment(number, START_COMMENT)
    branch = os.environ.get("COUNCIL_BRANCH") or config.get("default_branch") or "main"
    path = task_path(number)
    gh.put_file(
        path,
        render_task_file(issue, config),
        f"Council: start work on #{number}",
        branch=branch,
    )
    print(f"started #{number} -> {path} on {branch}", flush=True)
    return {"number": number, "path": path, "branch": branch}


def handle_comment(gh, config, event, owner):
    """Act on the owner's /approve or /decline. Anyone else is a no-op."""
    if not event:
        raise ValueError("No GitHub event payload. Set GITHUB_EVENT_PATH.")
    comment = event.get("comment") or {}
    issue = event.get("issue") or {}
    user = ((comment.get("user") or {}).get("login")) or ""
    if user != owner:
        print(f"skip: @{user or 'unknown'} is not the owner @{owner}", flush=True)
        return 0
    if issue.get("pull_request"):
        print("skip: pull request comment", flush=True)
        return 0
    parsed = parse_command(comment.get("body") or "")
    if not parsed:
        print("skip: comment is not /approve or /decline", flush=True)
        return 0
    if "number" not in issue:
        raise ValueError("event issue has no number")
    number = int(issue["number"])
    full = gh.get_issue(number)
    if "pitch" not in label_names(full.get("labels")):
        print(f"skip: #{number} is not labeled pitch", flush=True)
        return 0
    action, reason = parsed
    if action == "approve":
        gh.set_labels(number, transition_labels(full.get("labels"), "approve"))
        start(gh, config, number)
    else:
        gh.set_labels(number, transition_labels(full.get("labels"), "decline"))
        revise(gh, config, number, reason=reason)
    return 0


def load_event():
    path = os.environ.get("GITHUB_EVENT_PATH")
    if not path or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def dispatch(argv, gh, config, event=None, owner=None):
    if not argv or argv[0] in ("-h", "--help"):
        print(USAGE)
        return 0 if argv and argv[0] in ("-h", "--help") else 2
    command = argv[0]
    owner = owner or config.get("owner")
    if command == "labels":
        ensure_labels(gh, config)
        return 0
    if command == "pitch":
        if len(argv) != 2:
            raise ValueError("usage: pitch <agent-slug>")
        pitch(gh, config, argv[1])
        return 0
    if command == "revise":
        if len(argv) != 2:
            raise ValueError("usage: revise <issue-number>")
        revise(gh, config, int(argv[1]))
        return 0
    if command == "start":
        if len(argv) != 2:
            raise ValueError("usage: start <issue-number>")
        start(gh, config, int(argv[1]))
        return 0
    if command == "handle-comment":
        if event is None:
            event = load_event()
        handle_comment(gh, config, event, owner)
        return 0
    raise ValueError(f"unknown command {command!r}")


class GitHub:
    """Minimal REST client. The token is sent only as an Authorization header."""

    def __init__(self, token, repository, api="https://api.github.com"):
        if not token:
            raise ValueError("token is empty")
        repository = str(repository).strip()
        if repository.count("/") != 1:
            raise ValueError(f"repository must be owner/name, got {repository!r}")
        self.token = token
        self.repository = repository
        self.api = api.rstrip("/")
        self._known_labels = set()

    def _scrub(self, text):
        if self.token and self.token in text:
            return text.replace(self.token, "[redacted]")
        return text

    def _request(self, method, path, body=None, ok=(200, 201)):
        if path.startswith("https://") or path.startswith("http://"):
            url = path
        else:
            url = self.api + path
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("User-Agent", "council-agent")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.token}")
        print(f"{method} {url.split('?', 1)[0]}", flush=True)
        try:
            with urllib.request.urlopen(req, timeout=45) as res:
                raw = res.read().decode()
                link = res.headers.get("Link")
                parsed = json.loads(raw) if raw else None
                if res.status not in ok:
                    raise GitHubError(res.status, self._scrub(raw))
                return res.status, parsed, link
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode(errors="replace")
            raise GitHubError(exc.code, self._scrub(raw)) from None

    def _paginate(self, path):
        items = []
        next_url = path
        seen = set()
        while next_url and next_url not in seen:
            seen.add(next_url)
            status, data, link = self._request("GET", next_url)
            if not isinstance(data, list):
                raise GitHubError(status, "expected a list")
            items.extend(data)
            next_url = next_link(link)
        return items

    def list_issues(self, labels="pitch"):
        query = urllib.parse.urlencode(
            {"labels": labels, "state": "all", "per_page": "100"}
        )
        issues = self._paginate(f"/repos/{self.repository}/issues?{query}")
        return [issue for issue in issues if not issue.get("pull_request")]

    def get_issue(self, number):
        _, data, _ = self._request(
            "GET", f"/repos/{self.repository}/issues/{int(number)}"
        )
        return data

    def list_comments(self, number):
        query = urllib.parse.urlencode({"per_page": "100"})
        return self._paginate(
            f"/repos/{self.repository}/issues/{int(number)}/comments?{query}"
        )

    def add_comment(self, number, body):
        _, data, _ = self._request(
            "POST",
            f"/repos/{self.repository}/issues/{int(number)}/comments",
            {"body": body},
            ok=(201,),
        )
        return data

    def set_labels(self, number, labels):
        _, data, _ = self._request(
            "PATCH",
            f"/repos/{self.repository}/issues/{int(number)}",
            {"labels": order_labels(labels)},
        )
        return data

    def create_issue(self, title, body, labels):
        _, data, _ = self._request(
            "POST",
            f"/repos/{self.repository}/issues",
            {"title": title, "body": body, "labels": list(labels)},
            ok=(201,),
        )
        print(f"created issue #{data.get('number')}: {title}", flush=True)
        return data

    def ensure_label(self, name, color, description):
        if name in self._known_labels:
            return
        quoted = urllib.parse.quote(name, safe="")
        try:
            self._request("GET", f"/repos/{self.repository}/labels/{quoted}")
            self._known_labels.add(name)
            return
        except GitHubError as exc:
            if exc.status != 404:
                raise
        try:
            self._request(
                "POST",
                f"/repos/{self.repository}/labels",
                {
                    "name": name,
                    "color": color.lstrip("#"),
                    "description": description[:100],
                },
                ok=(201,),
            )
        except GitHubError as exc:
            if exc.status != 422:
                raise
        self._known_labels.add(name)

    def get_file(self, path, ref="main"):
        quoted = urllib.parse.quote(path, safe="/")
        query = urllib.parse.urlencode({"ref": ref})
        try:
            _, data, _ = self._request(
                "GET", f"/repos/{self.repository}/contents/{quoted}?{query}"
            )
        except GitHubError as exc:
            if exc.status == 404:
                return None
            raise
        if isinstance(data, list):
            raise GitHubError(200, f"{path} is a directory")
        return data

    def put_file(self, path, text, message, branch="main"):
        quoted = urllib.parse.quote(path, safe="/")
        url = f"/repos/{self.repository}/contents/{quoted}"
        for attempt in range(2):
            existing = self.get_file(path, ref=branch)
            if existing and decode_github_content(existing) == text:
                print(f"unchanged {path}", flush=True)
                return existing
            payload = {
                "message": message,
                "content": base64.b64encode(text.encode()).decode(),
                "branch": branch,
            }
            if existing and existing.get("sha"):
                payload["sha"] = existing["sha"]
            try:
                _, data, _ = self._request("PUT", url, payload, ok=(200, 201))
                return data
            except GitHubError as exc:
                if exc.status == 409 and attempt == 0:
                    continue
                raise
        raise GitHubError(409, f"could not write {path}")


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        config = load_config()
        if not argv or argv[0] in ("-h", "--help"):
            print(USAGE)
            return 0 if argv and argv[0] in ("-h", "--help") else 2
        repo = os.environ.get("GITHUB_REPOSITORY") or config["repo"]
        token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if not token:
            raise ValueError("GITHUB_TOKEN is not set")
        gh = GitHub(token, repo)
        owner = os.environ.get("GITHUB_REPOSITORY_OWNER") or config.get("owner")
        return dispatch(argv, gh, config, event=load_event(), owner=owner)
    except GitHubError as exc:
        print(f"GitHub API error: {exc}", file=sys.stderr)
        return 1
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
