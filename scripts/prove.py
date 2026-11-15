"""Recorded integration demonstration using real Postgres/API/runner code.

Only the model engine is replaced. Each invocation owns a new disposable DB.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from unittest.mock import patch
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

import httpx
import psycopg
from psycopg import sql as pgsql
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/agentd/src'))
from agentd import db
from agentd.api import ApiClient
from agentd.config import Config
from agentd.engine import RunResult
from agentd.runner import execute_run

PROJECT = '00000000-0000-4000-8000-000000000001'
API = 'http://127.0.0.1:8789'
checks = []
scenarios = []


def check(name, passed):
    checks.append({'name': name, 'passed': bool(passed)})
    print(('PASS' if passed else 'FAIL') + ': ' + name, flush=True)
    if not passed:
        raise AssertionError(name)


class FixtureEngine:
    """Deterministic output, not a live model or an AI-quality evaluation."""
    def __init__(self, evidence=True):
        self.evidence = evidence
        self.calls = 0

    def run(self, prompt, system_prompt, workspace):
        self.calls += 1
        files = []
        if self.evidence:
            (workspace / 'release-check.txt').write_text(
                'FICTIONAL FIXTURE\nRelease checklist reviewed. Evidence attached.\n')
            files = ['release-check.txt']
        return RunResult(True, 'Deterministic fixture completed the sample checklist.',
                         criteria_met=['c1'], evidence_files=files, model='fixture-engine')


def main():
    serve = argparse.ArgumentParser()
    serve.add_argument('--serve', action='store_true')
    args = serve.parse_args()
    admin_url = os.environ.get('PROOF_ADMIN_URL',
        'postgresql://showcase:showcase@127.0.0.1:55439/postgres')
    parsed = urlparse(admin_url)
    if parsed.hostname not in ('127.0.0.1', 'localhost', '::1'):
        raise SystemExit('The proof runner requires a local disposable PostgreSQL instance.')
    # Never mistake an existing service for the API started by this runner.
    import socket
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(('127.0.0.1', 8789))
    name = 'wr_proof_' + uuid4().hex[:12]
    database_url = urlunparse(parsed._replace(path='/' + name))
    admin = psycopg.connect(admin_url, autocommit=True)
    admin.execute(pgsql.SQL('create database {}').format(pgsql.Identifier(name)))
    api_process = None
    dashboard = None
    client = None
    conn = None
    runtime = tempfile.TemporaryDirectory(prefix='war-room-proof-')
    log = open(Path(runtime.name) / 'api.log', 'w+')
    try:
        conn = psycopg.connect(database_url, row_factory=dict_row, autocommit=True)
        # pg_cron registration is outside this demonstration. A plain Postgres
        # container has no extension; call the actual reaper function directly.
        if conn.execute("select 1 from pg_available_extensions where name='pg_cron'").fetchone():
            raise RuntimeError('Use the supplied plain Postgres instance; pg_cron is not part of this fixture.')
        for migration in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            conn.execute(migration.read_text())
        conn.execute((ROOT / 'supabase/seed.sql').read_text())
        check('All showcase migrations and fictional seed apply', True)
        api_process = subprocess.Popen(['pnpm', '--filter', '@agos/api', 'start'],
            cwd=ROOT, env={**os.environ, 'DATABASE_URL': database_url, 'PORT': '8789', 'HOST': '127.0.0.1'},
            stdout=log, stderr=log, start_new_session=True)
        client = httpx.Client(base_url=API, timeout=20)
        for _ in range(100):
            if api_process.poll() is not None:
                log.seek(0)
                raise RuntimeError(log.read())
            try:
                if client.get('/health').status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            time.sleep(.1)
        else:
            raise RuntimeError('Local proof API did not become healthy')
        worker_conn = db.connect(database_url)
        cfg = Config(machine_id='demo-node-01', workspace_root=Path(runtime.name) / 'workspaces')
        agent = db.get_agent(worker_conn, 'atlas')
        api = ApiClient(API)

        def create(title, budget=None):
            data = {'projectId': PROJECT, 'title': title, 'submit': True,
                    'description': 'Fictional release-readiness exercise. Attach a checklist and report the acceptance criterion; preserve the history of every execution attempt.',
                    'assignmentMode': 'autonomous', 'requiredSkills': ['tech'],
                    'acceptanceCriteria': [{'id': 'c1', 'text': 'A release checklist is attached'}],
                    'proofRequired': True}
            if budget is not None:
                data['budgetUsd'] = budget
            response = client.post('/trpc/task.create', json=data)
            response.raise_for_status()
            return response.json()['result']['data']['id']

        def state(task):
            return conn.execute('select status,retry_count from tasks where id=%s', (task,)).fetchone()

        def run_claim(claim, engine):
            with patch('agentd.runner.make_engine', return_value=engine):
                execute_run(worker_conn, cfg, api, agent, claim, {})

        def record(key, title, task, narrative, steps):
            scenarios.append({'id': key, 'title': title, 'task_id': task,
                              'outcome': state(task), 'narrative': narrative, 'steps': steps})

        task = create('01 / Verify a release checklist')
        claim = db.claim_one(worker_conn, agent)
        check('Worker claims the task created through the API', claim is not None and claim.task_id == task)
        run_claim(claim, FixtureEngine())
        check('Evidence-backed run finishes done', state(task)['status'] == 'done')
        check('Evidence is persisted with the task', conn.execute(
            'select count(*) as n from artifacts where task_id=%s and is_evidence', (task,)).fetchone()['n'] == 1)
        completed_run = claim.run_id
        record('completion', 'Completion is earned', task,
               'The real worker attached a file and reported the criterion. The API and database accepted the completion.',
               ['pending', 'claimed', 'in_progress', 'evidence attached', 'done'])

        task = create('02 / A completion claim without evidence')
        claim = db.claim_one(worker_conn, agent)
        run_claim(claim, FixtureEngine(evidence=False))
        check('Missing evidence routes a claimed success to review', state(task)['status'] == 'review')
        record('evidence', 'A claim is not proof', task,
               'The fixture engine claimed success without a file. The completion gate rejected done; the API retained the task for review.',
               ['pending', 'claimed', 'in_progress', 'done rejected', 'review'])

        task = create('03 / Recover an interrupted run')
        claim = db.claim_one(worker_conn, agent)
        db.mark_run_running(worker_conn, claim.run_id, task, agent['id'])
        conn.execute("update agents set last_heartbeat_at=now()-interval '5 minutes' where id=%s", (agent['id'],))
        reaped = conn.execute('select reap_stale_agents_and_runs() as result').fetchone()['result']
        check('Stale worker causes one abandoned run', reaped['runs_abandoned'] == 1)
        check('Recovery requeues once and increments the retry count', state(task) == {'status': 'pending', 'retry_count': 1})
        again = conn.execute('select reap_stale_agents_and_runs() as result').fetchone()['result']
        check('A second recovery pass has no additional effect', again['runs_abandoned'] == 0)
        db.heartbeat(worker_conn, 'demo-node-01', ['atlas'])
        claim = db.claim_one(worker_conn, agent)
        check('Recovered task begins attempt two', claim is not None and claim.attempt_number == 2)
        run_claim(claim, FixtureEngine())
        check('Recovered task completes with evidence', state(task)['status'] == 'done')
        record('recovery', 'Failure has a return path', task,
               'A simulated lost heartbeat abandoned the first run. The database requeued the task, and attempt two completed.',
               ['in_progress', 'heartbeat lost', 'abandoned', 'pending / retry 1', 'attempt 2 / done'])

        task = create('04 / Stop at an exhausted budget', budget=0)
        claim = db.claim_one(worker_conn, agent)
        engine = FixtureEngine()
        run_claim(claim, engine)
        check('Exhausted budget prevents the model engine from being called', engine.calls == 0)
        check('Budget stop records a failed attempt and requeues', state(task) == {'status': 'pending', 'retry_count': 1})
        record('budget', 'Check the budget first', task,
               'A zero remaining task budget stopped execution before the model engine. This is a pre-call check, not a per-call spending cap.',
               ['pending', 'claimed', 'budget exhausted', 'engine calls: 0', 'pending / retry 1'])
        conn.execute("update tasks set status='blocked' where id=%s", (task,))

        task = create('05 / Respect the operator pause')
        conn.execute("update system_state set value='{\"paused\":true}' where key='global_pause'")
        check('Global pause prevents a new claim', db.claim_one(worker_conn, agent) is None)
        record('pause', 'The operator can stop intake', task,
               'Global pause removed the task from claim eligibility. This check does not demonstrate interruption of an already-running provider call.',
               ['pending', 'global pause', 'claim rejected', 'pending'])
        conn.execute("update system_state set value='{\"paused\":false}' where key='global_pause'")
        conn.execute("update tasks set status='blocked' where id=%s", (task,))

        def post_duplicate(_):
            return httpx.post(API + f'/d/runs/{completed_run}/comments',
                json={'body': 'Concurrent retry fixture', 'kind': 'status_update'},
                headers={'Idempotency-Key': 'proof-concurrent-key'}, timeout=20)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(post_duplicate, range(8)))
        check('Eight concurrent requests receive successful responses', all(r.status_code == 200 for r in responses))
        check('Concurrent retries produce exactly one comment row', conn.execute(
            "select count(*) as n from task_comments where body='Concurrent retry fixture'").fetchone()['n'] == 1)
        check('Concurrent retries replay the same response', len({r.json()['comment_id'] for r in responses}) == 1)
        different = client.post(f'/d/runs/{completed_run}/comments', json={'body': 'Different request'},
            headers={'Idempotency-Key': 'proof-concurrent-key'})
        check('Reusing the key with a different body is rejected', different.status_code == 400)
        broken = client.post(f'/d/runs/{completed_run}/artifacts', json={'name': 'fixture', 'kind': 'invalid-kind'},
            headers={'Idempotency-Key': 'proof-rollback-key'})
        check('Invalid mutation is rejected', broken.status_code == 400)
        check('Failed mutation leaves no replay response behind', conn.execute(
            "select count(*) as n from idempotency_keys where key='proof-rollback-key'").fetchone()['n'] == 0)
        valid = client.post(f'/d/runs/{completed_run}/artifacts', json={'name': 'fixture', 'kind': 'file'},
            headers={'Idempotency-Key': 'proof-rollback-key'})
        check('A rolled-back request key can be retried successfully', valid.status_code == 200)
        scenarios.append({'id': 'retries', 'title': 'Retries share one result', 'outcome': {'status': 'verified'},
            'narrative': 'Eight parallel HTTP requests used the same key and body. A transaction-scoped lock serialized them; one comment and one replay record were committed.',
            'steps': ['8 requests', 'key lock', '1 mutation', '1 response record', '8 matching responses']})

        # Concurrent claim uses two actual database sessions. Only one pending task exists.
        task = create('06 / One task, competing workers')
        def competing_claim(_):
            connection = db.connect(database_url)
            try:
                return db.claim_one(connection, agent)
            finally:
                connection.close()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(competing_claim, range(2)))
        winners = [value for value in claims if value is not None]
        check('Two competing sessions claim the pending task once', len(winners) == 1 and winners[0].task_id == task)
        run_claim(winners[0], FixtureEngine())
        check('Claim transaction creates one run for that task', conn.execute(
            'select count(*) as n from agent_runs where task_id=%s', (task,)).fetchone()['n'] == 1)

        worker_conn.close()
        api.http.close()
        # These public records intentionally exclude local paths and operator data.
        events = conn.execute('select seq,event_type,subject_type,created_at from events order by seq').fetchall()
        report = {'generated_at': datetime.now(timezone.utc).isoformat(),
                  'database_version': conn.execute('show server_version').fetchone()['server_version'],
                  'mode': 'Recorded integration run / deterministic model / fictional data',
                  'live_model_calls': 0, 'checks': checks, 'scenarios': scenarios, 'events': events}
        (ROOT / 'demo/report.json').write_text(json.dumps(report, indent=2, default=str) + '\n')
        print(f'RESULT: {len(checks)} passed. Report: demo/report.json', flush=True)
        if args.serve:
            dashboard = subprocess.Popen(['pnpm', 'dev:dashboard'], cwd=ROOT,
                env={**os.environ, 'NEXT_PUBLIC_API_URL': API + '/trpc'}, start_new_session=True)
            print('Fictional dashboard: http://127.0.0.1:3107 — Ctrl+C stops the demo and removes its database.', flush=True)
            dashboard.wait()
    finally:
        import signal
        for process in (dashboard, api_process):
            if process and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
        if client:
            client.close()
        if conn:
            conn.close()
        admin.execute(pgsql.SQL('drop database {} with (force)').format(pgsql.Identifier(name)))
        admin.close()
        log.close()
        runtime.cleanup()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nShowcase stopped.')
