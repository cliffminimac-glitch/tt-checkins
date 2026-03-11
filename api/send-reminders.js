// /api/send-reminders.js
// Sends personalized email reminders to all team members with their direct meeting links
// Uses Resend (resend.com) — free tier: 3,000 emails/month
// Setup: create account at resend.com, get API key, add RESEND_API_KEY to Vercel env vars
//        Also set RESEND_FROM_EMAIL env var (e.g. "checkins@tigertracks.ai" — must be verified domain)

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// ── Team roster (mirrors orgChart in index.html) ──────────────────
const EMAIL_MAP = {
  "Riley Abercrombie":    "riley@tigertracks.ai",
  "Hannah Price":         "hannah@tigertracks.ai",
  "Charlotte Pohl":       "charlotte@tigertracks.ai",
  "Allison Long":         "allison@tigertracks.ai",
  "Rachel Scharett":      "rachael@tigertracks.ai",
  "Shelby Nations":       "shelby@tigertracks.ai",
  "Owen Phipps":          "owen@tigertracks.ai",
  "Megan Brenneke":       "meganb@tigertracks.ai",
  "Seth McDaniel":        "seth@tigertracks.ai",
  "Mary McCambridge":     "mary@tigertracks.ai",
  "Will Sokol":           "will@tigertracks.ai",
  "Gretchen Hess":        "gretchen@tigertracks.ai",
  "Megan Klein":          "megank@tigertracks.ai",
  "Daren Kalkoffen":      "daren@tigertracks.ai",
  "Evin Leclerc":         "evin@tigertracks.ai",
  "Kiyana Saidi-Nejad":   "kiyana@tigertracks.ai",
  "Billy Bevevino":       "billy@tigertracks.ai",
  "Tate Dewey":           "tate@tigertracks.ai",
  "Sanad Shuman":         "sanad@tigertracks.ai",
  "Alex Blumberg":        "alex@tigertracks.ai",
  "Steven Jatich":        "steven@tigertracks.ai",
  "Kersten Kruse":        "kersten@tigertracks.ai",
  "Anirudh Venkat":       "anirudh@tigertracks.ai",
  "Ashley Kaika":         "ashley@tigertracks.ai",
};

const ORG_CHART = {
  "Riley Abercrombie":    { manager: "Rachel Scharett",  role: "Associate Director" },
  "Hannah Price":         { manager: "Rachel Scharett",  role: "Associate Director" },
  "Charlotte Pohl":       { manager: "Rachel Scharett",  role: "Associate Director" },
  "Allison Long":         { manager: "Charlotte Pohl",   role: "Senior Account Manager" },
  "Rachel Scharett":      { manager: "",                 role: "Senior Director" },
  "Shelby Nations":       { manager: "Riley Abercrombie",role: "Senior Account Manager" },
  "Owen Phipps":          { manager: "Shelby Nations",   role: "Account Strategist" },
  "Megan Brenneke":       { manager: "Shelby Nations",   role: "Account Strategist" },
  "Seth McDaniel":        { manager: "Shelby Nations",   role: "Account Strategist" },
  "Mary McCambridge":     { manager: "Hannah Price",     role: "Senior Account Manager" },
  "Will Sokol":           { manager: "Hannah Price",     role: "Senior Account Manager" },
  "Gretchen Hess":        { manager: "Mary McCambridge", role: "Account Manager" },
  "Megan Klein":          { manager: "Will Sokol",       role: "Account Manager" },
  "Daren Kalkoffen":      { manager: "Gretchen Hess",    role: "Account Strategist" },
  "Evin Leclerc":         { manager: "Gretchen Hess",    role: "Account Coordinator" },
  "Kiyana Saidi-Nejad":   { manager: "Charlotte Pohl",   role: "Account Manager" },
  "Billy Bevevino":       { manager: "Kiyana Saidi-Nejad",role: "Account Strategist" },
  "Tate Dewey":           { manager: "Kiyana Saidi-Nejad",role: "Account Strategist" },
  "Sanad Shuman":         { manager: "Billy Bevevino",   role: "Account Coordinator" },
  "Alex Blumberg":        { manager: "Ashley Kaika",     role: "Head of Partnerships" },
  "Steven Jatich":        { manager: "Ashley Kaika",     role: "Partnerships Director" },
  "Kersten Kruse":        { manager: "Ashley Kaika",     role: "Director of Marketing" },
  "Anirudh Venkat":       { manager: "Kersten Kruse",    role: "Head of Analytics" },
  "Ashley Kaika":         { manager: "",                 role: "VP of Partnerships" },
};

const ROLE_ABBR = {
  "Account Coordinator": "AC",
  "Account Strategist":  "AS",
  "Account Manager":     "AM",
  "Senior Account Manager": "SAM",
  "Associate Director":  "AD",
  "Senior Director":     "SD",
  "Director":            "Dir",
  "Partnerships Director": "Partnerships Dir",
  "Head of Partnerships": "Head of Partnerships",
  "Director of Marketing": "Director of Marketing",
  "Head of Analytics":   "Head of Analytics",
  "VP of Partnerships":  "VP of Partnerships",
};

const BASE_URL = 'https://tt-checkins.vercel.app';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://tt-checkins.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, period } = req.body;

  if (!type || !period) {
    return res.status(400).json({ error: 'Missing fields: type, period' });
  }

  const results = [];

  for (const [name, person] of Object.entries(ORG_CHART)) {
    if (!person.manager) continue; // skip top-level (no manager = they send reminders, not receive them)

    const email = EMAIL_MAP[name];
    if (!email) continue;

    const roleAbbr = ROLE_ABBR[person.role] || person.role;
    let link, subject, bodyHtml;

    if (type === 'weekly') {
      link = `${BASE_URL}/?section=weekly&employee=${enc(name)}&manager=${enc(person.manager)}&role=${enc(roleAbbr)}&week=${enc(period)}`;
      subject = `⏰ Weekly Check-In Reminder — Week of ${period}`;
      bodyHtml = weeklyEmailHtml(name, person.manager, period, link);
    } else {
      link = `${BASE_URL}/?section=monthly&employee=${enc(name)}&manager=${enc(person.manager)}&role=${enc(person.role)}&month=${enc(period)}`;
      subject = `📋 Monthly Feedback Reminder — ${period}`;
      bodyHtml = monthlyEmailHtml(name, person.manager, period, link);
    }

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Tiger Tracks Check-Ins <checkins@tigertracks.ai>',
        to: email,
        subject,
        html: bodyHtml,
      });
      results.push({ name, email, sent: true });
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err);
      results.push({ name, email, sent: false, error: err.message });
    }
  }

  const sent = results.filter(r => r.sent).length;
  return res.status(200).json({ ok: true, sent, total: results.length, results });
}

function enc(str) { return encodeURIComponent(str); }

function weeklyEmailHtml(name, manager, week, link) {
  const first = name.split(' ')[0];
  return `
<!DOCTYPE html><html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px;text-align:center;">
    <img src="${BASE_URL}/logo.png" style="height:36px;margin-bottom:8px;" alt="Tiger Tracks"/>
    <div style="color:#229FA1;font-weight:800;font-size:13px;letter-spacing:1px;">TIGER TRACKS CHECK-INS</div>
  </div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Hey ${first} 👋</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">
      Time for your weekly check-in for <strong>week of ${week}</strong>.
      Your manager <strong>${manager}</strong> will review your responses.
    </p>
    <a href="${link}" style="display:inline-block;background:#229FA1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;">
      Open My Weekly Check-In →
    </a>
    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
      Sign in with your <strong>@tigertracks.ai</strong> Google account.
      Questions? Contact <a href="mailto:elizabeth@tigertracks.ai" style="color:#229FA1;">elizabeth@tigertracks.ai</a>
    </p>
  </div>
</div>
</body></html>`;
}

function monthlyEmailHtml(name, manager, month, link) {
  const first = name.split(' ')[0];
  return `
<!DOCTYPE html><html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:24px 32px;text-align:center;">
    <img src="${BASE_URL}/logo.png" style="height:36px;margin-bottom:8px;" alt="Tiger Tracks"/>
    <div style="color:#229FA1;font-weight:800;font-size:13px;letter-spacing:1px;">TIGER TRACKS CHECK-INS</div>
  </div>
  <div style="padding:32px;">
    <h2 style="margin:0 0 8px;font-size:20px;color:#1a1a2e;">Hey ${first} 👋</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">
      Your <strong>${month} Monthly Feedback Review</strong> is ready for you to complete.
      Take a few minutes to reflect — your manager <strong>${manager}</strong> will add their assessment.
    </p>
    <a href="${link}" style="display:inline-block;background:#229FA1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px;">
      Open My Monthly Review →
    </a>
    <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
      Sign in with your <strong>@tigertracks.ai</strong> Google account.
      Questions? Contact <a href="mailto:elizabeth@tigertracks.ai" style="color:#229FA1;">elizabeth@tigertracks.ai</a>
    </p>
  </div>
</div>
</body></html>`;
}
