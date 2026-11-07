"""Unit tests for the council stub. No network."""

import base64
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from council.agent import (  # noqa: E402
    START_COMMENT,
    build_revision_chains,
    decode_github_content,
    dispatch,
    handle_comment,
    human_text,
    label_names,
    labels_for_pitch,
    load_config,
    main,
    next_link,
    parse_command,
    parse_header,
    pitch,
    render_header,
    render_sample_pitch,
    render_task_file,
    revise,
    start,
    transition_labels,
)


CONFIG = load_config()
AGENT = CONFIG["agents"][0]


class HeaderTests(unittest.TestCase):
    def test_roundtrip(self):
        body = render_header(
            agent="category-researcher",
            niche="Etsy: digital products",
            revision_of=12,
            sample=True,
        ) + "\n\nHello pitch"
        header = parse_header(body)
        self.assertEqual(header["agent"], "category-researcher")
        self.assertEqual(header["niche"], "Etsy: digital products")
        self.assertEqual(header["revision_of"], 12)
        self.assertTrue(header["sample"])
        self.assertEqual(human_text(body), "Hello pitch")
        self.assertNotIn("<!--", human_text(body))

    def test_revision_aliases_and_missing(self):
        self.assertEqual(parse_header("")["agent"], None)
        self.assertIsNone(parse_header(None)["revision_of"])
        self.assertIsNone(parse_header("just text")["agent"])
        body = "<!-- council\nagent: listing-analyst\nniche: n\nrevision_of: issue #18\nsample: false\n-->"
        header = parse_header(body)
        self.assertEqual(header["revision_of"], 18)
        self.assertFalse(header["sample"])
        body = "<!-- council\nrevision-of: none\nsample: yes\n-->"
        header = parse_header(body)
        self.assertIsNone(header["revision_of"])
        self.assertTrue(header["sample"])

    def test_commands(self):
        self.assertIsNone(parse_command(None))
        self.assertIsNone(parse_command("looks like /approve but does not start with it"))
        self.assertIsNone(parse_command("/approved"))
        self.assertIsNone(parse_command("/declinefoo"))
        self.assertEqual(parse_command("/approve"), ("approve", ""))
        self.assertEqual(parse_command("  /approve\n"), ("approve", ""))
        self.assertEqual(parse_command("/decline"), ("decline", ""))
        self.assertEqual(parse_command("/decline too broad"), ("decline", "too broad"))
        self.assertEqual(
            parse_command("/decline\nneeds one product\n"),
            ("decline", "needs one product"),
        )
        self.assertEqual(parse_command("/Decline Too Broad"), ("decline", "Too Broad"))


class ChainTests(unittest.TestCase):
    def test_linear_branch_and_missing_parent(self):
        chains = build_revision_chains(
            [
                {"number": 1, "revision_of": None},
                {"number": 2, "revision_of": 1},
                {"number": 3, "revision_of": 2},
                {"number": 4, "revision_of": 1},
                {"number": 5, "revision_of": 99},
            ]
        )
        self.assertEqual(chains["roots"], [1, 5])
        self.assertEqual(chains["children"][1], [2, 4])
        self.assertEqual(chains["chain_for"][3], [1, 2, 3])
        self.assertEqual(chains["chain_for"][4], [1, 4])
        self.assertEqual(chains["chain_for"][5], [5])

    def test_chain_from_issue_bodies(self):
        first = render_header(agent="category-researcher", niche="n", sample=True)
        second = render_header(
            agent="category-researcher", niche="n", revision_of=7, sample=True
        )
        chains = build_revision_chains(
            [{"number": 7, "body": first}, {"number": 8, "body": second}]
        )
        self.assertEqual(chains["chain_for"][8], [7, 8])
        self.assertEqual(chains["roots"], [7])

    def test_cycle_is_finite(self):
        chains = build_revision_chains(
            [{"number": 1, "revision_of": 2}, {"number": 2, "revision_of": 1}]
        )
        self.assertLessEqual(len(chains["chain_for"][1]), 2)
        self.assertLessEqual(len(chains["chain_for"][2]), 2)
        self.assertEqual(chains["chain_for"][1][0] in (1, 2), True)


class LabelTests(unittest.TestCase):
    def test_transitions_keep_pitch_labels(self):
        current = labels_for_pitch("listing-analyst", sample=True)
        self.assertEqual(
            current,
            ["agent:listing-analyst", "pitch", "sample", "status:pending"],
        )
        approved = transition_labels(current, "approve")
        self.assertEqual(
            approved,
            ["agent:listing-analyst", "pitch", "sample", "status:approved", "status:working"],
        )
        self.assertNotIn("status:pending", approved)
        declined = transition_labels([{"name": name} for name in current], "decline")
        self.assertEqual(
            declined,
            ["agent:listing-analyst", "pitch", "sample", "status:declined"],
        )
        revised = transition_labels(declined, "revised")
        self.assertEqual(
            revised,
            ["agent:listing-analyst", "pitch", "sample", "status:declined", "status:revised"],
        )


class SamplePitchTests(unittest.TestCase):
    def test_sample_is_marked_and_quotes_the_decline(self):
        title, body = render_sample_pitch(
            AGENT, CONFIG, revision_of=12, decline_reason="too broad"
        )
        self.assertIn("[SAMPLE]", title)
        self.assertIn("revises #12", title)
        self.assertIn("SAMPLE / stub", body)
        self.assertIn("Not research", body)
        self.assertIn("too broad", body)
        self.assertIn("This revision addresses that reason.", body)
        self.assertNotIn("<!--", human_text(body))
        header = parse_header(body)
        self.assertEqual(header["revision_of"], 12)
        self.assertTrue(header["sample"])
        self.assertNotIn("$", body)

    def test_task_file_drops_the_header(self):
        _, body = render_sample_pitch(AGENT, CONFIG)
        text = render_task_file(
            {
                "number": 4,
                "body": body,
                "labels": labels_for_pitch(AGENT["slug"], sample=True),
            },
            CONFIG,
            started_at="2026-11-07T18:00:00Z",
        )
        self.assertIn("https://github.com/joeypbrrr/etsy-digital-empire/issues/4", text)
        self.assertIn("2026-11-07T18:00:00Z", text)
        self.assertIn("SAMPLE / stub", text)
        self.assertNotIn("<!--", text)
        self.assertIn("does not post to a marketplace", text)


class FakeGitHub:
    def __init__(self):
        self.issues = {}
        self.comments = {}
        self.files = {}
        self.labels = set()
        self.next_id = 1

    def ensure_label(self, name, color, description):
        self.labels.add(name)

    def create_issue(self, title, body, labels):
        number = self.next_id
        self.next_id += 1
        issue = {
            "number": number,
            "title": title,
            "body": body,
            "labels": [{"name": name} for name in labels],
            "html_url": f"https://github.com/example/repo/issues/{number}",
        }
        self.issues[number] = issue
        self.comments[number] = []
        return issue

    def get_issue(self, number):
        if int(number) not in self.issues:
            raise AssertionError(f"missing issue {number}")
        return self.issues[int(number)]

    def list_issues(self, labels="pitch"):
        return [
            issue
            for issue in self.issues.values()
            if labels in label_names(issue["labels"]) and not issue.get("pull_request")
        ]

    def list_comments(self, number):
        return list(self.comments.get(int(number), []))

    def add_comment(self, number, body):
        comment = {"id": self.next_id, "body": body, "user": {"login": "github-actions[bot]"}}
        self.next_id += 1
        self.comments.setdefault(int(number), []).append(comment)
        return comment

    def set_labels(self, number, labels):
        self.issues[int(number)]["labels"] = [{"name": name} for name in labels]
        return self.issues[int(number)]

    def put_file(self, path, text, message, branch="main"):
        self.files[path] = {"text": text, "message": message, "branch": branch}
        return self.files[path]


def seed_pitch(fake, number=1, slug="category-researcher"):
    fake.next_id = max(fake.next_id, number + 1)
    body = render_header(agent=slug, niche=CONFIG["niche"], sample=True) + "\n\nSAMPLE / stub."
    fake.issues[number] = {
        "number": number,
        "title": "[SAMPLE] pitch",
        "body": body,
        "labels": [{"name": name} for name in labels_for_pitch(slug, sample=True)],
    }
    fake.comments[number] = []
    return fake.issues[number]


class FlowTests(unittest.TestCase):
    def test_pitch_revise_and_start_are_idempotent(self):
        fake = FakeGitHub()
        created = pitch(fake, CONFIG, "category-researcher")
        self.assertIn("sample", fake.labels)
        self.assertIn("status:pending", label_names(created["labels"]))
        self.assertIn("SAMPLE / stub", created["body"])
        self.assertTrue(created["title"].startswith("[SAMPLE]"))

        number = created["number"]
        fake.comments[number].append(
            {
                "id": 50,
                "body": "/decline too broad",
                "user": {"login": "joeypbrrr"},
                "created_at": "2026-11-07T16:00:00Z",
            }
        )
        revised = revise(fake, CONFIG, number)
        self.assertEqual(parse_header(revised["body"])["revision_of"], number)
        self.assertIn("too broad", revised["body"])
        self.assertIn("status:revised", label_names(fake.issues[number]["labels"]))
        self.assertIn("status:declined", label_names(fake.issues[number]["labels"]))
        again = revise(fake, CONFIG, number, reason="too broad")
        self.assertEqual(again["number"], revised["number"])
        children = [
            issue
            for issue in fake.issues.values()
            if parse_header(issue["body"]).get("revision_of") == number
        ]
        self.assertEqual(len(children), 1)

        start(fake, CONFIG, revised["number"])
        start(fake, CONFIG, revised["number"])
        self.assertEqual(
            [comment["body"] for comment in fake.comments[revised["number"]]],
            [START_COMMENT],
        )
        path = f"council/tasks/{revised['number']}.md"
        self.assertEqual(fake.files[path]["branch"], "main")
        self.assertIn("SAMPLE / stub", fake.files[path]["text"])
        self.assertNotIn("<!--", fake.files[path]["text"])

    def test_handle_comment_owner_gate(self):
        fake = FakeGitHub()
        seed_pitch(fake, 3)
        event = {
            "comment": {"body": "/approve", "user": {"login": "someone-else"}},
            "issue": {"number": 3},
        }
        self.assertEqual(handle_comment(fake, CONFIG, event, "joeypbrrr"), 0)
        self.assertEqual(fake.comments[3], [])
        self.assertIn("status:pending", label_names(fake.issues[3]["labels"]))

        pull = {
            "comment": {"body": "/approve", "user": {"login": "joeypbrrr"}},
            "issue": {"number": 99, "pull_request": {"url": "https://example.test"}},
        }
        self.assertEqual(handle_comment(fake, CONFIG, pull, "joeypbrrr"), 0)
        self.assertNotIn(99, fake.issues)

        plain = seed_pitch(fake, 4)
        plain["labels"] = [{"name": "status:pending"}]
        skipped = {
            "comment": {"body": "/approve", "user": {"login": "joeypbrrr"}},
            "issue": {"number": 4},
        }
        self.assertEqual(handle_comment(fake, CONFIG, skipped, "joeypbrrr"), 0)
        self.assertEqual(fake.files, {})

    def test_handle_comment_approve_and_decline_reason(self):
        fake = FakeGitHub()
        seed_pitch(fake, 8)
        fake.comments[8].append(
            {
                "id": 1,
                "body": "/decline older reason",
                "user": {"login": "joeypbrrr"},
                "created_at": "2026-11-07T12:00:00Z",
            }
        )
        approved = {
            "comment": {"body": "/approve", "user": {"login": "joeypbrrr"}},
            "issue": {"number": 8},
        }
        handle_comment(fake, CONFIG, approved, "joeypbrrr")
        names = label_names(fake.issues[8]["labels"])
        self.assertIn("status:approved", names)
        self.assertIn("status:working", names)
        self.assertNotIn("status:pending", names)
        self.assertIn(START_COMMENT, [comment["body"] for comment in fake.comments[8]])
        self.assertIn("council/tasks/8.md", fake.files)

        fake = FakeGitHub()
        seed_pitch(fake, 9)
        declined = {
            "comment": {
                "body": "/decline\nsecond reason",
                "user": {"login": "joeypbrrr"},
            },
            "issue": {"number": 9},
        }
        handle_comment(fake, CONFIG, declined, "joeypbrrr")
        child = [
            issue
            for issue in fake.issues.values()
            if parse_header(issue["body"]).get("revision_of") == 9
        ]
        self.assertEqual(len(child), 1)
        self.assertIn("second reason", child[0]["body"])
        self.assertNotIn("older reason", child[0]["body"])
        self.assertIn("status:revised", label_names(fake.issues[9]["labels"]))

    def test_dispatch_unknown_agent(self):
        fake = FakeGitHub()
        with self.assertRaises(ValueError):
            dispatch(["pitch", "not-an-agent"], fake, CONFIG)

    def test_decode_and_next_link(self):
        payload = {
            "encoding": "base64",
            "content": base64.b64encode(b"hello council").decode(),
        }
        self.assertEqual(decode_github_content(payload), "hello council")
        self.assertEqual(decode_github_content({"encoding": "utf-8", "content": "plain"}), "plain")
        header = '<https://api.github.com/next>; rel="next", <https://api.github.com/last>; rel="last"'
        self.assertEqual(next_link(header), "https://api.github.com/next")
        self.assertIsNone(next_link(""))

    def test_repo_config_matches_the_ten_agents(self):
        self.assertEqual(CONFIG["repo"], "joeypbrrr/etsy-digital-empire")
        self.assertEqual(CONFIG["owner"], "joeypbrrr")
        self.assertEqual(CONFIG["niche"], "Etsy digital products")
        self.assertEqual(CONFIG["timezone"], "America/New_York")
        self.assertEqual(CONFIG["default_branch"], "main")
        self.assertEqual(
            [agent["name"] for agent in CONFIG["agents"]],
            [
                "Category Researcher",
                "Listing Analyst",
                "Niche Hunter",
                "Template Designer",
                "SEO Copywriter",
                "Content Planner",
                "Policy Researcher",
                "Brand Designer",
                "Competitor Tracker",
                "Launch Lead",
            ],
        )

    def test_main_help_and_missing_token(self):
        saved = os.environ.pop("GITHUB_TOKEN", None)
        saved_gh = os.environ.pop("GH_TOKEN", None)
        try:
            self.assertEqual(main(["--help"]), 0)
            self.assertEqual(main(["labels"]), 2)
        finally:
            if saved is not None:
                os.environ["GITHUB_TOKEN"] = saved
            if saved_gh is not None:
                os.environ["GH_TOKEN"] = saved_gh


if __name__ == "__main__":
    unittest.main()
