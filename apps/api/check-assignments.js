const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: __dirname + '/../../.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.log("Missing Supabase credentials in .env", process.env.SUPABASE_URL);
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function check() {
  console.log("--- 1. Checking Tenant ---");
  const { data: tenant } = await supabaseAdmin.from('tenants').select('*').eq('institute_code', 'TEST_ADMIN').single();
  console.log(tenant);

  if (!tenant) return;

  console.log("\n--- 2. Checking Driver ---");
  const { data: driver } = await supabaseAdmin.from('users').select('*').eq('email', 'driver@shieldtrack.com').eq('tenant_id', tenant.id).single();
  console.log(driver);

  if (!driver) return;

  console.log("\n--- 3. Checking Trip Assignments for this driver ---");
  const { data: assignments } = await supabaseAdmin.from('trip_assignments').select('*').eq('driver_id', driver.id);
  console.log(assignments);

  console.log("\n--- 4. Checking ALL Trip Assignments (just in case driver_id is wrong) ---");
  const { data: allAssignments } = await supabaseAdmin.from('trip_assignments').select('*');
  console.log(allAssignments);
  
  console.log("\n--- 5. Checking today calculation locally vs DB assignments ---");
  const today = new Date().toISOString().split('T')[0];
  console.log("Local API today:", today);
}

check().catch(console.error);
