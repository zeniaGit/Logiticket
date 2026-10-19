import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
function readSecret(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY) return reject(new Error('Ejecuta este comando desde un terminal interactivo para introducir la contraseña de forma segura.'));
    process.stdout.write(prompt); input.setRawMode(true); input.resume(); let value = '';
    const finish = (err) => { input.setRawMode(false); input.pause(); input.removeListener('data', onData); process.stdout.write('\n'); err ? reject(err) : resolve(value); };
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') return finish(new Error('Cancelado.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    input.on('data', onData);
  });
}
const [email, displayName, role = 'platform_admin', organizerName] = process.argv.slice(2);
if (!email || !displayName || !['platform_admin','user','organizer'].includes(role)) {
  console.error('Uso: npm run create-user -- correo nombre [platform_admin|user|organizer] [nombre-organizador]');
  process.exit(1);
}
const password = await readSecret('Contraseña inicial (mínimo 12 caracteres): ');
if (password.length < 12) { console.error('Usa una contraseña de al menos 12 caracteres.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const hash = await bcrypt.hash(password, 12);
  const user = await client.query(`INSERT INTO users(email, display_name, password_hash, platform_role) VALUES($1,$2,$3,$4) RETURNING id`, [email.toLowerCase(), displayName, hash, role === 'platform_admin' ? 'platform_admin' : 'user']);
  if (role === 'organizer') {
    if (!organizerName) throw new Error('Para crear usuario organizador indica también el nombre del organizador.');
    const org = await client.query(`INSERT INTO organizers(legal_name, display_name, email) VALUES($1,$1,$2) RETURNING id`, [organizerName, email.toLowerCase()]);
    await client.query(`INSERT INTO organizer_members(organizer_id,user_id,role) VALUES($1,$2,'owner')`, [org.rows[0].id,user.rows[0].id]);
  }
  await client.query('COMMIT');
  console.log(`Usuario creado: ${email.toLowerCase()} (${role}).`);
} catch (error) {
  await client.query('ROLLBACK'); console.error('No se pudo crear el usuario:', error.message); process.exitCode = 1;
} finally { client.release(); await pool.end(); }
