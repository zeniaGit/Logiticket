import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import multer from 'multer';
import sharp from 'sharp';

const { DATABASE_URL, SESSION_SECRET, NODE_ENV = 'development', PORT = 3001 } = process.env;
if (!DATABASE_URL || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Configura DATABASE_URL y SESSION_SECRET (mínimo 32 caracteres).'); process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
await mkdir(uploadDir, { recursive: true });
const posterUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, done) => {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype)) return done(new Error('Formato no válido. Usa JPG, PNG, WebP o AVIF.'));
  done(null, true);
} });
async function getPosterEdgeColor(input) {
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' })
    .rotate().flatten({ background: '#f5f5f0' }).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const edge = [];
  for (let y = 2; y < info.height - 2; y++) for (let x = 2; x < info.width - 2; x++) {
    if (x >= 4 && x < info.width - 4 && y >= 4 && y < info.height - 4) continue;
    const i = (y * info.width + x) * info.channels;
    edge.push([data[i], data[i + 1], data[i + 2]]);
  }
  const median = channel => edge.map(pixel => pixel[channel]).sort((a, b) => a - b)[Math.floor(edge.length / 2)];
  return { r: median(0), g: median(1), b: median(2), alpha: 1 };
}
const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), "style-src": ["'self'", 'https://fonts.googleapis.com'], "font-src": ["'self'", 'https://fonts.gstatic.com'], "img-src": ["'self'", 'data:', 'https://res.cloudinary.com'] } } }));
app.use(express.json({ limit: '64kb' }));
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  name: 'logiticket.sid', secret: SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static('public', { index: false, maxAge: NODE_ENV === 'production' ? '1h' : 0 }));
app.use('/uploads', express.static(uploadDir, { index: false, maxAge: NODE_ENV === 'production' ? '30d' : 0, immutable: NODE_ENV === 'production' }));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-8', legacyHeaders: false });
const rolesCanManage = new Set(['owner', 'admin', 'event_manager']);
const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugify = value => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'evento';
const csrfSafe = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); };
const api = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const audit = (client, req, organizerId, entityType, entityId, action, details = {}) => client.query(
  `INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
  [req.session.userId || null, organizerId || null, entityType, entityId || null, action, JSON.stringify(details)]
);
const requireCsrf = (req, res, next) => { if (!csrfSafe(req.session.csrfToken, req.get('x-csrf-token'))) return res.status(403).json({ error: 'Token CSRF no válido. Recarga la página.' }); next(); };
const requireAuth = api(async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Inicia sesión.' });
  const currentUser = await pool.query('SELECT platform_role,is_active FROM users WHERE id=$1', [req.session.userId]);
  if (!currentUser.rowCount || !currentUser.rows[0].is_active) {
    req.session.destroy(() => {}); return res.status(401).json({ error: 'La cuenta está desactivada.' });
  }
  req.session.platformRole = currentUser.rows[0].platform_role;
  if (req.session.organizerId) {
    const membership = await pool.query('SELECT role FROM organizer_members WHERE organizer_id=$1 AND user_id=$2', [req.session.organizerId,req.session.userId]);
    if (membership.rowCount) req.session.organizerRole = membership.rows[0].role;
    else { delete req.session.organizerId; delete req.session.organizerRole; }
  }
  next();
});
const requirePlatformAdmin = (req, res, next) => { if (req.session.platformRole !== 'platform_admin') return res.status(403).json({ error: 'Se requiere acceso de propietario de plataforma.' }); next(); };
const requireOrgManager = (req, res, next) => { if (!req.session.organizerRole || !rolesCanManage.has(req.session.organizerRole)) return res.status(403).json({ error: 'Tu rol no permite gestionar esta acción.' }); next(); };
const setCsrf = (req, res) => { req.session.csrfToken ||= crypto.randomBytes(32).toString('hex'); res.json({ csrfToken: req.session.csrfToken }); };

app.get('/api/csrf', api((req, res) => setCsrf(req, res)));
app.post('/api/login', loginLimiter, requireCsrf, api(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  const result = await pool.query('SELECT id,email,display_name,password_hash,platform_role,is_active FROM users WHERE email=$1', [email]);
  const user = result.rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  const memberships = await pool.query(`SELECT om.organizer_id, om.role, o.display_name, o.status FROM organizer_members om JOIN organizers o ON o.id=om.organizer_id WHERE om.user_id=$1 ORDER BY o.display_name`, [user.id]);
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.userId = user.id; req.session.platformRole = user.platform_role;
  req.session.organizerMemberships = memberships.rows.map(m => ({ organizerId: m.organizer_id, role: m.role, name: m.display_name, status: m.status }));
  if (memberships.rows[0]) { req.session.organizerId = memberships.rows[0].organizer_id; req.session.organizerRole = memberships.rows[0].role; }
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.json({ user: { id: user.id, email: user.email, displayName: user.display_name, platformRole: user.platform_role }, memberships: req.session.organizerMemberships, csrfToken: req.session.csrfToken });
}));
app.get('/api/me', requireAuth, api(async (req, res) => {
  const u = await pool.query('SELECT id,email,display_name,platform_role FROM users WHERE id=$1', [req.session.userId]);
  if (!u.rowCount) return res.status(401).json({ error: 'Sesión no válida.' });
  res.json({ user: { id: u.rows[0].id, email: u.rows[0].email, displayName: u.rows[0].display_name, platformRole: u.rows[0].platform_role }, memberships: req.session.organizerMemberships || [], activeOrganizerId: req.session.organizerId || null, activeOrganizerRole: req.session.organizerRole || null, csrfToken: req.session.csrfToken });
}));
app.post('/api/logout', requireAuth, requireCsrf, (req, res, next) => req.session.destroy(err => err ? next(err) : res.clearCookie('logiticket.sid').json({ ok: true })));
app.post('/api/active-organizer', requireAuth, requireCsrf, api(async (req, res) => {
  const found = (req.session.organizerMemberships || []).find(m => m.organizerId === req.body.organizerId);
  if (!found) return res.status(403).json({ error: 'No tienes acceso a esta organización.' });
  req.session.organizerId = found.organizerId; req.session.organizerRole = found.role;
  res.json({ activeOrganizerId: found.organizerId, activeOrganizerRole: found.role });
}));

app.get('/api/dashboard', requireAuth, api(async (req, res) => {
  const isAdmin = req.session.platformRole === 'platform_admin';
  if (!isAdmin && !req.session.organizerId) return res.status(403).json({ error: 'Este usuario todavía no pertenece a un organizador.' });
  const where = isAdmin ? '' : 'WHERE e.organizer_id=$1'; const params = isAdmin ? [] : [req.session.organizerId];
  const [events, sales, ledger] = await Promise.all([
    pool.query(`SELECT e.id,e.title,e.city,e.starts_at,e.status,e.fee_type,e.fee_value,COALESCE(SUM(tt.sold_count),0)::int AS tickets_sold,COALESCE(SUM(tt.capacity),0)::int AS capacity FROM events e LEFT JOIN ticket_types tt ON tt.event_id=e.id ${where} GROUP BY e.id ORDER BY e.starts_at NULLS LAST LIMIT 8`, params),
    pool.query(`SELECT count(*)::int AS orders_count,COALESCE(sum(o.total_cents),0)::bigint AS gross_cents,COALESCE(sum(o.platform_fee_cents),0)::bigint AS fee_cents,COALESCE(sum(o.organizer_net_cents),0)::bigint AS net_cents FROM orders o JOIN events e ON e.id=o.event_id WHERE o.status='paid' ${isAdmin ? '' : 'AND e.organizer_id=$1'}`, params),
    pool.query(`SELECT COALESCE(sum(amount_cents) FILTER (WHERE entry_type IN ('sale','adjustment')),0)-COALESCE(sum(amount_cents) FILTER (WHERE entry_type IN ('platform_fee','refund','chargeback','payout','reserve')),0) AS balance_cents FROM ledger_entries l JOIN events e ON e.id=l.event_id ${where}`, params)
  ]);
  res.json({ scope: isAdmin ? 'platform' : 'organizer', events: events.rows, sales: sales.rows[0], pendingBalanceCents: ledger.rows[0].balance_cents || 0 });
}));

app.get('/api/events', requireAuth, api(async (req, res) => {
  const isAdmin = req.session.platformRole === 'platform_admin';
  if (!isAdmin && !req.session.organizerId) return res.status(403).json({ error: 'No perteneces a un organizador.' });
  const result = await pool.query(`SELECT e.*,o.display_name AS organizer_name,(SELECT COALESCE(json_agg(json_build_object('id',tt.id,'name',tt.name,'priceCents',tt.price_cents,'capacity',tt.capacity,'sold',tt.sold_count)), '[]'::json) FROM ticket_types tt WHERE tt.event_id=e.id) AS ticket_types FROM events e JOIN organizers o ON o.id=e.organizer_id ${isAdmin ? '' : 'WHERE e.organizer_id=$1'} ORDER BY e.created_at DESC`, isAdmin ? [] : [req.session.organizerId]);
  res.json({ events: result.rows });
}));
app.post('/api/events', requireAuth, requireCsrf, requireOrgManager, api(async (req, res) => {
  const { title, description = '', category = 'other', venueName = '', venueAddress = '', city = '', startsAt, doorsAt = null, accessConditions = '', coverImageUrl = null, coverThumbnailUrl = null, sourceUrl = null, timezone = 'Europe/Madrid', feeType = 'fixed', feeValue = 0, feePayer = 'organizer', ticketName = 'General', ticketPriceCents, serviceFeeCents = 0, capacity } = req.body;
  if (!req.session.organizerId) return res.status(403).json({ error: 'Selecciona un organizador.' });
  if (typeof title !== 'string' || title.trim().length < 3 || title.length > 180) return res.status(400).json({ error: 'El nombre debe tener entre 3 y 180 caracteres.' });
  if (!Number.isInteger(Number(capacity)) || Number(capacity) < 1 || !Number.isInteger(Number(ticketPriceCents)) || Number(ticketPriceCents) < 0 || !Number.isInteger(Number(serviceFeeCents)) || Number(serviceFeeCents) < 0) return res.status(400).json({ error: 'Revisa aforo, precio y gastos de gestión en céntimos.' });
  if (!['fixed','percent'].includes(feeType) || !Number.isFinite(Number(feeValue)) || Number(feeValue) < 0 || (feeType === 'percent' && Number(feeValue) > 100)) return res.status(400).json({ error: 'La comisión no es válida.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const slugBase = slugify(title.trim()); const suffix = crypto.randomBytes(3).toString('hex');
    const event = await client.query(`INSERT INTO events(organizer_id,title,slug,description,category,venue_name,venue_address,city,starts_at,doors_at,access_conditions,cover_image_url,cover_thumbnail_url,source_url,timezone,fee_type,fee_value,fee_payer,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [req.session.organizerId,title.trim(),`${slugBase}-${suffix}`,String(description).slice(0,5000),String(category).slice(0,60),String(venueName).slice(0,180),String(venueAddress).slice(0,300),String(city).slice(0,120),startsAt || null,doorsAt || null,String(accessConditions).slice(0,3000),coverImageUrl || null,coverThumbnailUrl || null,sourceUrl || null,String(timezone).slice(0,80),feeType,Number(feeValue),feePayer === 'buyer' ? 'buyer' : 'organizer',req.session.userId]);
    await client.query(`INSERT INTO ticket_types(event_id,name,price_cents,service_fee_cents,capacity) VALUES($1,$2,$3,$4,$5)`, [event.rows[0].id,String(ticketName).slice(0,100),Number(ticketPriceCents),Number(serviceFeeCents),Number(capacity)]);
    await audit(client, req, req.session.organizerId, 'event', event.rows[0].id, 'created', { status: 'draft' });
    await client.query('COMMIT'); res.status(201).json({ event: event.rows[0] });
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}));
app.post('/api/uploads/poster', requireAuth, requireCsrf, requireOrgManager, posterUpload.single('poster'), api(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen para el cartel.' });
  const imageId = crypto.randomUUID();
  const thumbnailName = `${imageId}-thumbnail.webp`;
  const posterName = `${imageId}-poster.webp`;
  try {
    const source = sharp(req.file.buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
    const metadata = await source.metadata();
    if (!['jpeg', 'png', 'webp', 'avif'].includes(metadata.format || '') || !metadata.width || !metadata.height) return res.status(400).json({ error: 'El archivo no contiene una imagen válida.' });
    const background = await getPosterEdgeColor(req.file.buffer);
    const thumbnail = await source.clone().resize(480, 360, { fit: 'contain', background }).webp({ quality: 82, effort: 5 }).toBuffer();
    const poster = await source.clone().resize(1200, 1600, { fit: 'contain', background }).webp({ quality: 86, effort: 5 }).toBuffer();
    await Promise.all([writeFile(path.join(uploadDir, thumbnailName), thumbnail, { flag: 'wx' }), writeFile(path.join(uploadDir, posterName), poster, { flag: 'wx' })]);
    res.status(201).json({ thumbnailUrl: `/uploads/${thumbnailName}`, posterUrl: `/uploads/${posterName}`, width: metadata.width, height: metadata.height, format: 'webp' });
  } catch (error) {
    if (/input buffer|unsupported image|pixel limit|corrupt|invalid image/i.test(error?.message || '')) {
      await Promise.all([unlink(path.join(uploadDir, thumbnailName)).catch(() => {}), unlink(path.join(uploadDir, posterName)).catch(() => {})]);
      return res.status(400).json({ error: 'No se pudo procesar la imagen. Prueba con otro archivo.' });
    }
    throw error;
  }
}));
app.post('/api/events/:id/submit', requireAuth, requireCsrf, requireOrgManager, api(async (req, res) => {
  if (!validUuid.test(req.params.id)) return res.status(400).json({ error: 'Evento no válido.' });
  const result = await pool.query(`UPDATE events SET status='pending_review',review_note=NULL,updated_at=now() WHERE id=$1 AND organizer_id=$2 AND status IN ('draft','rejected') RETURNING id,status`, [req.params.id,req.session.organizerId]);
  if (!result.rowCount) return res.status(409).json({ error: 'No se puede enviar este evento a revisión.' });
  await pool.query(`INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action) VALUES($1,$2,'event',$3,'submitted_for_review')`, [req.session.userId,req.session.organizerId,req.params.id]);
  res.json({ event: result.rows[0] });
}));
app.post('/api/platform/events/:id/review', requireAuth, requireCsrf, requirePlatformAdmin, api(async (req, res) => {
  if (!validUuid.test(req.params.id) || !['publish','reject'].includes(req.body.decision)) return res.status(400).json({ error: 'Revisión no válida.' });
  const status = req.body.decision === 'publish' ? 'published' : 'rejected';
  const result = await pool.query(`UPDATE events SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now() WHERE id=$1 AND status='pending_review' RETURNING id,organizer_id,status`, [req.params.id,status,String(req.body.note || '').slice(0,1000),req.session.userId]);
  if (!result.rowCount) return res.status(409).json({ error: 'El evento no está pendiente de revisión.' });
  await pool.query(`INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action,details) VALUES($1,$2,'event',$3,$4,$5::jsonb)`, [req.session.userId,result.rows[0].organizer_id,req.params.id,`review_${status}`,JSON.stringify({ note: req.body.note || '' })]);
  res.json({ event: result.rows[0] });
}));

app.get('/api/events/:id/promotions', requireAuth, api(async (req, res) => {
  if (!validUuid.test(req.params.id)) return res.status(400).json({ error: 'Evento no válido.' });
  const event = await pool.query(`SELECT organizer_id FROM events WHERE id=$1`, [req.params.id]);
  if (!event.rowCount || (req.session.platformRole !== 'platform_admin' && event.rows[0].organizer_id !== req.session.organizerId)) return res.status(404).json({ error: 'Evento no encontrado.' });
  const rows = await pool.query(`SELECT * FROM promotions WHERE event_id=$1 ORDER BY created_at DESC`, [req.params.id]);
  res.json({ promotions: rows.rows });
}));
app.post('/api/events/:id/promotions', requireAuth, requireCsrf, requireOrgManager, api(async (req, res) => {
  const { code, title, discountType = 'percent', discountValue, maxUses = null, startsAt = null, endsAt = null } = req.body;
  const event = await pool.query(`SELECT id FROM events WHERE id=$1 AND organizer_id=$2 AND status IN ('draft','pending_review','published')`, [req.params.id,req.session.organizerId]);
  if (!event.rowCount) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(String(code || '')) || !String(title || '').trim()) return res.status(400).json({ error: 'Código (3–32 caracteres) y título obligatorios.' });
  if (!['percent','fixed'].includes(discountType) || !Number.isFinite(Number(discountValue)) || Number(discountValue) <= 0 || (discountType === 'percent' && Number(discountValue) > 100)) return res.status(400).json({ error: 'Descuento no válido.' });
  const result = await pool.query(`INSERT INTO promotions(event_id,code,title,discount_type,discount_value,max_uses,starts_at,ends_at) VALUES($1,upper($2),$3,$4,$5,$6,$7,$8) RETURNING *`, [req.params.id,code,title.trim().slice(0,150),discountType,Number(discountValue),maxUses ? Number(maxUses) : null,startsAt,endsAt]);
  await pool.query(`INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action,details) VALUES($1,$2,'promotion',$3,'created',$4::jsonb)`, [req.session.userId,req.session.organizerId,result.rows[0].id,JSON.stringify({ eventId:req.params.id,code:result.rows[0].code })]);
  res.status(201).json({ promotion: result.rows[0] });
}));
app.get('/api/events/:id/giveaways', requireAuth, api(async (req, res) => {
  const event = await pool.query('SELECT organizer_id FROM events WHERE id=$1', [req.params.id]);
  if (!event.rowCount || (req.session.platformRole !== 'platform_admin' && event.rows[0].organizer_id !== req.session.organizerId)) return res.status(404).json({ error: 'Evento no encontrado.' });
  const rows = await pool.query('SELECT * FROM giveaways WHERE event_id=$1 ORDER BY created_at DESC', [req.params.id]); res.json({ giveaways: rows.rows });
}));
app.post('/api/events/:id/giveaways', requireAuth, requireCsrf, requireOrgManager, api(async (req, res) => {
  const { title, description = '', prize, startsAt = null, endsAt = null, termsUrl = null } = req.body;
  const event = await pool.query('SELECT id FROM events WHERE id=$1 AND organizer_id=$2', [req.params.id,req.session.organizerId]);
  if (!event.rowCount) return res.status(404).json({ error: 'Evento no encontrado.' });
  if (!String(title || '').trim() || !String(prize || '').trim()) return res.status(400).json({ error: 'Título y premio son obligatorios.' });
  const result = await pool.query(`INSERT INTO giveaways(event_id,title,description,prize,starts_at,ends_at,terms_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [req.params.id,String(title).trim().slice(0,180),String(description).slice(0,2000),String(prize).trim().slice(0,300),startsAt,endsAt,termsUrl]);
  await pool.query(`INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action) VALUES($1,$2,'giveaway',$3,'created')`, [req.session.userId,req.session.organizerId,result.rows[0].id]);
  res.status(201).json({ giveaway: result.rows[0] });
}));
app.get('/api/orders', requireAuth, api(async (req, res) => {
  const isAdmin = req.session.platformRole === 'platform_admin';
  const rows = await pool.query(`SELECT o.public_reference,o.buyer_email,o.currency,o.total_cents,o.platform_fee_cents,o.organizer_net_cents,o.status,o.created_at,e.title AS event_title FROM orders o JOIN events e ON e.id=o.event_id ${isAdmin ? '' : 'WHERE e.organizer_id=$1'} ORDER BY o.created_at DESC LIMIT 100`, isAdmin ? [] : [req.session.organizerId]);
  res.json({ orders: rows.rows });
}));
app.get('/api/payouts', requireAuth, api(async (req, res) => {
  const isAdmin = req.session.platformRole === 'platform_admin';
  const rows = await pool.query(`SELECT p.*,o.display_name AS organizer_name FROM payouts p JOIN organizers o ON o.id=p.organizer_id ${isAdmin ? '' : 'WHERE p.organizer_id=$1'} ORDER BY p.created_at DESC LIMIT 100`, isAdmin ? [] : [req.session.organizerId]);
  res.json({ payouts: rows.rows });
}));

app.get('/api/platform/organizers', requireAuth, requirePlatformAdmin, api(async (_req, res) => {
  const rows = await pool.query(`SELECT o.*,count(DISTINCT e.id)::int AS events_count FROM organizers o LEFT JOIN events e ON e.organizer_id=o.id GROUP BY o.id ORDER BY o.created_at DESC`); res.json({ organizers: rows.rows });
}));
app.post('/api/platform/organizers', requireAuth, requireCsrf, requirePlatformAdmin, api(async (req, res) => {
  const { legalName, displayName, taxId = '', email = '', phone = '' } = req.body;
  if (!String(legalName || '').trim() || !String(displayName || '').trim()) return res.status(400).json({ error: 'Nombre legal y nombre comercial son obligatorios.' });
  const created = await pool.query(`INSERT INTO organizers(legal_name,display_name,tax_id,email,phone) VALUES($1,$2,$3,$4,$5) RETURNING *`, [String(legalName).trim().slice(0,180),String(displayName).trim().slice(0,180),String(taxId).trim().slice(0,32),String(email).trim().toLowerCase().slice(0,254),String(phone).trim().slice(0,40)]);
  await pool.query(`INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action) VALUES($1,$2,'organizer',$2,'created')`, [req.session.userId,created.rows[0].id]);
  res.status(201).json({ organizer: created.rows[0] });
}));
app.post('/api/platform/organizers/:id/members', requireAuth, requireCsrf, requirePlatformAdmin, api(async (req, res) => {
  if (!validUuid.test(req.params.id)) return res.status(400).json({ error: 'Organizador no válido.' });
  const email = String(req.body.email || '').trim().toLowerCase(); const role = req.body.role || 'owner';
  if (!email || !['owner','admin','event_manager','box_office','finance'].includes(role)) return res.status(400).json({ error: 'Correo y rol válido son obligatorios.' });
  const user = await pool.query('SELECT id FROM users WHERE email=$1 AND is_active=true', [email]);
  if (!user.rowCount) return res.status(404).json({ error: 'Primero crea la cuenta de usuario con el procedimiento administrativo.' });
  const org = await pool.query('SELECT id FROM organizers WHERE id=$1', [req.params.id]);
  if (!org.rowCount) return res.status(404).json({ error: 'Organizador no encontrado.' });
  await pool.query(`INSERT INTO organizer_members(organizer_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(organizer_id,user_id) DO UPDATE SET role=EXCLUDED.role`, [req.params.id,user.rows[0].id,role]);
  await pool.query(`INSERT INTO audit_log(actor_user_id,organizer_id,entity_type,entity_id,action,details) VALUES($1,$2,'organizer_member',$3,'assigned',$4::jsonb)`, [req.session.userId,req.params.id,user.rows[0].id,JSON.stringify({email,role})]);
  res.status(201).json({ ok: true, email, role });
}));
app.get('/api/platform/review-queue', requireAuth, requirePlatformAdmin, api(async (_req, res) => {
  const rows = await pool.query(`SELECT e.*,o.display_name AS organizer_name FROM events e JOIN organizers o ON o.id=e.organizer_id WHERE e.status='pending_review' ORDER BY e.updated_at`); res.json({ events: rows.rows });
}));

app.get('/', (_req, res) => res.sendFile(new URL('./public/index.html', import.meta.url).pathname));
app.get('/login', (_req, res) => res.sendFile(new URL('./public/login.html', import.meta.url).pathname));
app.get('/app', (_req, res) => res.sendFile(new URL('./public/app.html', import.meta.url).pathname));
app.get('/health', api(async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected' }); }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta API no encontrada.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El cartel supera el máximo de 10 MB.' });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'No se pudo recibir el archivo del cartel.' });
  if (err.message === 'Formato no válido. Usa JPG, PNG, WebP o AVIF.') return res.status(400).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Formato de datos no válido.' });
  res.status(500).json({ error: NODE_ENV === 'production' ? 'Error interno.' : err.message });
});
const server = app.listen(Number(PORT), () => console.log(`Logiticket MVP escuchando en http://localhost:${PORT}`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(async () => { await pool.end(); process.exit(0); }));
