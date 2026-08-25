import { ext } from "../utilities/ext-api"
import { hasValidExtensionContext, isExtensionContextInvalidatedError } from "../utilities/extension-context";
import { bookmarksService } from "./bookmarks";
import { LS_PREFIX, LEGACY_LS_PREFIX } from "../config/namespace";

const BACKUP_SCHEMA = 1;
const APP_NAME = "Poe Zh Trade Tools Pro";
const STORAGE_KEYS = new Set([
  "app-settings",
  "app-settings-poe1",
  "app-settings-poe2",
  "bookmark-folders",
  "bookmark-trades-all"
]);
// Legacy per-folder trade keys are still captured for backups taken before the
// single-store migration.
const STORAGE_PREFIXES = ["bookmark-trades--"];
// Manage both the project namespace and the legacy `bt-` prefix so a backup
// taken mid-migration still captures the user's older values.
const LOCAL_STORAGE_PREFIXES = [LS_PREFIX, LEGACY_LS_PREFIX];
const LOCAL_STORAGE_EXCLUDED_PREFIXES = [
  `${LS_PREFIX}bulk-sellers-`,
  `${LS_PREFIX}bulk-visited-`,
  `${LEGACY_LS_PREFIX}bulk-sellers-`,
  `${LEGACY_LS_PREFIX}bulk-visited-`
];

interface StoragePayload {
  value: unknown;
  expiresAt: string | null;
}

interface ExtensionBackup {
  schema: typeof BACKUP_SCHEMA;
  app: typeof APP_NAME;
  exportedAt: string;
  version: string;
  data: {
    storage: Record<string, StoragePayload>;
    localStorage: Record<string, string>;
  };
}

const isManagedStorageKey = (key: string) =>
  STORAGE_KEYS.has(key) || STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix));

const isManagedLocalStorageKey = (key: string) =>
  LOCAL_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
  !LOCAL_STORAGE_EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix));

const getAppVersion = () => {
  if (hasValidExtensionContext() && ext.runtime?.getManifest) {
    return ext.runtime.getManifest().version;
  }

  return "dev";
};

const readAllStorage = async () => {
  if (!hasValidExtensionContext() || !ext.storage?.local) return {};

  try {
    return await ext.storage.local.get(null) as Record<string, StoragePayload>;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn("[Poe Zh Trade Tools Pro] Backup storage read failed", error);
    }
    return {};
  }
};

const writeStorage = async (values: Record<string, StoragePayload>) => {
  if (!hasValidExtensionContext() || !ext.storage?.local) return false;

  try {
    const current = await ext.storage.local.get(null);
    const keysToRemove = Object.keys(current).filter(isManagedStorageKey);
    if (keysToRemove.length > 0) {
      await ext.storage.local.remove(keysToRemove);
    }
    await ext.storage.local.set(values);
    return true;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn("[Poe Zh Trade Tools Pro] Backup storage restore failed", error);
    }
    return false;
  }
};

const readManagedLocalStorage = () => {
  const values: Record<string, string> = {};
  if (typeof window === "undefined") return values;

  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (!key || !isManagedLocalStorageKey(key)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }

  return values;
};

const writeManagedLocalStorage = (values: Record<string, string>) => {
  if (typeof window === "undefined") return;

  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index++) {
    const key = window.localStorage.key(index);
    if (key && isManagedLocalStorageKey(key)) keysToRemove.push(key);
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  Object.entries(values).forEach(([key, value]) => {
    if (isManagedLocalStorageKey(key)) {
      window.localStorage.setItem(key, value);
    }
  });
};

const parseBackup = (dataString: string): ExtensionBackup | null => {
  try {
    const parsed = JSON.parse(dataString) as Partial<ExtensionBackup>;
    if (
      parsed.schema !== BACKUP_SCHEMA ||
      parsed.app !== APP_NAME ||
      !parsed.data ||
      typeof parsed.data !== "object"
    ) {
      return null;
    }

    return parsed as ExtensionBackup;
  } catch {
    return null;
  }
};

export const extensionBackupService = {
  async generateBackupDataString() {
    const allStorage = await readAllStorage();
    const storage = Object.fromEntries(
      Object.entries(allStorage).filter(([key]) => isManagedStorageKey(key))
    ) as Record<string, StoragePayload>;

    const backup: ExtensionBackup = {
      schema: BACKUP_SCHEMA,
      app: APP_NAME,
      exportedAt: new Date().toISOString(),
      version: getAppVersion(),
      data: {
        storage,
        localStorage: readManagedLocalStorage()
      }
    };

    return JSON.stringify(backup, null, 2);
  },

  async restoreFromDataString(dataString: string) {
    const parsed = parseBackup(dataString);
    if (!parsed) {
      return bookmarksService.restoreFromDataString(dataString);
    }

    const restored = await writeStorage(parsed.data.storage || {});
    if (!restored) return false;

    writeManagedLocalStorage(parsed.data.localStorage || {});
    await bookmarksService.refresh();
    return true;
  }
};
