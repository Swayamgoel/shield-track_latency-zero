import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function seedAdmin() {
  console.log("Seeding Admin user...");
  // 1. Get or Create a Tenant
  let { data: tenant } = await supabase.from('tenants').select('id, institute_code').eq('institute_code', 'TEST_ADMIN').single();

  if (!tenant) {
    const res = await supabase.from('tenants').insert({
      name: 'Test Setup Admin',
      institute_code: 'TEST_ADMIN'
    }).select().single();
    if (res.error) throw res.error;
    tenant = res.data;
    console.log("Created test tenant:", tenant.id);
  } else {
    console.log("Found tenant:", tenant.id);
  }

  // 2. Create Auth User
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("❌ Error: Missing ADMIN_EMAIL or ADMIN_PASSWORD environment variables.");
    process.exit(1);
  }

  const { data: authUser, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (authErr && !authErr.message.includes("already registered")) {
    console.error("❌ Auth User Creation Error:", authErr);
    process.exit(1);
  }

  const userId = authUser?.user?.id;
  if (userId) {
    console.log("Auth user created:", userId);
    // 3. Upsert into public.users
    const { error: userErr } = await supabase.from('users').upsert({
      id: userId,
      tenant_id: tenant.id,
      email,
      role: 'admin'
    });
    if (userErr) throw userErr;
    console.log("User added to public.users as admin.");
  } else {
    console.log("Auth user might already exist. Just make sure the public.users is an admin.");
    // We can fetch by email via admin api
    const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
    if (listErr) {
      console.error("❌ Error listing users:", listErr);
      process.exit(1);
    }

    if (users?.users) {
      const u = users.users.find(u => u.email === email);
      if (u) {
        const { error: upsertErr } = await supabase.from('users').upsert({
          id: u.id,
          tenant_id: tenant.id,
          email,
          role: 'admin'
        });
        if (upsertErr) throw upsertErr;
        console.log("✅ Updated existing Auth user to public admin role.");
      }
    }
  }

  console.log("Done.");
}

seedAdmin().catch(console.error);
