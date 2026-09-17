// Synthetic local preview for the public funder evidence page.

const express = require('express');
const path = require('path');
const { _renderPage } = require('../src/dashboard');

const app = express();
const today = new Date();
const byDay = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(today.getTime() - (29 - index) * 86_400_000);
  const pattern = [0, 1, 0, 2, 1, 3, 0, 1, 2, 0];
  return { day: date.toISOString().slice(0, 10), count: pattern[index % pattern.length] };
});

app.use('/dashboard/assets', express.static(path.join(__dirname, '..', 'sanko-landing page', 'public', 'fonts')));
app.get('/dashboard', (_req, res) => res.type('html').send(_renderPage({
  practitioners: 18,
  formulations: 247,
  byDay,
  mappingCount: 221,
  speciesCount: 110,
  updated_at: new Date().toISOString(),
  preview: true,
})));

const port = Number(process.env.DASHBOARD_PREVIEW_PORT || 4175);
app.listen(port, '127.0.0.1', () => console.log(`Dashboard preview: http://127.0.0.1:${port}/dashboard`));
