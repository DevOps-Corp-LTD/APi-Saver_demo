import { query } from './pool.js';
import { runMigrations } from './migrate.js';
import { createApp } from '../services/appService.js';
import { createSource } from '../services/sourceService.js';
import logger from '../utils/logger.js';

async function seed() {
  try {
    logger.info('Running migrations...');
    await runMigrations();
    
    logger.info('Seeding database...');
    
    // Check if any apps exist
    const existingApps = await query('SELECT COUNT(*) FROM apps');
    if (parseInt(existingApps.rows[0].count, 10) > 0) {
      logger.info('Database already seeded, skipping...');
      return;
    }
    
    // Create default app
    const app = await createApp('Default App');
    
    // Create 2 default API sources for testing
    logger.info('Creating default API sources...');
    
    const defaultSources = [
      {
        name: 'JSONPlaceholder (Test API)',
        base_url: 'https://jsonplaceholder.typicode.com',
        auth_type: 'none',
        priority: 1,
        timeout_ms: 30000,
        retry_count: 3,
        circuit_breaker_threshold: 5,
      },
      {
        name: 'RESTful API (Test API)',
        base_url: 'https://api.restful-api.dev',
        auth_type: 'none',
        priority: 2,
        timeout_ms: 30000,
        retry_count: 3,
        circuit_breaker_threshold: 5,
      },
    ];
    
    const createdSources = [];
    for (const sourceData of defaultSources) {
      try {
        const source = await createSource(app.id, sourceData);
        createdSources.push(source);
        console.log(`  ✓ Created source: ${source.name}`);
      } catch (error) {
        console.warn(`  ⚠ Failed to create source ${sourceData.name}:`, error.message);
      }
    }
    
    // Use console.log for seed output as it's a CLI script and needs to be visible
    // This is acceptable for CLI scripts that output to stdout
    console.log('\n========================================');
    console.log(' Database seeded successfully!');
    console.log('========================================');
    console.log('\n⚠ IMPORTANT: Save this API key - it will not be shown again!');
    console.log(`\nAPI Key: ${app.api_key}`);
    console.log(`App ID: ${app.id}`);
    console.log(`App Name: ${app.name}`);
    console.log(`\nDefault Sources Created: ${createdSources.length}`);
    createdSources.forEach((source, index) => {
      console.log(`  ${index + 1}. ${source.name} - ${source.base_url}`);
    });
    console.log('\nNote: You can delete or modify these default sources from the Sources page.');
    console.log('\nUse this API key to authenticate with the API.');
    console.log('========================================\n');
    
    // Also log to logger for consistency
    logger.info({ appId: app.id, appName: app.name, sourcesCount: createdSources.length }, 'Database seeded successfully');
    
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Seed error');
    console.error('Seed error:', error); // Also output to console for CLI visibility
    process.exit(1);
  }
}

seed();
