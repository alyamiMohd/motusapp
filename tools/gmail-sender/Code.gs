// Motus sign-in codes from your own Gmail (Google Apps Script, deployed as a web app).
// The Motus server calls it with { secret, to, code }; it sends one fixed email and nothing else.
// Setup (owner): script.google.com → New project → paste this → Deploy → New deployment → Web app,
// Execute as: Me, Who has access: Anyone → copy the /exec URL. The secret below must match the server's GMAIL_SECRET
// (a copy with it filled in is written to Code.local.gs, which is never committed).
var SECRET = 'REPLACE_WITH_SECRET';

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return reply({ ok: false, error: 'bad_json' }); }
  if (SECRET.length < 32 || body.secret !== SECRET) return reply({ ok: false, error: 'forbidden' });
  var to = String(body.to || ''), code = String(body.code || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to) || !/^\d{6}$/.test(code)) return reply({ ok: false, error: 'bad_request' });
  if (MailApp.getRemainingDailyQuota() < 1) return reply({ ok: false, error: 'quota' });
  MailApp.sendEmail({
    to: to,
    name: 'Motus',
    subject: 'Your Motus code: ' + code,
    body: 'Your Motus sign-in code is ' + code + '\n\nIt works for 10 minutes. If you didn\'t ask for it, you can ignore this email.\n',
  });
  return reply({ ok: true });
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
