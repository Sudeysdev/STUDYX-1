# STUDYX — Student Command Center

A single-page study planner built with plain HTML, CSS and JavaScript. No frameworks, no build step, no backend. Everything is saved in your browser with `localStorage`.

## Features

- **Dashboard** with a greeting, key stats, upcoming assignments, today's classes, progress ring and streak
- **Subjects** with colour, course code, credit hours and instructor
- **Assignments** with due dates, priority, filters (pending, done, all) and overdue warnings
- **Timetable** with a weekly schedule; today is highlighted
- **GPA calculator** on a 4.0 scale, with semester and cumulative GPA
- **Pomodoro timer** with focus, short break and long break, custom durations and a sound when a session ends
- **Expenses** in ETB with weekly and monthly totals and a category breakdown
- **Study streak** that grows when you finish a focus session or complete an assignment
- **Dark mode** that remembers your choice
- **Backup** export and import as a JSON file

## Run it locally

Open the folder in VS Code and start **Live Server** on `index.html`, or just double-click `index.html`.

## Project structure

```
studyx/
├── index.html
├── css/style.css
├── js/app.js
└── README.md
```

## Push to GitHub

```bash
cd studyx
git init
git add .
git commit -m "Initial commit: STUDYX student command center"
git branch -M main
git remote add origin https://github.com/Sudeysdev/studyx.git
git push -u origin main
```

Create an empty repository named `studyx` on GitHub first (no README, no .gitignore).

## Host it free with GitHub Pages

Repository → **Settings** → **Pages** → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save.
Your app will be live at `https://sudeysdev.github.io/studyx/`.

## Customising

- **Grade scale:** edit `GRADE_POINTS` at the top of `js/app.js`.
- **Expense categories:** edit `CATEGORIES`.
- **Colours and fonts:** edit the variables at the top of `css/style.css`.
- **Storage:** all data is under the key `studyx:v1`. Use Settings → Export backup before clearing browser data.
