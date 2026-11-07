# Approval-gate council

Agents in this repo pitch work to the owner in a shared thread. The owner approves or declines. Approve starts that agent immediately. Decline wakes the same agent within seconds and posts a revised pitch. There is no hourly job.

This folder is a template. Another niche repo copies it and edits `council/config.json`. Pitches, labels, tokens, and task files stay in the repo that owns them. Ideas do not cross repos.

The site is static GitHub Pages. GitHub itself is the backend: pitches are issues, decisions are comments, and the wake-up is a workflow.

## What Joey does

1. Merge this to `main`. Workflows only run from the default branch.
2. Open **Actions → Post sample pitch → Run workflow**, pick an agent, and run it. That creates the labels and posts one issue marked `sample`.
3. Open the site's [council page](../council/) (GitHub Pages: `/council/`).
4. Approve or decline. Two ways:
   - **Connect GitHub** on the page (a fine-grained token, stored only in that browser), then use the buttons.
   - Or open the issue and comment, as the repo owner, with `/approve` or `/decline` and an optional reason.

A sample pitch is a stub. It is not research. Approving it posts `Starting work on this now` and writes `council/tasks/<issue>.md`. It does not post to Etsy, spend money, or contact anyone.

## Copying this into another repo

1. Copy the directory `council/`, but do not copy numbered files under `council/tasks/` (keep `council/tasks/README.md`).
2. Copy `.github/workflows/council.yml` and `.github/workflows/post-sample-pitch.yml`.
3. Replace `council/config.json` with this repo's owner, `owner/name`, niche, timezone, default branch, and agent list. Do not reuse another niche's pitches or wording beyond what you type into that file.
4. In `post-sample-pitch.yml`, replace the `agent` choice `options` with the new slugs. The Council workflow does not hard-code slugs.
5. Merge to the default branch. On this template the task file is committed to `main`, and both workflows check out `main`. If your default branch has another name, change `ref: main`, `COUNCIL_BRANCH`, and `default_branch` together.
6. Run **Post sample pitch** once. You do not create labels by hand.
7. If `main` is protected so GitHub Actions cannot push, the approve comment still posts and the task-file step fails. Allow the Actions token to write to `main`, then re-run the failed job. The start comment is not posted twice.

Each copy has its own issues and its own token. Do not point two niches at one repo, and do not import issues from the old one.

## config.json

| Field | Meaning |
|---|---|
| `repo` | `owner/name`. The page reads issues from here. |
| `owner` | GitHub login whose comment counts. Must be the repo owner. The workflow also checks `github.repository_owner`. |
| `niche` | Written into every pitch header. |
| `timezone` | IANA zone for the page. This repo uses `America/New_York`. |
| `default_branch` | Where `start` writes the task file. |
| `agents` | `slug`, `name`, `number`, `folder`, `task`. Slugs are lowercase words separated by hyphens. |

The stub builds pitch text from `name`, `task`, and `folder`. It does not add sources or figures.

## Labels

Created by `python3 council/agent.py labels`, and by both workflows before they post.

| Label | When |
|---|---|
| `pitch` | Every pitch issue. |
| `agent:<slug>` | Which agent is pitching. |
| `sample` | Stub pitch. Not real research. |
| `status:pending` | New pitch, waiting on the owner. |
| `status:approved` | Owner approved. Set together with `status:working`. |
| `status:working` | Stub has started. |
| `status:declined` | Owner declined. |
| `status:revised` | A newer issue revises this one. The declined issue keeps `status:declined`. |
| `status:done` | Optional, set by hand when the work is finished. The stub does not set it. |

## Issue body

A small header, then the human pitch. GitHub hides the HTML comment; the page and `agent.py` read it.

```
<!-- council
agent: category-researcher
niche: Etsy digital products
revision of: #12
sample: true
-->

Human pitch text.
```

- `agent` and `niche` are required on pitches this stub creates.
- `revision of` is omitted on a first pitch. `#12` and `12` both parse. `revision_of` and `revision-of` are accepted too.
- `sample: true` marks a stub. The `sample` label is also applied.

The revision chain is that link: `#18` with `revision of: #12` follows `#12`. The page groups a root and its revisions into one thread. A parent that is not in the loaded set starts its own thread. A cycle stops when a number repeats.

## Commands

The owner comments on the pitch issue. The first characters of the comment are the command, in lowercase, with no leading text. The workflow's filter is case-sensitive; `/Approve` will not wake it.

```
/approve
```

```
/decline too broad, pick one folder
```

```
/decline
too broad, pick one folder
```

A decline reason is optional. Everything after `/decline` is the reason, including later lines. `/approved` is not a command.

The Council workflow runs on `issue_comment` `created`, only when all of these are true:

- the commenter is the repo owner
- the thread is an issue, not a pull request
- the comment starts with `/approve` or `/decline`
- the issue is labeled `pitch` (checked again in `agent.py`)

Concurrency is one run at a time per issue, queued, so two clicks do not double-post.

### Approve

1. Labels become `status:approved` and `status:working` (pending and declined come off; `pitch`, `agent:*`, and `sample` stay).
2. The stub comments exactly `Starting work on this now` (once).
3. It writes `council/tasks/<issue number>.md` on `main`.

### Decline

1. Labels become `status:declined`.
2. The stub opens a **new** issue that references the old one (`revision of: #N`), labeled `pitch`, `agent:<slug>`, `status:pending`, and `sample`. The body quotes the decline reason.
3. The old issue gains `status:revised` and keeps `status:declined`.
4. The old issue gets a comment `Revised pitch posted as #N.`

If a revision of that issue already exists, the stub does not open another one.

The workflow uses the default `GITHUB_TOKEN` with `issues: write` and `contents: write`. Events caused by that token do not start a second workflow run, so the stub's own comments do not loop.

## The page

`council/index.html` is static. It reads `config.json`, then the public issues and comments API:

`GET /repos/{repo}/issues?state=all&labels=pitch&per_page=100`

`GET /repos/{repo}/issues/{n}/comments?per_page=100`

Reads are unauthenticated. Responses are cached with `ETag` / `If-None-Match` (in memory and `sessionStorage`). A 304 does not count against GitHub's rate limit. The thread refreshes every 20 seconds, and there is a Refresh button. Times render in the config timezone (`America/New_York` here).

The public rate limit is 60 requests an hour. The first load costs one request plus one per pitch; later polls are 304s while nothing has changed. If a banner says the rate limit was hit, wait until the reset time GitHub returns.

### Connect GitHub

Approve and Decline need to act as the owner.

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
2. Repository access: **only this repository**.
3. Permissions: **Issues → Read and write**. Leave Contents at No access. The page only comments and updates labels. The workflow, not the browser, writes the task file.
4. Paste it into Connect GitHub. The page checks `GET /user` and only keeps the token if the login is `owner` from config.
5. The token lives in `localStorage` for this browser, under a key that includes the repo. It is sent only to `https://api.github.com`. Disconnect deletes it. It is never committed.

Without a token, Approve and Decline are links to the issue, with the comment you need to type.

The page also sets the same labels the workflow sets, so the chips update before the run finishes. The workflow sets them again. That is safe.

## Commands on a machine

```bash
export GITHUB_TOKEN=...          # never commit this
export GITHUB_REPOSITORY=joeypbrrr/etsy-digital-empire
python3 council/agent.py labels
python3 council/agent.py pitch category-researcher
python3 council/agent.py revise 12
python3 council/agent.py start 12
```

`GITHUB_REPOSITORY` defaults to `config.json` when you are not in Actions.

## Tests

```bash
python3 -m unittest discover -s tests -p 'test_*.py' -v
npm test
```

`tests/test_agent.py` covers header parsing, commands, label changes, the revision chain, and the approve / decline / start flow against a fake GitHub. `tests/council.spec.js` loads the page against mocked API responses in Chromium and WebKit, including a 390×844 viewport, ETag refresh, and the buttons.

## Rules

- One repo, one niche. Do not copy pitches from another council.
- Sample issues stay labeled `sample` and say `SAMPLE / stub`. They are not findings.
- Agents do not post listings, message buyers, or spend money. Joey does that, outside this gate.
- Do not commit a token. Do not put a token in an issue, a task file, or a log.
