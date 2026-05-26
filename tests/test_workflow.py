import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from paperflow.agents.opencode_runner import OpenCodeRunner
from paperflow.api_server import app
from paperflow.models import SessionRecord, StepResult
from paperflow.state import RepoRegistry, SessionRegistry
from paperflow.workflow import WorkflowContext


class FakeRunner:
    def __init__(self, parsed_output=None, raw_output="ok"):
        self.parsed_output = parsed_output
        self.raw_output = raw_output

    def run(self, step, context, scope):
        del context, scope
        return StepResult(
            prompt=f"prompt for {step['name']}",
            raw_output=self.raw_output,
            parsed_output=self.parsed_output,
            metadata={"status": "ok"},
        )


class OpenCodeRunnerTests(unittest.TestCase):
    def test_opencode_runner_parses_json_stdout_and_persists_session(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            prompt_path = root / "prompt.md"
            source_dir = root / "src"
            state_dir = root / "state"
            source_dir.mkdir()
            state_dir.mkdir()
            prompt_path.write_text("inspect repo", encoding="utf-8")
            (source_dir / "main.py").write_text("print('hello')\n", encoding="utf-8")

            workflow = {
                "repo_root": ".",
                "input": "paper.tex",
            }
            (root / "paper.tex").write_text("paper body", encoding="utf-8")
            context = WorkflowContext(root=root, workflow=workflow)
            session_registry = SessionRegistry(state_dir / "sessions.json")
            runner = OpenCodeRunner(
                root=root,
                config={
                    "command": "python",
                    "args": [
                        "-c",
                        (
                            "import json; "
                            "print(json.dumps({"
                            "'status':'ok',"
                            "'task':'repo_map',"
                            "'summary':'summary',"
                            "'findings':['fact'],"
                            "'evidence':[{'file':'src/main.py','symbol':'','lines':'1','reason':'entry'}],"
                            "'commands':['python train.py'],"
                            "'configs':[{'name':'cfg','value':'v','reason':'why'}],"
                            "'risks':['risk'],"
                            "'unknowns':['unknown'],"
                            "'session_id':'abc123'"
                            "}))"
                        ),
                    ],
                    "prompt_via_stdin": False,
                    "prompt_arg": "--prompt",
                },
                session_registry=session_registry,
                workflow_name="workflow",
            )
            step = {
                "name": "repo_map",
                "prompt": "prompt.md",
            }

            result = runner.run(step=step, context=context, scope={"include": ["src/**"], "exclude": []})

            self.assertEqual(result.parsed_output["status"], "ok")
            self.assertEqual(result.metadata["matched_files"], ["src/main.py"])
            self.assertIn("--dir", result.metadata["command"])
            self.assertIn("--session", result.metadata["command"])
            sessions = session_registry.list(repo_root=str(root), workflow_name="workflow")
            self.assertEqual(sessions[0].session_id, "abc123")

    def test_opencode_runner_rejects_empty_scope(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "prompt.md").write_text("inspect repo", encoding="utf-8")
            (root / "paper.tex").write_text("paper body", encoding="utf-8")
            context = WorkflowContext(root=root, workflow={"repo_root": ".", "input": "paper.tex"})
            runner = OpenCodeRunner(root=root, config={"command": "python", "args": ["-c", "print('{}')"]})
            step = {"name": "repo_map", "prompt": "prompt.md"}

            with self.assertRaisesRegex(ValueError, "Scope include is empty"):
                runner.run(step=step, context=context, scope={"include": [], "exclude": []})


class WorkflowContextTests(unittest.TestCase):
    def test_context_formats_json_inputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "paper.tex").write_text("paper body", encoding="utf-8")
            (root / "evidence.json").write_text(json.dumps({"status": "ok"}), encoding="utf-8")
            context = WorkflowContext(root=root, workflow={"input": "paper.tex"})

            described = context.describe_inputs({"inputs": ["evidence.json"]})

            self.assertIn("===== INPUT: paper.tex =====", described)
            self.assertIn('"status": "ok"', described)


class RegistryTests(unittest.TestCase):
    def test_session_registry_marks_preferred(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sessions.json"
            registry = SessionRegistry(path)
            registry.upsert(
                SessionRecord(
                    session_id="a",
                    repo_root="repo",
                    workflow_name="flow",
                    preferred=True,
                )
            )
            registry.upsert(
                SessionRecord(
                    session_id="b",
                    repo_root="repo",
                    workflow_name="flow",
                    preferred=False,
                )
            )
            updated = registry.mark_preferred("b", "2026-01-01T00:00:00Z")
            self.assertEqual(updated.session_id, "b")
            sessions = registry.list(repo_root="repo", workflow_name="flow")
            self.assertTrue(next(item for item in sessions if item.session_id == "b").preferred)


class OrchestratorSmokeTests(unittest.TestCase):
    def test_main_persists_outputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "input").mkdir()
            (root / "prompts").mkdir()
            (root / "input" / "paper.tex").write_text("paper", encoding="utf-8")
            (root / "prompts" / "summary.md").write_text("summarize", encoding="utf-8")
            (root / "workflow.yaml").write_text(
                "\n".join(
                    [
                        "input: input/paper.tex",
                        "steps:",
                        "  - name: summary",
                        "    type: summary",
                        "    runner: openai",
                        "    prompt: prompts/summary.md",
                        "    output: output/summary.md",
                    ]
                ),
                encoding="utf-8",
            )

            import run as run_module

            with patch("paperflow.executor.WorkflowExecutor.create_runner", return_value=FakeRunner(raw_output="done")):
                with patch("sys.argv", ["run.py", "--workflow", str(root / "workflow.yaml")]):
                    exit_code = run_module.main()

            self.assertEqual(exit_code, 0)
            self.assertEqual((root / "output" / "summary.md").read_text(encoding="utf-8"), "done")
            self.assertTrue((root / "artifacts" / "summary" / "prompt.txt").exists())


class ApiTests(unittest.TestCase):
    def test_health_and_repo_endpoints(self):
        client = TestClient(app)
        health = client.get("/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["status"], "ok")

        repos = client.get("/repos")
        self.assertEqual(repos.status_code, 200)
        self.assertIn("items", repos.json())


if __name__ == "__main__":
    unittest.main()
