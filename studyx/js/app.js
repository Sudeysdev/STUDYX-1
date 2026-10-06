/* ==========================================================
   STUDYX — Student Command Center
   Plain JavaScript, no build step. Data lives in localStorage.

   Sections:
   1. Constants & helpers
   2. State (load / save)
   3. Modal forms, toast, icons
   4. Views (dashboard, subjects, assignments, timetable,
      GPA, pomodoro, expenses, settings)
   5. Pomodoro timer engine
   6. Events & routing
   ========================================================== */
'use strict';

(() => {
  /* ---------- 1. Constants & helpers ---------- */
  const STORE_KEY = 'studyx:v1';
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const PRIORITIES = { high: 'High', medium: 'Medium', low: 'Low' };
  const CATEGORIES = ['Food', 'Transport', 'Books & printing', 'Airtime & data', 'Other'];
  const SUBJECT_COLORS = ['#2843d4', '#e5792b', '#1f8457', '#b83280', '#0e8fa8', '#8a5cf6', '#c9a227', '#d64545'];

  // 4.0 scale. Change these values if your department uses a different scale.
  const GRADE_POINTS = {
    'A+': 4, 'A': 4, 'A-': 3.75,
    'B+': 3.5, 'B': 3, 'B-': 2.75,
    'C+': 2.5, 'C': 2, 'C-': 1.75,
    'D': 1, 'F': 0
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => toISO(new Date());
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
  const daysUntil = iso => daysBetween(today(), iso);
  const todayDayIndex = () => (new Date().getDay() + 6) % 7; // Monday = 0
  const weekStart = (d = new Date()) => addDays(d, -((d.getDay() + 6) % 7));
  const fmtDate = iso => parseISO(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtTime = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };
  const fmtClock = sec => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  const money = n => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })} ETB`;
  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  /* ---------- 2. State ---------- */
  const defaultState = () => ({
    profile: { name: '' },
    theme: null,
    subjects: [],       // {id, name, code, credits, instructor, color}
    assignments: [],    // {id, title, subjectId, due, priority, done, doneAt}
    timetable: [],      // {id, subjectId, day (0=Mon), start, end, room}
    gpa: { courses: [], prevGpa: '', prevCredits: '' }, // courses: {id, name, credits, grade}
    expenses: [],       // {id, desc, amount, category, date}
    pomodoro: {
      settings: { focus: 25, short: 5, long: 15, longEvery: 4 },
      sessions: []      // {id, date, minutes, subjectId}
    },
    activity: []        // list of ISO dates with study activity (drives the streak)
  });

  function normalize(raw) {
    const d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    const arr = v => (Array.isArray(v) ? v : []);
    return {
      profile: { name: String(raw.profile?.name ?? '') },
      theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : null,
      subjects: arr(raw.subjects),
      assignments: arr(raw.assignments),
      timetable: arr(raw.timetable),
      gpa: {
        courses: arr(raw.gpa?.courses),
        prevGpa: raw.gpa?.prevGpa ?? '',
        prevCredits: raw.gpa?.prevCredits ?? ''
      },
      expenses: arr(raw.expenses),
      pomodoro: {
        settings: { ...d.pomodoro.settings, ...(raw.pomodoro?.settings || {}) },
        sessions: arr(raw.pomodoro?.sessions)
      },
      activity: arr(raw.activity)
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultState();
    } catch (e) {
      return defaultState();
    }
  }

  let state = load();
  const ui = { assignFilter: 'pending' };

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('Could not save. Browser storage is full or blocked.');
    }
  }

  const subjectById = id => state.subjects.find(s => s.id === id);

  function markActive() {
    const t = today();
    if (!state.activity.includes(t)) state.activity.push(t);
  }

  function computeStreak() {
    const set = new Set(state.activity);
    let d = new Date();
    if (!set.has(toISO(d))) d = addDays(d, -1); // today may not be done yet
    let n = 0;
    while (set.has(toISO(d))) { n++; d = addDays(d, -1); }
    return n;
  }

  function bestStreak() {
    const days = Array.from(new Set(state.activity)).sort();
    let best = 0, run = 0, prev = null;
    days.forEach(day => {
      run = prev && daysBetween(prev, day) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = day;
    });
    return best;
  }

  function gpaCalc() {
    let points = 0, credits = 0;
    state.gpa.courses.forEach(c => {
      const cr = Number(c.credits) || 0;
      const gp = GRADE_POINTS[c.grade];
      if (cr > 0 && gp !== undefined) { points += gp * cr; credits += cr; }
    });
    const semester = credits ? points / credits : 0;
    const prevGpa = parseFloat(state.gpa.prevGpa);
    const prevCredits = parseFloat(state.gpa.prevCredits);
    let cumulative = semester, cumCredits = credits;
    if (prevGpa >= 0 && prevCredits > 0) {
      cumCredits = credits + prevCredits;
      cumulative = (points + prevGpa * prevCredits) / cumCredits;
    }
    return { semester, credits, cumulative, cumCredits, hasData: credits > 0 || prevCredits > 0 };
  }

  /* ---------- 3. Icons, toast, modal ---------- */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    book: '<path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19.5A2 2 0 0 0 6 21h14"/>',
    tasks: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',
    calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="3"/><path d="M3 10h18M8 2.5v4M16 2.5v4"/>',
    calc: '<rect x="4" y="2.5" width="16" height="19" rx="3"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h14.5a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 19.5 8H5.5A2.5 2.5 0 0 1 3 7.5Z"/><circle cx="16.5" cy="13.5" r="1"/>',
    flame: '<path d="M12 22c4 0 7-2.8 7-7 0-3-1.8-5-3.5-7-.5 1.5-1.5 2.5-2.5 3 .5-3-.5-6-3-8.5-.5 3-2 5-3.5 6.5C5.7 11 5 12.7 5 15c0 4.2 3 7 7 7Z"/>',
    sliders: '<path d="M4 6h9M19 6h1M4 12h1M11 12h9M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>'
  };
  const icon = (name, size = 20) =>
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  function fieldHTML(f, value) {
    const v = value ?? f.default ?? '';
    const id = 'f-' + f.name;
    const req = f.required ? 'required' : '';
    let control;
    if (f.type === 'select') {
      control = `<select id="${id}" name="${f.name}" ${req}>${f.options.map(o =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else {
      const attrs = [
        f.min != null ? `min="${f.min}"` : '',
        f.max != null ? `max="${f.max}"` : '',
        f.step ? `step="${f.step}"` : '',
        f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
        (!f.type || f.type === 'text') ? 'autocomplete="off"' : ''
      ].join(' ');
      control = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req} ${attrs}>`;
    }
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${control}</div>`;
  }

  // onSave(data) may return a string to show an error and keep the dialog open.
  function openForm({ title, fields, values = {}, submitLabel = 'Save', onSave }) {
    const modal = $('#modal');
    const form = $('#modal-form');
    setText('#modal-title', title);
    setText('#modal-submit', submitLabel);
    setText('#modal-error', '');
    $('#modal-fields').innerHTML = fields.map(f => fieldHTML(f, values[f.name])).join('');
    form.onsubmit = e => {
      e.preventDefault();
      const err = onSave(Object.fromEntries(new FormData(form)));
      if (err) { setText('#modal-error', err); return; }
      modal.close();
    };
    modal.showModal();
    const first = form.querySelector('input, select');
    if (first) first.focus();
  }

  /* ---------- 4. Views ---------- */
  const VIEWS = {
    dashboard: { title: 'Dashboard', nav: 'Dashboard', icon: 'home', render: renderDashboard },
    subjects: { title: 'Subjects', nav: 'Subjects', icon: 'book', render: renderSubjects },
    assignments: { title: 'Assignments', nav: 'Assignments', icon: 'tasks', render: renderAssignments },
    timetable: { title: 'Timetable', nav: 'Timetable', icon: 'calendar', render: renderTimetable },
    gpa: { title: 'GPA calculator', nav: 'GPA', icon: 'calc', render: renderGpa },
    pomodoro: { title: 'Pomodoro timer', nav: 'Focus timer', icon: 'timer', render: renderPomodoro },
    expenses: { title: 'Expenses', nav: 'Expenses', icon: 'wallet', render: renderExpenses },
    settings: { title: 'Settings', nav: 'Settings', icon: 'sliders', render: renderSettings }
  };

  const viewHead = (text, buttonHTML = '') =>
    `<div class="view-head"><p>${text}</p>${buttonHTML}</div>`;
  const emptyState = (title, text, buttonHTML = '') =>
    `<div class="empty"><h4>${title}</h4><p>${text}</p>${buttonHTML}</div>`;

  function subjectChip(id) {
    const s = subjectById(id);
    const color = s ? esc(s.color) : 'var(--muted)';
    return `<span class="chip"><i class="dot" style="background:${color}"></i>${esc(s ? s.name : 'General')}</span>`;
  }

  function dueInfo(a) {
    if (a.done) return { text: 'Done', cls: 'ok' };
    const n = daysUntil(a.due);
    if (n < 0) return { text: `Overdue by ${-n} day${-n === 1 ? '' : 's'}`, cls: 'bad' };
    if (n === 0) return { text: 'Due today', cls: 'warn' };
    if (n === 1) return { text: 'Due tomorrow', cls: 'warn' };
    return { text: `Due in ${n} days`, cls: '' };
  }

  function taskItem(a, withActions = true) {
    const due = dueInfo(a);
    return `
      <li class="task ${a.done ? 'is-done' : ''}">
        <button class="check" type="button" data-action="assign-toggle" data-id="${a.id}"
          aria-pressed="${a.done}" aria-label="${a.done ? 'Mark as not done' : 'Mark as done'}">${a.done ? icon('check', 16) : ''}</button>
        <div class="task-body">
          <p class="task-title">${esc(a.title)}</p>
          <div class="task-meta">
            ${subjectChip(a.subjectId)}
            <span class="due ${due.cls}">${due.text}</span>
            <span class="due">${fmtDate(a.due)}</span>
            <span class="badge ${a.priority}">${PRIORITIES[a.priority] || 'Medium'}</span>
          </div>
        </div>
        ${withActions ? `<div class="row-actions">
          <button class="icon-btn sm plain" type="button" data-action="assign-edit" data-id="${a.id}" aria-label="Edit assignment">${icon('edit', 18)}</button>
          <button class="icon-btn sm plain del" type="button" data-action="assign-del" data-id="${a.id}" aria-label="Delete assignment">${icon('trash', 18)}</button>
        </div>` : ''}
      </li>`;
  }

  const classesOn = dayIdx => state.timetable
    .filter(t => t.day === dayIdx && subjectById(t.subjectId))
    .sort((a, b) => a.start.localeCompare(b.start));

  function ringSVG(progress, { size = 160, stroke = 12, id = '' } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-bg" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-fg" ${id ? `id="${id}"` : ''} data-c="${c}" cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - progress)}" transform="rotate(-90 ${mid} ${mid})"/>
    </svg>`;
  }

  /* ----- Dashboard ----- */
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  const expensesBetween = (fromISO, toISOd) =>
    state.expenses.filter(e => e.date >= fromISO && e.date <= toISOd).reduce((n, e) => n + Number(e.amount || 0), 0);

  function renderDashboard() {
    const name = state.profile.name || 'Student';
    const t = today();
    const pending = state.assignments.filter(a => !a.done);
    const doneToday = state.assignments.filter(a => a.done && a.doneAt === t).length;
    const totalToday = pending.length + doneToday;
    const pct = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;
    const sessionsToday = state.pomodoro.sessions.filter(s => s.date === t).length;
    const ws = weekStart();
    const weekSpend = expensesBetween(toISO(ws), toISO(addDays(ws, 6)));
    const upcoming = pending.slice().sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
    const classes = classesOn(todayDayIndex());
    const g = gpaCalc();
    const streak = computeStreak();
    const activeSet = new Set(state.activity);
    const dots = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(new Date(), i - 6);
      const iso = toISO(d);
      return `<span class="${activeSet.has(iso) ? 'on' : ''} ${iso === t ? 'today' : ''}"><i></i>${d.toLocaleDateString('en-US', { weekday: 'narrow' })}</span>`;
    }).join('');

    return `
      <section class="hero">
        <p class="hero-hello">${greeting()}</p>
        <h2>Hey, ${esc(name)}.<br>Let&rsquo;s get something done.</h2>
        <p class="sub">Small focused sessions become big results.</p>
        <a class="btn light lg" href="#/pomodoro">Start focus session</a>
      </section>

      <section class="stats" aria-label="Summary">
        <a class="stat" href="#/subjects"><span class="stat-ic">${icon('book', 24)}</span><div><p>Subjects</p><strong>${state.subjects.length}</strong></div></a>
        <a class="stat" href="#/assignments"><span class="stat-ic">${icon('tasks', 24)}</span><div><p>Pending tasks</p><strong>${pending.length}</strong></div></a>
        <a class="stat s-gpa" href="#/gpa"><span class="stat-ic">${icon('calc', 24)}</span><div><p>Current GPA</p><strong>${g.hasData ? g.cumulative.toFixed(2) : '0.00'}</strong></div></a>
        <a class="stat s-streak" href="#/dashboard"><span class="stat-ic">${icon('flame', 24)}</span><div><p>Study streak</p><strong>${streak}<small> day${streak === 1 ? '' : 's'}</small></strong></div></a>
      </section>

      <div class="cols">
        <section class="card">
          <div class="card-head"><h3>Upcoming assignments</h3><a href="#/assignments">View all</a></div>
          ${upcoming.length
            ? `<ul class="tasks">${upcoming.map(a => taskItem(a, false)).join('')}</ul>`
            : emptyState('Nothing due', 'Add an assignment and it will show up here.', `<a class="btn ghost" href="#/assignments">Add assignment</a>`)}
        </section>

        <section class="card">
          <div class="card-head"><h3>Today&rsquo;s progress</h3></div>
          <div class="ring-wrap">
            ${ringSVG(pct / 100)}
            <div class="ring-center"><strong>${pct}%</strong><span>completed</span></div>
          </div>
          <dl class="facts">
            <div><dt>Tasks completed</dt><dd>${doneToday} / ${totalToday}</dd></div>
            <div><dt>Focus sessions</dt><dd>${sessionsToday}</dd></div>
            <div><dt>This week&rsquo;s spending</dt><dd>${money(weekSpend)}</dd></div>
          </dl>
        </section>

        <section class="card">
          <div class="card-head"><h3>Today&rsquo;s classes</h3><a href="#/timetable">Timetable</a></div>
          ${classes.length
            ? `<div class="stack">${classes.map(classCard).join('')}</div>`
            : emptyState('No classes today', 'Enjoy the space, or plan a focus session.')}
        </section>

        <section class="card">
          <div class="card-head"><h3>Study streak</h3></div>
          <div class="week-dots" aria-label="Last 7 days">${dots}</div>
          <p class="muted small">Finish a focus session or complete an assignment to keep your streak alive. Best streak: ${bestStreak()} day${bestStreak() === 1 ? '' : 's'}.</p>
        </section>
      </div>`;
  }

  /* ----- Subjects ----- */
  function renderSubjects() {
    const add = `<button class="btn primary" type="button" data-action="subject-add">${icon('plus', 18)} Add subject</button>`;
    if (!state.subjects.length) {
      return viewHead('Everything else in STUDYX starts with your subjects.', add) +
        `<div class="card">${emptyState('No subjects yet', 'Add the courses you take this semester.')}</div>`;
    }
    const cards = state.subjects.map(s => {
      const pend = state.assignments.filter(a => a.subjectId === s.id && !a.done).length;
      const classes = state.timetable.filter(t => t.subjectId === s.id).length;
      return `
        <article class="card subject" style="--c:${esc(s.color)}">
          <div class="subject-top">
            <div>
              <h3>${esc(s.name)}</h3>
              ${s.code ? `<p class="muted">${esc(s.code)}</p>` : ''}
              ${s.instructor ? `<p class="muted small">${esc(s.instructor)}</p>` : ''}
            </div>
            <div class="row-actions">
              <button class="icon-btn sm plain" type="button" data-action="subject-edit" data-id="${s.id}" aria-label="Edit ${esc(s.name)}">${icon('edit', 18)}</button>
              <button class="icon-btn sm plain del" type="button" data-action="subject-del" data-id="${s.id}" aria-label="Delete ${esc(s.name)}">${icon('trash', 18)}</button>
            </div>
          </div>
          <dl class="facts">
            <div><dt>Credit hours</dt><dd>${esc(s.credits)}</dd></div>
            <div><dt>Pending tasks</dt><dd>${pend}</dd></div>
            <div><dt>Classes per week</dt><dd>${classes}</dd></div>
          </dl>
        </article>`;
    }).join('');
    return viewHead(`${state.subjects.length} subject${state.subjects.length === 1 ? '' : 's'} this semester`, add) +
      `<div class="subjects">${cards}</div>`;
  }

  function subjectForm(existing) {
    openForm({
      title: existing ? 'Edit subject' : 'Add subject',
      values: existing || { color: SUBJECT_COLORS[state.subjects.length % SUBJECT_COLORS.length], credits: 3 },
      fields: [
        { name: 'name', label: 'Subject name', required: true, placeholder: 'e.g. Data Structures' },
        { name: 'code', label: 'Course code (optional)', placeholder: 'e.g. CSEg 2101' },
        { name: 'credits', label: 'Credit hours', type: 'number', min: 0, step: 0.5, required: true },
        { name: 'instructor', label: 'Instructor (optional)' },
        { name: 'color', label: 'Colour', type: 'color' }
      ],
      onSave: d => {
        const name = d.name.trim();
        if (!name) return 'Enter a subject name.';
        const data = { name, code: d.code.trim(), credits: Number(d.credits) || 0, instructor: d.instructor.trim(), color: d.color };
        if (existing) Object.assign(existing, data);
        else state.subjects.push({ id: uid(), ...data });
        save(); render();
        toast(existing ? 'Subject updated.' : 'Subject added.');
      }
    });
  }

  /* ----- Assignments ----- */
  function renderAssignments() {
    const f = ui.assignFilter;
    const all = state.assignments;
    const counts = { pending: all.filter(a => !a.done).length, done: all.filter(a => a.done).length, all: all.length };
    let list = all.slice();
    if (f === 'pending') list = list.filter(a => !a.done);
    if (f === 'done') list = list.filter(a => a.done);
    list.sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));

    const tab = (key, label) => `<button type="button" class="${f === key ? 'on' : ''}" data-action="assign-filter" data-filter="${key}">${label} (${counts[key]})</button>`;
    const emptyText = f === 'done' ? 'Finished assignments will appear here.' : 'Add an assignment to start tracking deadlines.';

    return viewHead('Track deadlines and check things off.',
        `<button class="btn primary" type="button" data-action="assign-add">${icon('plus', 18)} Add assignment</button>`) +
      `<div class="card">
        <div class="tabs" role="group" aria-label="Filter assignments">${tab('pending', 'Pending')}${tab('done', 'Done')}${tab('all', 'All')}</div>
        ${list.length ? `<ul class="tasks">${list.map(a => taskItem(a)).join('')}</ul>` : emptyState('No assignments here', emptyText)}
      </div>`;
  }

  function assignmentForm(existing) {
    const tomorrow = toISO(addDays(new Date(), 1));
    openForm({
      title: existing ? 'Edit assignment' : 'Add assignment',
      values: existing || { due: tomorrow, priority: 'medium', subjectId: '' },
      fields: [
        { name: 'title', label: 'Title', required: true, placeholder: 'e.g. Lab report 3' },
        { name: 'subjectId', label: 'Subject', type: 'select', options: [{ value: '', label: 'General' }, ...state.subjects.map(s => ({ value: s.id, label: s.name }))] },
        { name: 'due', label: 'Due date', type: 'date', required: true },
        { name: 'priority', label: 'Priority', type: 'select', options: Object.entries(PRIORITIES).map(([value, label]) => ({ value, label })) }
      ],
      onSave: d => {
        const title = d.title.trim();
        if (!title) return 'Enter a title.';
        if (!d.due) return 'Choose a due date.';
        const data = { title, subjectId: d.subjectId, due: d.due, priority: d.priority };
        if (existing) Object.assign(existing, data);
        else state.assignments.push({ id: uid(), done: false, doneAt: null, ...data });
        save(); render();
        toast(existing ? 'Assignment updated.' : 'Assignment added.');
      }
    });
  }

  /* ----- Timetable ----- */
  function classCard(t) {
    const s = subjectById(t.subjectId);
    return `
      <article class="class" style="--c:${esc(s.color)}">
        <p class="time">${fmtTime(t.start)} to ${fmtTime(t.end)}</p>
        <h4>${esc(s.name)}</h4>
        ${t.room ? `<p class="muted small">${esc(t.room)}</p>` : ''}
        <div class="row-actions">
          <button class="icon-btn sm plain" type="button" data-action="tt-edit" data-id="${t.id}" aria-label="Edit class">${icon('edit', 16)}</button>
          <button class="icon-btn sm plain del" type="button" data-action="tt-del" data-id="${t.id}" aria-label="Delete class">${icon('trash', 16)}</button>
        </div>
      </article>`;
  }

  function renderTimetable() {
    const todayIdx = todayDayIndex();
    const cols = DAYS.map((day, i) => {
      const items = classesOn(i);
      return `<section class="day ${i === todayIdx ? 'is-today' : ''}">
        <header><h3>${day}</h3>
          <button class="icon-btn sm" type="button" data-action="tt-add" data-day="${i}" aria-label="Add class on ${day}">${icon('plus', 16)}</button>
        </header>
        ${items.length ? items.map(classCard).join('') : '<p class="muted small">No classes</p>'}
      </section>`;
    }).join('');
    return viewHead('Your weekly class schedule.',
        `<button class="btn primary" type="button" data-action="tt-add">${icon('plus', 18)} Add class</button>`) +
      `<div class="week">${cols}</div>`;
  }

  function timetableForm(existing, day) {
    if (!state.subjects.length) {
      toast('Add a subject first, then schedule its classes.');
      location.hash = '#/subjects';
      return;
    }
    openForm({
      title: existing ? 'Edit class' : 'Add class',
      values: existing || { day: day ?? todayDayIndex(), start: '08:00', end: '10:00', subjectId: state.subjects[0].id },
      fields: [
        { name: 'subjectId', label: 'Subject', type: 'select', required: true, options: state.subjects.map(s => ({ value: s.id, label: s.name })) },
        { name: 'day', label: 'Day', type: 'select', options: DAYS.map((d, i) => ({ value: i, label: d })) },
        { name: 'start', label: 'Starts', type: 'time', required: true },
        { name: 'end', label: 'Ends', type: 'time', required: true },
        { name: 'room', label: 'Room (optional)', placeholder: 'e.g. Block 5, Room 104' }
      ],
      onSave: d => {
        if (!d.start || !d.end) return 'Set a start and end time.';
        if (d.end <= d.start) return 'The class must end after it starts.';
        const data = { subjectId: d.subjectId, day: Number(d.day), start: d.start, end: d.end, room: d.room.trim() };
        if (existing) Object.assign(existing, data);
        else state.timetable.push({ id: uid(), ...data });
        save(); render();
        toast(existing ? 'Class updated.' : 'Class added.');
      }
    });
  }

  /* ----- GPA ----- */
  function renderGpa() {
    const rows = state.gpa.courses.map(c => `
      <div class="gpa-row" data-id="${c.id}">
        <input data-gpa="name" value="${esc(c.name)}" placeholder="Course name" aria-label="Course name" autocomplete="off">
        <input data-gpa="credits" type="number" min="0" step="0.5" inputmode="decimal" value="${esc(c.credits)}" aria-label="Credit hours">
        <select data-gpa="grade" aria-label="Grade">
          <option value="">Grade</option>
          ${Object.keys(GRADE_POINTS).map(g => `<option ${c.grade === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select>
        <button class="icon-btn sm plain del" type="button" data-action="gpa-del" data-id="${c.id}" aria-label="Remove course">${icon('trash', 18)}</button>
      </div>`).join('');
    const r = gpaCalc();

    return viewHead('Enter your courses and grades to see your GPA update live.') + `
      <div class="gpa-layout">
        <section class="card">
          <div class="card-head"><h3>This semester</h3></div>
          ${state.gpa.courses.length
            ? `<div class="gpa-head"><span>Course</span><span>Credits</span><span>Grade</span><span></span></div><div class="gpa-rows">${rows}</div>`
            : emptyState('No courses yet', 'Add courses one by one or import them from your subjects.')}
          <div class="gpa-actions">
            <button class="btn primary" type="button" data-action="gpa-add">${icon('plus', 18)} Add course</button>
            <button class="btn ghost" type="button" data-action="gpa-import">Import from subjects</button>
            ${state.gpa.courses.length ? '<button class="btn ghost" type="button" data-action="gpa-clear">Clear all</button>' : ''}
          </div>
          <p class="muted small" style="margin-top:14px">Uses a 4.0 scale (A = 4.0, B = 3.0, C = 2.0, D = 1.0, F = 0). Rows without a grade are ignored.</p>
        </section>

        <div class="stack">
          <section class="card result">
            <span>Semester GPA</span>
            <strong id="gpa-sem">${r.credits ? r.semester.toFixed(2) : '0.00'}</strong>
            <p class="muted small"><span id="gpa-credits">${r.credits}</span> credit hours counted</p>
          </section>
          <section class="card">
            <div class="card-head"><h3>Cumulative GPA</h3></div>
            <div class="prev-grid">
              <div class="field"><label for="prev-gpa">Previous GPA</label>
                <input id="prev-gpa" type="number" min="0" max="4" step="0.01" inputmode="decimal" data-gpa-prev="prevGpa" value="${esc(state.gpa.prevGpa)}" placeholder="e.g. 3.42"></div>
              <div class="field"><label for="prev-cr">Previous credits</label>
                <input id="prev-cr" type="number" min="0" step="0.5" inputmode="decimal" data-gpa-prev="prevCredits" value="${esc(state.gpa.prevCredits)}" placeholder="e.g. 62"></div>
            </div>
            <div class="result" style="margin-top:14px"><strong id="gpa-cum">${r.hasData ? r.cumulative.toFixed(2) : '0.00'}</strong><span>Cumulative GPA</span></div>
          </section>
        </div>
      </div>`;
  }

  function updateGpaResults() {
    const r = gpaCalc();
    setText('#gpa-sem', r.credits ? r.semester.toFixed(2) : '0.00');
    setText('#gpa-cum', r.hasData ? r.cumulative.toFixed(2) : '0.00');
    setText('#gpa-credits', String(r.credits));
  }

  /* ----- Pomodoro (view) ----- */
  function renderPomodoro() {
    const s = state.pomodoro.settings;
    const t = today();
    const todays = state.pomodoro.sessions.filter(x => x.date === t);
    const minutes = todays.reduce((n, x) => n + Number(x.minutes || 0), 0);
    const progress = timer.total ? (timer.total - timer.remaining) / timer.total : 0;
    const modes = [['focus', 'Focus'], ['short', 'Short break'], ['long', 'Long break']];

    return `
      <div class="stack">
        <section class="card timer-card mode-${timer.mode}" id="timer-card">
          <div class="modes" role="group" aria-label="Timer mode">
            ${modes.map(([key, label]) => `<button type="button" class="${timer.mode === key ? 'on' : ''}" data-action="timer-mode" data-mode="${key}">${label}</button>`).join('')}
          </div>
          <div class="timer-ring">
            ${ringSVG(progress, { size: 260, stroke: 14, id: 'timer-ring' })}
            <div class="ring-center">
              <div class="timer-time" id="timer-time">${fmtClock(timer.remaining)}</div>
              <p class="timer-label" id="timer-label">${timerLabel()}</p>
            </div>
          </div>
          <div class="timer-actions">
            <button class="btn primary lg" type="button" id="timer-toggle" data-action="timer-toggle">${toggleLabel()}</button>
            <button class="btn ghost lg" type="button" data-action="timer-reset">Reset</button>
            <button class="btn ghost lg" type="button" data-action="timer-skip">Skip</button>
          </div>
          <div class="field timer-subject">
            <label for="timer-subject">Studying</label>
            <select id="timer-subject" data-timer="subject">
              <option value="">General</option>
              ${state.subjects.map(sub => `<option value="${sub.id}" ${timer.subjectId === sub.id ? 'selected' : ''}>${esc(sub.name)}</option>`).join('')}
            </select>
          </div>
        </section>

        <div class="cols">
          <section class="card">
            <div class="card-head"><h3>Today</h3></div>
            <dl class="facts">
              <div><dt>Focus sessions</dt><dd>${todays.length}</dd></div>
              <div><dt>Minutes focused</dt><dd>${minutes}</dd></div>
              <div><dt>Sessions until long break</dt><dd>${s.longEvery - (timer.cycle % s.longEvery)}</dd></div>
            </dl>
          </section>
          <section class="card">
            <div class="card-head"><h3>Durations (minutes)</h3></div>
            <div class="settings-grid">
              <div class="field"><label for="d-focus">Focus</label><input id="d-focus" type="number" min="1" max="180" data-timer="focus" value="${s.focus}"></div>
              <div class="field"><label for="d-short">Short break</label><input id="d-short" type="number" min="1" max="60" data-timer="short" value="${s.short}"></div>
              <div class="field"><label for="d-long">Long break</label><input id="d-long" type="number" min="1" max="90" data-timer="long" value="${s.long}"></div>
              <div class="field"><label for="d-every">Long break every</label><input id="d-every" type="number" min="2" max="10" data-timer="longEvery" value="${s.longEvery}"></div>
            </div>
          </section>
        </div>
      </div>`;
  }

  /* ----- Expenses ----- */
  function renderExpenses() {
    const now = new Date();
    const ws = weekStart();
    const weekTotal = expensesBetween(toISO(ws), toISO(addDays(ws, 6)));
    const monthPrefix = today().slice(0, 7);
    const monthItems = state.expenses.filter(e => e.date.startsWith(monthPrefix));
    const monthTotal = monthItems.reduce((n, e) => n + Number(e.amount || 0), 0);
    const allTotal = state.expenses.reduce((n, e) => n + Number(e.amount || 0), 0);

    const byCat = {};
    monthItems.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0); });
    const catRows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const maxCat = catRows.length ? catRows[0][1] : 1;

    const list = state.expenses.slice().sort((a, b) => b.date.localeCompare(a.date));

    return `
      <div class="stack">
        <section class="stats" style="margin-bottom:0">
          <div class="stat"><span class="stat-ic">${icon('wallet', 24)}</span><div><p>This week</p><strong>${money(weekTotal)}</strong></div></div>
          <div class="stat"><span class="stat-ic">${icon('calendar', 24)}</span><div><p>${now.toLocaleDateString('en-US', { month: 'long' })}</p><strong>${money(monthTotal)}</strong></div></div>
          <div class="stat"><span class="stat-ic">${icon('tasks', 24)}</span><div><p>All time</p><strong>${money(allTotal)}</strong></div></div>
        </section>

        <section class="card">
          <div class="card-head"><h3>Add expense</h3></div>
          <form class="exp-form" data-form="expense">
            <div class="field"><label for="x-desc">What for</label><input id="x-desc" name="desc" placeholder="e.g. Lunch" autocomplete="off"></div>
            <div class="field"><label for="x-amt">Amount (ETB)</label><input id="x-amt" name="amount" type="number" min="0" step="0.01" inputmode="decimal" required></div>
            <div class="field"><label for="x-cat">Category</label><select id="x-cat" name="category">${CATEGORIES.map(c => `<option>${esc(c)}</option>`).join('')}</select></div>
            <div class="field"><label for="x-date">Date</label><input id="x-date" name="date" type="date" value="${today()}" required></div>
            <button class="btn primary" type="submit">${icon('plus', 18)} Add</button>
          </form>
        </section>

        <div class="cols">
          <section class="card">
            <div class="card-head"><h3>Where it went this month</h3></div>
            ${catRows.length ? `<div class="bars">${catRows.map(([cat, amt]) => `
              <div class="bar-row"><header><span>${esc(cat)}</span><span>${money(amt)}</span></header>
              <div class="bar"><span style="width:${Math.max(4, (amt / maxCat) * 100)}%"></span></div></div>`).join('')}</div>`
              : emptyState('No spending this month', 'Expenses you add will be grouped by category here.')}
          </section>
          <section class="card">
            <div class="card-head"><h3>Recent expenses</h3></div>
            ${list.length ? `<div class="exp-list">${list.slice(0, 30).map(e => `
              <div class="exp">
                <div class="exp-main"><strong>${esc(e.desc)}</strong><span class="muted small">${esc(e.category)}, ${fmtDate(e.date)}</span></div>
                <span class="exp-amt">${money(e.amount)}</span>
                <button class="icon-btn sm plain del" type="button" data-action="exp-del" data-id="${e.id}" aria-label="Delete expense">${icon('trash', 18)}</button>
              </div>`).join('')}</div>`
              : emptyState('No expenses yet', 'Add your first one with the form above.')}
          </section>
        </div>
      </div>`;
  }

  /* ----- Settings ----- */
  function renderSettings() {
    return `
      <div class="stack" style="max-width:640px">
        <section class="card">
          <div class="card-head"><h3>Your name</h3></div>
          <form class="inline-form" data-form="profile">
            <div class="field"><label for="p-name">Shown on your dashboard</label>
              <input id="p-name" name="name" value="${esc(state.profile.name)}" placeholder="Student" autocomplete="off" maxlength="40"></div>
            <button class="btn primary" type="submit">Save</button>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h3>Your data</h3></div>
          <p class="muted" style="margin-bottom:14px">Everything is stored in this browser only. Export a backup before clearing your browser data or switching devices.</p>
          <div class="setting-row">
            <button class="btn ghost" type="button" data-action="data-export">Export backup</button>
            <button class="btn ghost" type="button" data-action="data-import">Import backup</button>
            <button class="btn danger" type="button" data-action="data-reset">Delete all data</button>
          </div>
        </section>
      </div>`;
  }

  /* ---------- 5. Pomodoro engine ---------- */
  const timer = { mode: 'focus', total: 0, remaining: 0, running: false, endAt: 0, cycle: 0, subjectId: '' };
  const modeMinutes = mode => state.pomodoro.settings[mode === 'focus' ? 'focus' : mode];
  const timerLabel = () => ({ focus: 'Time to focus', short: 'Short break', long: 'Long break' }[timer.mode]);
  const toggleLabel = () => (timer.running ? 'Pause' : timer.remaining < timer.total ? 'Resume' : 'Start');

  function setMode(mode) {
    timer.mode = mode;
    timer.total = Math.max(1, Number(modeMinutes(mode)) || 25) * 60;
    timer.remaining = timer.total;
    timer.running = false;
  }

  let audioCtx;
  function ensureAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* sound is optional */ }
  }
  function beep() {
    try {
      ensureAudio();
      [0, 0.3, 0.6].forEach(offset => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const t0 = audioCtx.currentTime + offset;
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(t0); o.stop(t0 + 0.25);
      });
    } catch (e) { /* sound is optional */ }
  }

  function toggleTimer() {
    if (timer.running) {
      timer.remaining = Math.max(0, Math.ceil((timer.endAt - Date.now()) / 1000));
      timer.running = false;
    } else {
      if (timer.remaining <= 0) timer.remaining = timer.total;
      timer.endAt = Date.now() + timer.remaining * 1000;
      timer.running = true;
      ensureAudio();
    }
    updateTimerUI();
  }

  function completeTimer() {
    timer.running = false;
    timer.remaining = 0;
    beep();
    if (timer.mode === 'focus') {
      state.pomodoro.sessions.push({ id: uid(), date: today(), minutes: Number(state.pomodoro.settings.focus) || 25, subjectId: timer.subjectId });
      markActive();
      save();
      timer.cycle++;
      const long = timer.cycle % (Number(state.pomodoro.settings.longEvery) || 4) === 0;
      toast(`Focus session complete. Take a ${long ? 'long' : 'short'} break.`);
      setMode(long ? 'long' : 'short');
    } else {
      toast('Break over. Ready for another focus session?');
      setMode('focus');
    }
    const route = currentRoute();
    if (route === 'pomodoro' || route === 'dashboard') render();
  }

  function updateTimerUI() {
    const clock = fmtClock(timer.remaining);
    setText('#timer-time', clock);
    setText('#timer-label', timerLabel());
    setText('#timer-toggle', toggleLabel());
    const ring = $('#timer-ring');
    if (ring) {
      const c = Number(ring.dataset.c);
      const progress = timer.total ? (timer.total - timer.remaining) / timer.total : 0;
      ring.style.strokeDashoffset = c * (1 - progress);
    }
    const card = $('#timer-card');
    if (card) card.className = `card timer-card mode-${timer.mode}`;
    document.title = timer.running
      ? `${clock} ${timerLabel()} | STUDYX`
      : 'STUDYX — Student Command Center';
  }

  setInterval(() => {
    if (timer.running) {
      const left = Math.ceil((timer.endAt - Date.now()) / 1000);
      timer.remaining = Math.max(0, left);
      if (left <= 0) { completeTimer(); return; }
    }
    updateTimerUI();
  }, 250);

  /* ---------- 6. Theme, routing, events ---------- */
  const currentTheme = () => state.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  function applyTheme() {
    const t = currentTheme();
    document.documentElement.setAttribute('data-theme', t);
    $('#theme-btn').innerHTML = icon(t === 'dark' ? 'sun' : 'moon', 20);
    $('#theme-btn-side').innerHTML = `${icon(t === 'dark' ? 'sun' : 'moon', 18)} ${t === 'dark' ? 'Light mode' : 'Dark mode'}`;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0e1322' : '#2843d4');
  }

  function updateAvatar() {
    setText('#avatar', (state.profile.name.trim()[0] || 'S').toUpperCase());
  }

  function buildNav() {
    $('#nav').innerHTML = Object.entries(VIEWS).map(([key, v]) =>
      `<a href="#/${key}" data-route="${key}">${icon(v.icon)}<span>${v.nav}</span></a>`).join('');
  }

  function currentRoute() {
    const key = location.hash.replace(/^#\//, '');
    return VIEWS[key] ? key : 'dashboard';
  }

  function render() {
    const route = currentRoute();
    const view = VIEWS[route];
    $('#view').innerHTML = view.render();
    setText('#page-title', view.title);
    $$('#nav a').forEach(a => {
      const on = a.dataset.route === route;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    updateTimerUI();
  }

  const closeNav = () => document.body.classList.remove('nav-open');

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const find = (list, id) => list.find(x => x.id === id);

  const actions = {
    'nav-open': () => document.body.classList.add('nav-open'),
    'nav-close': closeNav,
    'modal-close': () => $('#modal').close(),
    theme: () => { state.theme = currentTheme() === 'dark' ? 'light' : 'dark'; save(); applyTheme(); },
    'edit-name': () => openForm({
      title: 'Your name',
      values: { name: state.profile.name },
      fields: [{ name: 'name', label: 'What should we call you?', placeholder: 'Student' }],
      onSave: d => { state.profile.name = d.name.trim().slice(0, 40); save(); updateAvatar(); render(); }
    }),

    // subjects
    'subject-add': () => subjectForm(),
    'subject-edit': ({ id }) => subjectForm(find(state.subjects, id)),
    'subject-del': ({ id }) => {
      const s = find(state.subjects, id);
      if (!s || !confirm(`Delete "${s.name}"?\n\nIts classes are removed from your timetable. Its assignments stay and move to General.`)) return;
      state.subjects = state.subjects.filter(x => x.id !== id);
      state.timetable = state.timetable.filter(t => t.subjectId !== id);
      state.assignments.forEach(a => { if (a.subjectId === id) a.subjectId = ''; });
      if (timer.subjectId === id) timer.subjectId = '';
      save(); render(); toast('Subject deleted.');
    },

    // assignments
    'assign-add': () => assignmentForm(),
    'assign-edit': ({ id }) => assignmentForm(find(state.assignments, id)),
    'assign-del': ({ id }) => {
      const a = find(state.assignments, id);
      if (!a || !confirm(`Delete "${a.title}"?`)) return;
      state.assignments = state.assignments.filter(x => x.id !== id);
      save(); render(); toast('Assignment deleted.');
    },
    'assign-toggle': ({ id }) => {
      const a = find(state.assignments, id);
      if (!a) return;
      a.done = !a.done;
      a.doneAt = a.done ? today() : null;
      if (a.done) markActive();
      save(); render();
    },
    'assign-filter': ({ filter }) => { ui.assignFilter = filter; render(); },

    // timetable
    'tt-add': ({ day }) => timetableForm(null, day === undefined ? undefined : Number(day)),
    'tt-edit': ({ id }) => timetableForm(find(state.timetable, id)),
    'tt-del': ({ id }) => {
      if (!confirm('Delete this class?')) return;
      state.timetable = state.timetable.filter(x => x.id !== id);
      save(); render(); toast('Class deleted.');
    },

    // gpa
    'gpa-add': () => {
      state.gpa.courses.push({ id: uid(), name: '', credits: 3, grade: '' });
      save(); render();
      const names = $$('.gpa-row [data-gpa="name"]');
      if (names.length) names[names.length - 1].focus();
    },
    'gpa-del': ({ id }) => { state.gpa.courses = state.gpa.courses.filter(c => c.id !== id); save(); render(); },
    'gpa-clear': () => {
      if (!confirm('Remove all courses from the GPA calculator?')) return;
      state.gpa.courses = []; save(); render();
    },
    'gpa-import': () => {
      const have = new Set(state.gpa.courses.map(c => c.name.trim().toLowerCase()));
      const fresh = state.subjects.filter(s => !have.has(s.name.trim().toLowerCase()));
      if (!state.subjects.length) { toast('You have no subjects to import yet.'); return; }
      if (!fresh.length) { toast('All your subjects are already in the list.'); return; }
      fresh.forEach(s => state.gpa.courses.push({ id: uid(), name: s.name, credits: s.credits, grade: '' }));
      save(); render(); toast(`Imported ${fresh.length} subject${fresh.length === 1 ? '' : 's'}. Now pick your grades.`);
    },

    // pomodoro
    'timer-toggle': toggleTimer,
    'timer-reset': () => { setMode(timer.mode); updateTimerUI(); },
    'timer-skip': () => { setMode(timer.mode === 'focus' ? 'short' : 'focus'); render(); },
    'timer-mode': ({ mode }) => {
      if (timer.running) { toast('Pause the timer to switch modes.'); return; }
      setMode(mode); render();
    },

    // expenses
    'exp-del': ({ id }) => {
      state.expenses = state.expenses.filter(x => x.id !== id);
      save(); render(); toast('Expense deleted.');
    },

    // data
    'data-export': () => { download(`studyx-backup-${today()}.json`, JSON.stringify(state, null, 2)); toast('Backup downloaded.'); },
    'data-import': () => $('#import-file').click(),
    'data-reset': () => {
      if (!confirm('Delete ALL STUDYX data from this browser? This cannot be undone.')) return;
      state = defaultState();
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
      setMode('focus'); timer.cycle = 0; timer.subjectId = '';
      applyTheme(); updateAvatar(); render(); toast('All data deleted.');
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el.dataset, el);
  });

  // Close the dialog when the dark backdrop is clicked
  $('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // Inline forms (expenses, profile)
  document.addEventListener('submit', e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));

    if (form.dataset.form === 'expense') {
      const amount = parseFloat(d.amount);
      if (!(amount > 0)) { toast('Enter an amount greater than 0.'); return; }
      state.expenses.push({
        id: uid(),
        desc: (d.desc || '').trim() || d.category,
        amount,
        category: d.category,
        date: d.date || today()
      });
      save(); render(); toast('Expense added.');
    }

    if (form.dataset.form === 'profile') {
      state.profile.name = (d.name || '').trim().slice(0, 40);
      save(); updateAvatar(); toast('Name saved.');
    }
  });

  // Live GPA editing + pomodoro settings
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.gpa) {
      const row = el.closest('.gpa-row');
      const course = row && find(state.gpa.courses, row.dataset.id);
      if (!course) return;
      course[el.dataset.gpa] = el.value;
      save(); updateGpaResults();
    } else if (el.dataset.gpaPrev) {
      state.gpa[el.dataset.gpaPrev] = el.value;
      save(); updateGpaResults();
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.gpa === 'grade') { // selects fire change; keep results in sync
      const row = el.closest('.gpa-row');
      const course = row && find(state.gpa.courses, row.dataset.id);
      if (course) { course.grade = el.value; save(); updateGpaResults(); }
    }
    if (el.dataset.timer === 'subject') { timer.subjectId = el.value; return; }
    if (el.dataset.timer) {
      const limits = { focus: [1, 180], short: [1, 60], long: [1, 90], longEvery: [2, 10] };
      const [min, max] = limits[el.dataset.timer];
      const v = Math.min(max, Math.max(min, Math.round(Number(el.value)) || min));
      el.value = v;
      state.pomodoro.settings[el.dataset.timer] = v;
      save();
      if (!timer.running) { setMode(timer.mode); updateTimerUI(); }
    }
  });

  $('#import-file').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object' || !Array.isArray(data.subjects)) throw new Error('Not a STUDYX backup');
        if (!confirm('Replace your current data with this backup?')) return;
        state = normalize(data);
        save(); setMode('focus'); applyTheme(); updateAvatar(); render();
        toast('Backup restored.');
      } catch (err) {
        toast('That file is not a valid STUDYX backup.');
      }
    };
    reader.readAsText(file);
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNav(); });
  window.addEventListener('hashchange', () => { closeNav(); render(); window.scrollTo(0, 0); });

  // Keep in sync if STUDYX is open in two tabs
  window.addEventListener('storage', e => {
    if (e.key === STORE_KEY) { state = load(); applyTheme(); updateAvatar(); render(); }
  });

  /* ---------- Start ---------- */
  function init() {
    buildNav();
    setMode('focus');
    applyTheme();
    updateAvatar();
    $('.menu-btn').innerHTML = icon('menu', 22);
    setText('#page-date', new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
    render();
  }
  init();
})();
