"""Exercise the real runner with a deterministic engine and in-memory API."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from agentd.config import Config
from agentd.db import ClaimedRun
from agentd.engine import RunResult
from agentd.runner import execute_run


class EvidencePaths(unittest.TestCase):
    def run_case(self, kind):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cfg = Config(machine_id='demo', workspace_root=root)
            workspace = cfg.workspace_for('atlas')
            outside = root / 'atlas-private'
            outside.mkdir()
            (outside / 'secret.txt').write_text('outside fixture')
            (workspace / 'proof.txt').write_text('inside fixture')
            (workspace / 'escape-link.txt').symlink_to(outside / 'secret.txt')
            (workspace / 'inside-link.txt').symlink_to(workspace / 'proof.txt')
            paths = {
                'inside': 'proof.txt',
                'sibling_prefix': '../atlas-private/secret.txt',
                'absolute_escape': str(outside / 'secret.txt'),
                'symlink_escape': 'escape-link.txt',
                'inside_symlink': 'inside-link.txt',
                'missing': 'missing.txt',
            }
            api = Mock()
            api.complete.return_value = {'task_status': 'done'}
            engine = Mock()
            engine.run.return_value = RunResult(True, 'fixture', ['c1'], [paths[kind]])
            claim = ClaimedRun('run', 'task', {}, 1)
            with patch('agentd.runner.budget_headroom', return_value=(True, '')), \
                 patch('agentd.runner.mark_run_running'), \
                 patch('agentd.runner.load_task_doc', return_value={'task': {'title': 'fixture'}}), \
                 patch('agentd.runner.make_engine', return_value=engine):
                execute_run(None, cfg, api, {'id': 'agent', 'name': 'atlas'}, claim, {})
            return api.artifact.call_count

    def test_workspace_file_attached(self):
        self.assertEqual(self.run_case('inside'), 1)

    def test_sibling_with_same_prefix_rejected(self):
        self.assertEqual(self.run_case('sibling_prefix'), 0)

    def test_absolute_outside_file_rejected(self):
        self.assertEqual(self.run_case('absolute_escape'), 0)

    def test_symlink_escape_rejected(self):
        self.assertEqual(self.run_case('symlink_escape'), 0)

    def test_inside_symlink_allowed(self):
        self.assertEqual(self.run_case('inside_symlink'), 1)

    def test_missing_file_skipped(self):
        self.assertEqual(self.run_case('missing'), 0)


if __name__ == '__main__':
    unittest.main()
