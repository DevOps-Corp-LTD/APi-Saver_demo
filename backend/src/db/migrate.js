import { query } from './pool.js';
import logger from '../utils/logger.js';

const migrations = [
  // Initial schema
  `CREATE TABLE IF NOT EXISTS apps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    api_key VARCHAR(64) UNIQUE,
    api_key_hash VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS app_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    base_url TEXT NOT NULL,
    priority INT DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    auth_type VARCHAR(50),
    auth_config JSONB,
    auth_config_encrypted TEXT,
    headers_encrypted TEXT,
    timeout_ms INT DEFAULT 30000,
    retry_count INT DEFAULT 3,
    circuit_breaker_threshold INT DEFAULT 5,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS cache_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    source_id UUID REFERENCES app_sources(id) ON DELETE CASCADE,
    cache_key VARCHAR(255) NOT NULL,
    request_method VARCHAR(10),
    request_url TEXT,
    request_body_hash VARCHAR(64),
    response_status INT,
    response_headers JSONB,
    response_body JSONB,
    response_body_raw TEXT,
    content_type VARCHAR(255),
    ttl_seconds INT,
    expires_at TIMESTAMP,
    hit_count INT DEFAULT 0,
    last_hit_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, cache_key)
  )`,

  `CREATE TABLE IF NOT EXISTS app_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    config_key VARCHAR(255) NOT NULL,
    config_value TEXT,
    is_secret BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, config_key)
  )`,
  
  // Add kill_switch_enabled to app_configs (via migration)
  // This will be set via app_configs table with config_key = 'kill_switch_enabled'

  // RBAC: Users table (must be created before audit_logs)
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'viewer',
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, email)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_users_app_id ON users(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100),
    resource_id UUID,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_app_id ON cache_entries(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_cache_key ON cache_entries(cache_key)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_expires_at ON cache_entries(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_apps_api_key_hash ON apps(api_key_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_app_sources_app_id ON app_sources(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_app_id ON audit_logs(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)`,

  // OIDC Configuration table
  `CREATE TABLE IF NOT EXISTS oidc_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE UNIQUE,
    issuer TEXT NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    client_secret_encrypted TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    scopes TEXT DEFAULT 'openid profile email',
    role_claim VARCHAR(255) DEFAULT 'role',
    admin_role_value VARCHAR(255) DEFAULT 'admin',
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,

  // Cache policies table
  `CREATE TABLE IF NOT EXISTS cache_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    source_id UUID REFERENCES app_sources(id) ON DELETE CASCADE,
    max_ttl_seconds INT DEFAULT 86400,
    no_cache BOOLEAN DEFAULT false,
    purge_schedule VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, source_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_cache_policies_app_id ON cache_policies(app_id)`,

  // Rate limit rules table
  `CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    source_id UUID REFERENCES app_sources(id) ON DELETE CASCADE,
    max_requests INT DEFAULT 100,
    window_seconds INT DEFAULT 60,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, source_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_app_id ON rate_limit_rules(app_id)`,
  
  // Index for user_id in audit_logs
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`,

  // Storage pools table
  `CREATE TABLE IF NOT EXISTS storage_pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, name)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_storage_pools_app_id ON storage_pools(app_id)`,

  // Add storage_mode and storage_pool_id to app_sources
  // First add column without constraint
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS storage_mode VARCHAR(20)`,
  // Set default value for existing rows
  `UPDATE app_sources SET storage_mode = 'dedicated' WHERE storage_mode IS NULL`,
  // Add default and constraint
  `ALTER TABLE app_sources ALTER COLUMN storage_mode SET DEFAULT 'dedicated'`,
  // Add constraint - error will be caught by migration handler if it already exists
  `ALTER TABLE app_sources ADD CONSTRAINT check_storage_mode CHECK (storage_mode IN ('shared', 'dedicated'))`,
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS storage_pool_id UUID REFERENCES storage_pools(id) ON DELETE SET NULL`,

  // Add storage_pool_id to cache_entries
  `ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS storage_pool_id UUID REFERENCES storage_pools(id) ON DELETE CASCADE`,
  
  // Add vary_headers column to app_sources for configurable Vary rules
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS vary_headers JSONB DEFAULT '["accept", "content-type", "x-api-version"]'::jsonb`,
  
  // Add kill_switch_enabled to app_sources
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS kill_switch_enabled BOOLEAN DEFAULT false`,
  
  // Add bypass_bot_detection to app_sources (opt-in browser headers for bot detection bypass)
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS bypass_bot_detection BOOLEAN DEFAULT false`,

  // Drop old unique constraint and create new ones based on storage mode
  // Note: PostgreSQL doesn't support conditional unique constraints directly,
  // so we'll use a partial unique index approach
  // Try to drop the old constraint (it might be named differently)
  // PostgreSQL auto-generates constraint names, so we need to find and drop it
  `DO $$ 
    DECLARE
      constraint_name TEXT;
    BEGIN
      -- Find the unique constraint on (app_id, cache_key)
      SELECT conname INTO constraint_name
      FROM pg_constraint
      WHERE conrelid = 'cache_entries'::regclass
        AND contype = 'u'
        AND array_length(conkey, 1) = 2
        AND conkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'cache_entries'::regclass AND attname = 'app_id')
        AND conkey[2] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'cache_entries'::regclass AND attname = 'cache_key');
      
      -- Drop the constraint if found
      IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE cache_entries DROP CONSTRAINT ' || quote_ident(constraint_name);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$`,
  `DROP INDEX IF EXISTS cache_entries_app_id_cache_key_key`,
  // Dedicated mode: cache is isolated per source (use source_id for uniqueness, pool_id is optional for management)
  // Legacy: dedicated sources without pool_id
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_entries_dedicated ON cache_entries(app_id, source_id, cache_key) WHERE storage_pool_id IS NULL`,
  // New: dedicated sources with pool_id - use source_id for isolation (pool_id is just for management)
  // Note: This creates a unique constraint on (app_id, source_id, cache_key) for entries with pool_id
  // The application logic ensures this is only used for dedicated sources
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_entries_dedicated_with_pool ON cache_entries(app_id, source_id, cache_key) WHERE storage_pool_id IS NOT NULL`,
  // Shared mode: cache is shared across sources in pool (use pool_id for uniqueness)
  // Note: This will conflict with dedicated sources that have pool_id, so we rely on application logic
  // to ensure shared sources use pool_id and dedicated sources use source_id for cache isolation
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cache_entries_shared ON cache_entries(app_id, storage_pool_id, cache_key) WHERE storage_pool_id IS NOT NULL`,

  `CREATE INDEX IF NOT EXISTS idx_cache_entries_storage_pool_id ON cache_entries(storage_pool_id)`,
  `CREATE INDEX IF NOT EXISTS idx_app_sources_storage_pool_id ON app_sources(storage_pool_id)`,
  
  // Performance optimization indexes
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_source_id ON cache_entries(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_created_at ON cache_entries(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_hit_count ON cache_entries(hit_count DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_app_created ON cache_entries(app_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_app_pool_created ON cache_entries(app_id, storage_pool_id, created_at DESC) WHERE storage_pool_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_app_source_created ON cache_entries(app_id, source_id, created_at DESC) WHERE storage_pool_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_response_status ON cache_entries(response_status)`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_request_method ON cache_entries(request_method)`,
  
  // Add tags column to cache_entries for tag-based invalidation
  `ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_tags ON cache_entries USING GIN(tags)`,
  
  // Add revalidate_at column for revalidation support
  `ALTER TABLE cache_entries ADD COLUMN IF NOT EXISTS revalidate_at TIMESTAMP`,
  `CREATE INDEX IF NOT EXISTS idx_cache_entries_revalidate_at ON cache_entries(revalidate_at)`,
  
  // Compliance rules table
  `CREATE TABLE IF NOT EXISTS compliance_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    source_id UUID REFERENCES app_sources(id) ON DELETE CASCADE,
    region_constraints JSONB,
    pii_detection JSONB,
    tos_aware JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(app_id, source_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_rules_app_id ON compliance_rules(app_id)`,
  
  // TOS rules table
  `CREATE TABLE IF NOT EXISTS tos_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    source_id UUID REFERENCES app_sources(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    url_pattern TEXT,
    methods TEXT[],
    status_codes INT[],
    block_caching BOOLEAN DEFAULT false,
    priority INT DEFAULT 0,
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tos_rules_app_id ON tos_rules(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tos_rules_source_id ON tos_rules(source_id)`,
  
  // Lineage events table
  `CREATE TABLE IF NOT EXISTS lineage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    cache_entry_id UUID REFERENCES cache_entries(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    source_id UUID REFERENCES app_sources(id) ON DELETE SET NULL,
    action VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_events_app_id ON lineage_events(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_events_cache_entry_id ON lineage_events(cache_entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_events_event_type ON lineage_events(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_lineage_events_created_at ON lineage_events(created_at DESC)`,
  
  // Mock responses table
  `CREATE TABLE IF NOT EXISTS mock_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    source_id UUID REFERENCES app_sources(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    request_method VARCHAR(10) NOT NULL,
    request_url_pattern TEXT NOT NULL,
    request_body_pattern TEXT,
    response_status INT DEFAULT 200,
    response_headers JSONB,
    response_body JSONB,
    response_body_raw TEXT,
    is_active BOOLEAN DEFAULT true,
    priority INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mock_responses_app_id ON mock_responses(app_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mock_responses_source_id ON mock_responses(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mock_responses_active ON mock_responses(app_id, source_id, is_active) WHERE is_active = true`,
  
  // Add fallback_mode to app_sources
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS fallback_mode VARCHAR(20) DEFAULT 'none'`,
  `ALTER TABLE app_sources ADD CONSTRAINT check_fallback_mode CHECK (fallback_mode IN ('none', 'mock', 'alternative_source'))`,
  
  // Add cost_per_request to app_sources
  `ALTER TABLE app_sources ADD COLUMN IF NOT EXISTS cost_per_request DECIMAL(10, 4)`,
];

export async function runMigrations() {
  logger.info('Running database migrations...');
  
  for (let i = 0; i < migrations.length; i++) {
    try {
      await query(migrations[i]);
      logger.info({ migration: i + 1, total: migrations.length }, 'Migration completed');
    } catch (error) {
      // Ignore "already exists" errors
      if (error.message.includes('already exists') || error.code === '42P07') {
        logger.debug({ migration: i + 1, total: migrations.length }, 'Migration skipped (already exists)');
        continue;
      }
      // Ignore constraint already exists errors
      if (error.message.includes('already exists') || error.code === '42P16' || error.code === '42710') {
        logger.debug({ migration: i + 1, total: migrations.length }, 'Migration skipped (constraint already exists)');
        continue;
      }
      // Ignore duplicate constraint errors
      if (error.message.includes('duplicate') && error.message.includes('constraint')) {
        logger.debug({ migration: i + 1, total: migrations.length }, 'Migration skipped (constraint already exists)');
        continue;
      }
      logger.error({ migration: i + 1, total: migrations.length, err: error.message, code: error.code }, 'Migration error');
      throw error;
    }
  }
  
  logger.info('Migrations completed successfully');
  
  // Migrate existing data: Create default pools for apps with existing sources
  // and assign existing sources to shared mode with default pool
  try {
    logger.info('Migrating existing sources to default storage pools...');
    
    // Get all apps
    const appsResult = await query('SELECT id FROM apps');
    
    for (const app of appsResult.rows) {
      // Check if app has sources without storage_mode set (legacy sources)
      const sourcesResult = await query(
        `SELECT id FROM app_sources 
         WHERE app_id = $1 AND storage_mode IS NULL`,
        [app.id]
      );
      
      if (sourcesResult.rows.length > 0) {
        // Create default pool for this app if it doesn't exist
        const poolResult = await query(
          `INSERT INTO storage_pools (app_id, name, description)
           VALUES ($1, 'Default Pool', 'Legacy shared storage pool for existing sources')
           ON CONFLICT (app_id, name) DO NOTHING
           RETURNING id`,
          [app.id]
        );
        
        let poolId;
        if (poolResult.rows.length > 0) {
          poolId = poolResult.rows[0].id;
        } else {
          // Pool already exists, get its ID
          const existingPool = await query(
            'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
            [app.id, 'Default Pool']
          );
          poolId = existingPool.rows[0]?.id;
        }
        
        if (poolId) {
          // Update existing sources to shared mode with default pool
          await query(
            `UPDATE app_sources 
             SET storage_mode = 'shared', storage_pool_id = $1
             WHERE app_id = $2 AND storage_mode IS NULL`,
            [poolId, app.id]
          );
          
          // Update existing cache entries to use the pool
          await query(
            `UPDATE cache_entries 
             SET storage_pool_id = $1
             WHERE app_id = $2 AND storage_pool_id IS NULL
             AND source_id IN (SELECT id FROM app_sources WHERE app_id = $2 AND storage_pool_id = $1)`,
            [poolId, app.id]
          );
          
          logger.info({ appId: app.id, count: sourcesResult.rows.length }, 'Migrated sources for app to Default Pool');
        }
      }
    }
    
    logger.info('Migration of existing sources completed');
  } catch (error) {
    logger.warn({ err: error.message }, 'Warning: Error during data migration');
    // Don't fail the migration if data migration fails
  }
}

export default { runMigrations };
