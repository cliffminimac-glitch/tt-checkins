// /api/feedback/index.js
// Handles GET (load submissions) and POST (save submission)
// Storage: Vercel Blob — submissions stored as JSON files at feedback/{type}/{employee}/{period}__{ts}.json
// Each write goes to a UNIQUE timestamped key to avoid CDN stale-content issues on overwrite.

import { put, list } from '@vercel/blob';

const CORS = {
  'Access-Control-Allow-Origin': 'https://tt-checkins.vercel.app',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: load submissions ──────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { type, employee } = req.query;

      // Build prefix to narrow the blob list
      let prefix = 'feedback/';
      if (type && employee) {
        prefix = `feedback/${sanitize(type)}/${sanitize(employee)}/`;
      } else if (type) {
        prefix = `feedback/${sanitize(type)}/`;
      }

      // List all matching blobs (may include multiple versions per record)
      const { blobs } = await list({ prefix, token: process.env.BLOB_READ_WRITE_TOKEN });

      const records = await Promise.all(
        blobs.map(b => {
          // downloadUrl bypasses CDN caching (always fresh)
          const fetchUrl = b.downloadUrl || b.url;
          const headers = b.downloadUrl ? { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } : {};
          return fetch(fetchUrl, { headers }).then(r => r.ok ? r.json() : null).catch(() => null);
        })
      );

      let results = records.filter(r => r && !r._delete);

      // Sort: released records first, then newest savedAt
      results.sort((a, b) => {
        const aTime = new Date(a.releasedAt || a.savedAt || a.date || 0);
        const bTime = new Date(b.releasedAt || b.savedAt || b.date || 0);
        return bTime - aTime;
      });

      // Deduplicate: keep only the most recent/released record per (type + employee + period)
      const seen = new Set();
      results = results.filter(r => {
        const period = r.week || r.month || '';
        const key = `${r.type}|${r.employee}|${period}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      return res.status(200).json(results);
    } catch (err) {
      console.error('GET /api/feedback error:', err);
      return res.status(500).json({ error: 'Failed to load submissions' });
    }
  }

  // ── POST: save submission ──────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const data = req.body;
      if (!data || !data.type || !data.employee) {
        return res.status(400).json({ error: 'Missing required fields: type, employee' });
      }

      // Determine period key
      const period = data.week || data.month || new Date().toISOString().slice(0, 10);
      const baseKey = `feedback/${sanitize(data.type)}/${sanitize(data.employee)}/${sanitize(period)}`;

      // Read latest version of this record to merge (preserves manager/employee fields)
      let existing = {};
      try {
        const existingBlobs = await list({ prefix: baseKey, token: process.env.BLOB_READ_WRITE_TOKEN });
        if (existingBlobs.blobs.length > 0) {
          // Sort by upload time to get the latest version
          const latest = existingBlobs.blobs.sort((a, b) =>
            new Date(b.uploadedAt) - new Date(a.uploadedAt)
          )[0];
          const fetchUrl = latest.downloadUrl || latest.url;
          const headers = latest.downloadUrl ? { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } : {};
          const existingRes = await fetch(fetchUrl, { headers });
          if (existingRes.ok) existing = await existingRes.json();
        }
      } catch (_) { /* first save, no existing record */ }

      // Always write to a NEW timestamped key to avoid CDN staleness
      const ts = Date.now();
      const key = `${baseKey}__${ts}.json`;

      const record = {
        ...existing,
        ...data,
        id: baseKey + '.json', // logical id (period-based, not timestamp-based)
        savedAt: new Date().toISOString(),
        released: data.released ?? existing.released ?? false,
        releasedAt: data.releasedAt ?? existing.releasedAt ?? undefined,
      };
      // Clean up undefined fields
      if (!record.releasedAt) delete record.releasedAt;

      await put(key, JSON.stringify(record), {
        access: 'public',
        contentType: 'application/json',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      return res.status(200).json({ ok: true, id: baseKey + '.json' });
    } catch (err) {
      console.error('POST /api/feedback error:', err);
      return res.status(500).json({ error: 'Failed to save submission' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Helpers ────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}
