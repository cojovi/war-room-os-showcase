const el = id => document.getElementById(id);
let report, selected = 0, position = 0, timer;
const sources = {
  completion: 'services/agentd/src/agentd/runner.py',
  evidence: 'supabase/migrations/20260705000007_triggers.sql',
  recovery: 'supabase/migrations/20260717000011_reaper.sql',
  budget: 'services/agentd/src/agentd/db.py',
  pause: 'services/agentd/src/agentd/db.py',
  retries: 'apps/api/src/daemon.ts',
};

function stop() {
  clearTimeout(timer);
  timer = undefined;
  el('replay').textContent = '▶ Replay trace';
}

function draw() {
  const item = report.scenarios[selected];
  el('case-number').textContent = `SCENARIO ${String(selected + 1).padStart(2, '0')} / RECORDED TRACE`;
  el('scenario-title').textContent = item.title;
  el('narrative').textContent = item.narrative;
  el('outcome').textContent = 'VERIFIED IN LOCAL RUN';
  el('steps').replaceChildren(...item.steps.map((label, i) => {
    const node = document.createElement('div');
    node.className = `step ${i <= position ? 'reached' : ''} ${i === position ? 'active' : ''}`;
    if (i === position) node.setAttribute('aria-current', 'step');
    const number = document.createElement('span');
    number.className = 'number'; number.textContent = String(i + 1).padStart(2, '0');
    const text = document.createElement('strong'); text.textContent = label;
    node.append(number, text); return node;
  }));
  el('position').textContent = `STEP ${position + 1} / ${item.steps.length}`;
  el('observed').textContent = `${item.outcome.status.toUpperCase()}${item.outcome.retry_count ? ` / retry count ${item.outcome.retry_count}` : ''}`;
  el('implementation').href = `https://github.com/cojovi/war-room-os-showcase/blob/main/${sources[item.id]}`;
  el('implementation').textContent = `${sources[item.id].split('/').pop()} ↗`;
  el('previous').disabled = position === 0;
  el('next').disabled = position === item.steps.length - 1;
  [...el('scenarios').children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
}

function advance() {
  if (position < report.scenarios[selected].steps.length - 1) {
    position++; draw(); timer = setTimeout(advance, 1250);
  } else stop();
}

el('replay').addEventListener('click', () => {
  if (timer) { stop(); return; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    position = report.scenarios[selected].steps.length - 1; draw(); return;
  }
  position = 0; draw(); el('replay').textContent = 'Ⅱ Pause replay';
  timer = setTimeout(advance, 1250);
});
el('previous').addEventListener('click', () => { stop(); position--; draw(); });
el('next').addEventListener('click', () => { stop(); position++; draw(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });

fetch('report.json').then(response => {
  if (!response.ok) throw new Error('Report unavailable');
  return response.json();
}).then(data => {
  report = data;
  el('passed').textContent = report.checks.filter(c => c.passed).length;
  el('model-calls').textContent = report.live_model_calls;
  el('check-count').textContent = ` / ${report.checks.length} checks`;
  el('recorded-at').textContent = `RECORDED ${new Date(report.generated_at).toISOString().slice(0, 10)} / POSTGRES ${report.database_version.split(' ')[0]}`;
  report.scenarios.forEach((item, i) => {
    const button = document.createElement('button');
    const index = document.createElement('span'); index.textContent = String(i + 1).padStart(2, '0');
    button.append(index, document.createTextNode(item.title));
    button.addEventListener('click', () => { stop(); selected = i; position = 0; draw(); });
    el('scenarios').append(button);
  });
  report.checks.forEach(item => {
    const li = document.createElement('li'); li.textContent = item.name;
    if (!item.passed) { li.className = 'error'; li.textContent = `FAILED: ${item.name}`; }
    el('checks').append(li);
  });
  el('replay').disabled = false; draw();
}).catch(() => {
  el('scenario-title').textContent = 'The recorded report could not be loaded.';
  el('narrative').textContent = 'Serve this directory over HTTP, or run the integration demonstration to regenerate demo/report.json.';
});
