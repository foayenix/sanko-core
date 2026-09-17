import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const plantDataPath = path.resolve(projectDirectory, '..', 'data', 'plant_lookup_v1.json');
const outputPath = path.resolve(projectDirectory, 'public', 'landing', 'plant-count.js');

async function countMappings() {
  const plantData = JSON.parse(await readFile(plantDataPath, 'utf8'));
  const records = Array.isArray(plantData) ? plantData : Object.values(plantData);
  return records.filter((record) => record?.botanical).length;
}

async function lastSyncedCount() {
  try {
    const [, previous] = (await readFile(outputPath, 'utf8')).match(/=\s*(\d+)\s*;/) ?? [];
    return previous === undefined ? null : Number(previous);
  } catch {
    return null;
  }
}

// The plant data lives in the parent repository. A build host pointed at this folder
// alone will not have it, and a stale count is a better outcome than a failed build.
let mappingCount;
try {
  mappingCount = await countMappings();
} catch (error) {
  const reason =
    error.code === 'ENOENT'
      ? `no plant data at ${path.relative(projectDirectory, plantDataPath)}`
      : `could not read plant data (${error.message})`;
  const previous = await lastSyncedCount();

  if (previous === null) {
    console.warn(`Skipped plant-count sync: ${reason}, and no previously synced count to fall back to.`);
    console.warn('The landing page will use the number written into its markup.');
  } else {
    console.warn(`Skipped plant-count sync: ${reason}. Keeping the last synced count (${previous}).`);
  }
  process.exit(0);
}

await writeFile(outputPath, `window.SANKO_PLANT_MAPPING_COUNT = ${mappingCount};\n`, 'utf8');
console.log(`Synced ${mappingCount} medicinal-plant mappings to the landing page.`);
