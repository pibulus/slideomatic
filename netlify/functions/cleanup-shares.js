import { connectLambda, getStore } from '@netlify/blobs';
import { STORE_NAMES, BASE_HEADERS } from './utils/common.js';

/**
 * Cleanup Function: Delete expired shares and orphaned assets
 *
 * Can be called manually or via Netlify Scheduled Functions
 * Schedule: https://docs.netlify.com/functions/scheduled-functions/
 */

export async function handler(event) {
  connectLambda(event);

  try {
    // Only allow GET requests or scheduled invocations
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: BASE_HEADERS,
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    const isDryRun = event.queryStringParameters?.dryRun === 'true';
    const now = Date.now();
    const results = {
      sharesScanned: 0,
      sharesDeleted: 0,
      assetsScanned: 0,
      assetsDeleted: 0,
      bytesFreed: 0,
      errors: [],
      dryRun: isDryRun,
    };

    // Cleanup shares
    const sharesStore = getStore(STORE_NAMES.SHARES);
    const shares = await sharesStore.list();

    results.sharesScanned = shares.blobs?.length || 0;

    for (const share of (shares.blobs || [])) {
      try {
        const expiresAt = share.metadata?.expiresAt;

        // Delete if expired or missing expiry (old shares)
        if (!expiresAt || expiresAt < now) {
          const ageInDays = expiresAt ? Math.round((now - expiresAt) / (24 * 60 * 60 * 1000)) : null;

          console.log(
            `Deleting expired share: ${share.key} ` +
            `(expired ${ageInDays ? ageInDays + ' days ago' : 'no expiry set'})`
          );

          if (!isDryRun) {
            await sharesStore.delete(share.key);
          }

          results.sharesDeleted++;
          results.bytesFreed += share.metadata?.bytes || 0;
        }
      } catch (error) {
        console.error(`Error processing share ${share.key}:`, error);
        results.errors.push(`Share ${share.key}: ${error.message}`);
      }
    }

    // Cleanup orphaned assets
    const assetsStore = getStore(STORE_NAMES.ASSETS);
    const assets = await assetsStore.list();

    results.assetsScanned = assets.blobs?.length || 0;

    for (const asset of (assets.blobs || [])) {
      try {
        const expiresAt = asset.metadata?.expiresAt;

        // Delete if expired
        if (expiresAt && expiresAt < now) {
          const ageInDays = Math.round((now - expiresAt) / (24 * 60 * 60 * 1000));

          console.log(
            `Deleting expired asset: ${asset.key} ` +
            `(expired ${ageInDays} days ago, ${Math.round((asset.metadata?.bytes || 0) / 1024)}KB)`
          );

          if (!isDryRun) {
            await assetsStore.delete(asset.key);
          }

          results.assetsDeleted++;
          results.bytesFreed += asset.metadata?.bytes || 0;
        }
      } catch (error) {
        console.error(`Error processing asset ${asset.key}:`, error);
        results.errors.push(`Asset ${asset.key}: ${error.message}`);
      }
    }

    // Format summary
    const summary = {
      ...results,
      bytesFreedMB: (results.bytesFreed / (1024 * 1024)).toFixed(2),
      timestamp: new Date().toISOString(),
    };

    console.log(
      `Cleanup complete: ` +
      `${summary.sharesDeleted}/${summary.sharesScanned} shares deleted, ` +
      `${summary.assetsDeleted}/${summary.assetsScanned} assets deleted, ` +
      `${summary.bytesFreedMB}MB freed` +
      (isDryRun ? ' (DRY RUN)' : '')
    );

    return {
      statusCode: 200,
      headers: BASE_HEADERS,
      body: JSON.stringify(summary),
    };
  } catch (error) {
    console.error('Cleanup function failed:', error);
    return {
      statusCode: 500,
      headers: BASE_HEADERS,
      body: JSON.stringify({
        error: 'Cleanup failed',
        message: error.message,
      }),
    };
  }
}
