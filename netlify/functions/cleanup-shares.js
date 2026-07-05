import { connectLambda, getStore } from '@netlify/blobs';
import { STORE_NAMES, TTL, BASE_HEADERS } from './utils/common.js';

/**
 * Cleanup Function: Delete expired shares and orphaned assets
 *
 * Can be called manually or via Netlify Scheduled Functions
 * Schedule: https://docs.netlify.com/functions/scheduled-functions/
 */

export async function handler(event) {
  connectLambda(event);

  try {
    // Allow manual GET/POST invocations and scheduled runs. A scheduled
    // invocation arrives with no httpMethod, so only reject real HTTP calls
    // that use some other method.
    const isScheduled = !event.httpMethod;
    if (!isScheduled && event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
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
      sharesKeptUndatable: 0,
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
        let expiresAt = Number(share.metadata?.expiresAt) || 0;

        // Records written before expiry metadata existed: derive a lifetime
        // from creation. Treating "no expiry" as "expired" deleted every
        // share the day after it was created.
        if (!expiresAt) {
          const createdAt = Number(share.metadata?.createdAt) || 0;
          expiresAt = createdAt ? createdAt + TTL.SHARE_MS : 0;
        }

        // No way to date it at all — keep it rather than guess-delete.
        if (!expiresAt) {
          results.sharesKeptUndatable++;
          continue;
        }

        if (expiresAt < now) {
          const ageInDays = Math.round((now - expiresAt) / (24 * 60 * 60 * 1000));

          console.log(
            `Deleting expired share: ${share.key} (expired ${ageInDays} days ago)`
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
